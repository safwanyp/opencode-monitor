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
export default defineEventHandler(async (): Promise<SessionsResponse> => {
  try {
    const response = await getOpenCodeClient().get<{ data?: unknown[] }>(
      '/api/session',
      { limit: 100 },
    )

    const sessions = (response.data ?? [])
      .map(normalizeSession)
      .filter((session): session is SessionSummary => session !== null)

    return { sessions }
  } catch (error) {
    return {
      sessions: [],
      error:
        error instanceof Error ? error.message : 'OpenCode service is unreachable',
    }
  }
})
