import type { SessionsResponse, SessionSummary } from '#shared/types/events'

import { normalizeSession } from '../../utils/normalize'
import { getOpenCodeClient } from '../../utils/opencode-client'

/**
 * Session list.
 *
 * A failure comes back as `{ sessions: [], error }` with a 200. Explorer B not
 * reaching the service is a supported state rather than an exceptional one — the
 * app is a monitor, and the service being down is one of the things it exists to
 * show. The UI renders `error` instead of handling a rejection everywhere.
 */
/** The upstream accepts a large page, which keeps the client's paging short. */
const MAX_LIMIT = 500
const DEFAULT_LIMIT = 500

export default defineEventHandler(async (event): Promise<SessionsResponse> => {
  const query = getQuery(event) as Record<string, unknown>

  const requested = Number(query['limit'])
  const limit =
    Number.isFinite(requested) && requested > 0
      ? Math.min(Math.trunc(requested), MAX_LIMIT)
      : DEFAULT_LIMIT

  const params: Record<string, string | number> = { limit }
  const cursor = query['cursor']
  if (typeof cursor === 'string' && cursor !== '') params['cursor'] = cursor

  try {
    const response = await getOpenCodeClient().get<{
      data?: unknown[]
      cursor?: { next?: unknown }
    }>('/api/session', params)

    const sessions = (response.data ?? [])
      .map(normalizeSession)
      .filter((session): session is SessionSummary => session !== null)

    return {
      sessions,
      next: typeof response.cursor?.next === 'string' ? response.cursor.next : undefined,
    }
  } catch (error) {
    return {
      sessions: [],
      error:
        error instanceof Error ? error.message : 'OpenCode service is unreachable',
    }
  }
})
