import { describe, expect, it } from 'vitest'

import {
  buildContexts,
  compareModels,
  contextFor,
  discoverConfigs,
  expectedModel,
  readAgentDefinitions,
  shortenPath,
  type Context,
} from '../server/utils/contexts.ts'
import { resolveServiceConnection } from '../server/utils/discovery.ts'

/**
 * Acceptance check against the real machine.
 *
 * Skipped by default so `pnpm test` stays hermetic and does not depend on a
 * running OpenCode service. Run it deliberately:
 *
 *   OPENCODE_REAL_CHECK=1 pnpm test contexts-real
 *
 * Every assertion here corresponds to a claim in the plan that was derived by
 * hand; this is what proves the module reproduces it.
 */

const ENABLED = process.env['OPENCODE_REAL_CHECK'] === '1'

interface Session {
  id: string
  agent?: string
  directory?: string
  model?: { providerID?: string; id?: string; variant?: string }
  created?: number
}

async function loadSessions(): Promise<Session[]> {
  const connection = await resolveServiceConnection()
  if (!connection) return []

  const auth =
    'Basic ' + Buffer.from(`opencode:${connection.password}`).toString('base64')
  const out: Session[] = []
  let cursor: string | undefined

  for (let page = 0; page < 8; page++) {
    const query = new URLSearchParams({ limit: '500' })
    if (cursor) query.set('cursor', cursor)
    const response = await fetch(`${connection.url}/api/session?${query}`, {
      headers: { authorization: auth },
    })
    const body = (await response.json()) as {
      data?: Array<Record<string, unknown>>
      cursor?: { next?: string }
    }
    for (const raw of body.data ?? []) {
      out.push({
        id: String(raw['id'] ?? ''),
        agent: raw['agent'] as string | undefined,
        directory: (raw['location'] as { directory?: string } | undefined)?.directory,
        model: raw['model'] as Session['model'],
        created: (raw['time'] as { created?: number } | undefined)?.created,
      })
    }
    cursor = body.cursor?.next
    if (!cursor) break
  }

  return out
}

describe.skipIf(!ENABLED)('contexts against the real machine', () => {
  it('discovers, assigns and flags the way the plan says it should', async () => {
    const sessions = await loadSessions()
    expect(sessions.length).toBeGreaterThan(0)

    const directories = [
      ...new Set(sessions.map((s) => s.directory).filter((d): d is string => Boolean(d))),
    ]

    const configs = await discoverConfigs(directories)
    const contexts = buildContexts(configs)
    const definitions = await readAgentDefinitions()

    console.log('\n--- configs discovered ---')
    for (const config of configs) {
      console.log(`  ${config.kind.padEnd(12)} ${shortenPath(config.path)}  keys=[${config.keys.join(',')}]`)
    }

    console.log('\n--- contexts ---')
    for (const context of contexts) {
      console.log(`  ${context.label.padEnd(18)} depth=${String(context.depth).padStart(2)} stack=${context.stack.length} keys=[${context.keys.join(',')}]`)
    }

    // 1. Every session lands in a context, and the counts reconcile.
    const assigned = sessions.map((session) => ({
      session,
      context: contextFor(session.directory ?? '/', contexts) as Context,
    }))
    expect(assigned.every((a) => a.context)).toBe(true)

    const counts = new Map<string, number>()
    for (const { context } of assigned) {
      counts.set(context.id, (counts.get(context.id) ?? 0) + 1)
    }
    const summed = [...counts.values()].reduce((total, n) => total + n, 0)
    expect(summed).toBe(sessions.length)

    console.log('\n--- sessions per context ---')
    for (const context of contexts) {
      console.log(`  ${context.label.padEnd(18)} ${counts.get(context.id) ?? 0}`)
    }

    // 2. The work context is exactly the sessions under the work root.
    const WORK_ROOT = '/Users/safwanyp/dev/ikea'
    const work = contexts.find((c) => c.scopeDir === WORK_ROOT)
    expect(work, 'expected a context scoped to the work root').toBeTruthy()

    const inWork = sessions.filter((s) => (s.directory ?? '').startsWith(WORK_ROOT))
    expect(counts.get(work!.id)).toBe(inWork.length)
    expect(inWork.length).toBeGreaterThan(0)

    // 3. Mismatches: the pre-config personal sessions, and nothing else.
    const mismatches: Array<{ when: string; agent: string; context: string; expected: string; recorded: string }> = []

    for (const { session, context } of assigned) {
      if (!session.agent || !session.model?.providerID) continue
      const expected = expectedModel(session.agent, context.stack, definitions)
      if (!expected) continue

      const recorded = {
        provider: session.model.providerID,
        model: session.model.id ?? '',
        variant: session.model.variant ?? 'default',
      }
      const comparison = compareModels(expected, recorded)
      if (comparison.matches) continue

      mismatches.push({
        when: new Date(session.created ?? 0).toISOString().slice(0, 10),
        agent: session.agent,
        context: context.label,
        expected: `${expected.provider}/${expected.model}#${expected.variant}`,
        recorded: `${recorded.provider}/${recorded.model}#${recorded.variant}`,
      })
    }

    console.log(`\n--- mismatches (${mismatches.length}) ---`)
    for (const m of mismatches.slice(0, 12)) {
      console.log(`  ${m.when}  ${m.context.padEnd(18)} ${m.agent.padEnd(26)} expected ${m.expected}  recorded ${m.recorded}`)
    }

    // Sessions where an expectation exists at all. The flag has to be
    // discriminating: most sessions must not be flagged, or it says nothing.
    const resolvable = assigned.filter(
      ({ session, context }) =>
        session.agent && session.model?.providerID &&
        expectedModel(session.agent, context.stack, definitions) !== null,
    ).length
    const rate = resolvable === 0 ? 0 : mismatches.length / resolvable
    console.log(`\n  scored ${mismatches.length} of ${resolvable} resolvable sessions (${(rate * 100).toFixed(1)}%)`)

    expect(resolvable).toBeGreaterThan(0)
    expect(rate).toBeLessThan(0.25)
    expect(mismatches.length).toBeGreaterThan(0)

    // The case that motivated the feature: sessions that ran before the configs
    // existed, in personal directories, on the then-canonical copilot provider.
    // A context-only check would miss these, because the default context
    // declares no agent models at all.
    const historicalPersonal = mismatches.filter(
      (m) => m.context === 'Default' && m.when < '2026-09-12' && m.recorded.startsWith('github-copilot/'),
    )
    expect(historicalPersonal.length).toBeGreaterThan(0)

    // `build` has no definition and no declaration, so root sessions are never
    // scored — a deliberate false-negative rather than a guess.
    expect(mismatches.every((m) => m.agent !== 'build')).toBe(true)
  }, 60_000)
})
