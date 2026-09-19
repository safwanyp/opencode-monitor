import type { SessionMessage, TranscriptResponse } from '#shared/types/events'

import { normalizeMessage } from '../../../utils/normalize'
import { getOpenCodeClient } from '../../../utils/opencode-client'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

/**
 * Transcript for one session.
 *
 * History, not the live tail: `/api/event` is the live source, and the session
 * log endpoint is not replayable (design §7). Same degradation rule as the
 * session list — an unreachable service is reported, not thrown.
 */
export default defineEventHandler(async (event): Promise<TranscriptResponse> => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    setResponseStatus(event, 400)
    return { messages: [], error: 'missing session id' }
  }

  const query = getQuery(event) as Record<string, unknown>
  const rawLimit = Number(query['limit'])
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(Math.trunc(rawLimit), MAX_LIMIT)
      : DEFAULT_LIMIT

  const params: Record<string, string | number> = { limit }
  const cursor = query['cursor']
  if (typeof cursor === 'string' && cursor !== '') params['cursor'] = cursor

  try {
    const response = await getOpenCodeClient().get<{
      data?: unknown[]
      cursor?: { previous?: unknown }
    }>(`/api/session/${encodeURIComponent(id)}/message`, params)

    const messages = (response.data ?? [])
      .map(normalizeMessage)
      .filter((message): message is SessionMessage => message !== null)

    return {
      messages,
      previous:
        typeof response.cursor?.previous === 'string'
          ? response.cursor.previous
          : undefined,
    }
  } catch (error) {
    return {
      messages: [],
      error:
        error instanceof Error ? error.message : 'OpenCode service is unreachable',
    }
  }
})
