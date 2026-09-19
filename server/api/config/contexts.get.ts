import type { ContextsResponse, ContextSummary } from '#shared/types/contexts'
import { resolvedModels } from '#shared/utils/contexts'

import { discoverLayout } from '../../utils/contexts'
import { getOpenCodeClient } from '../../utils/opencode-client'

/**
 * The OpenCode configuration contexts governing the sessions on this machine.
 *
 * Discovery needs the directories sessions ran in, so the session list is read
 * first. Both halves are cached together: configs change rarely, and the session
 * list is two upstream requests.
 */

const CACHE_MS = 30_000
const PAGE_LIMIT = 500
const MAX_PAGES = 8

interface Cache {
  at: number
  value: ContextsResponse
}

let cache: Cache | null = null

async function sessionDirectories(): Promise<string[]> {
  const client = getOpenCodeClient()
  const directories = new Set<string>()
  let cursor: string | undefined

  for (let page = 0; page < MAX_PAGES; page++) {
    const query: Record<string, string | number> = { limit: PAGE_LIMIT }
    if (cursor) query['cursor'] = cursor

    const response = await client.get<{
      data?: Array<{ location?: { directory?: unknown } }>
      cursor?: { next?: unknown }
    }>('/api/session', query)

    for (const session of response.data ?? []) {
      const directory = session.location?.directory
      if (typeof directory === 'string' && directory !== '') directories.add(directory)
    }

    cursor = typeof response.cursor?.next === 'string' ? response.cursor.next : undefined
    if (!cursor) break
  }

  return [...directories]
}

export async function buildContextsResponse(): Promise<ContextsResponse> {
  const directories = await sessionDirectories()
  const { configs, contexts, definitions } = await discoverLayout(directories)

  const summaries: ContextSummary[] = contexts.map((context) => ({
    id: context.id,
    label: context.label,
    scopeDir: context.scopeDir,
    depth: context.depth,
    // Lowest precedence first, so the list reads as the merge order.
    stack: context.stack.map((config) => ({
      path: config.path,
      kind: config.kind,
      keys: config.keys,
      parseError: config.parseError,
    })),
    keys: context.keys,
    models: resolvedModels(context.stack, definitions),
  }))

  return { contexts: summaries }
}

export default defineEventHandler(async (event): Promise<ContextsResponse> => {
  const refresh = 'refresh' in (getQuery(event) as Record<string, unknown>)
  const now = Date.now()

  if (!refresh && cache && now - cache.at < CACHE_MS) return cache.value

  try {
    const value = await buildContextsResponse()
    cache = { at: now, value }
    return value
  } catch (error) {
    // A degraded answer beats a failed request: the Sessions explorer should
    // still render without contexts rather than not render at all.
    return {
      contexts: [],
      error:
        error instanceof Error ? error.message : 'could not read the configuration',
    }
  }
})
