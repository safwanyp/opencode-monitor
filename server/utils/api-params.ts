/**
 * Query-string parsing for the Explorer A endpoints.
 *
 * Pure and separated from the handlers so the clamping rules can be tested
 * without a running server. Every value is untrusted: a bad `limit` must not be
 * able to ask for the whole buffer, and a bad `after` must not move the cursor
 * somewhere it cannot be compared.
 */

export const RECORDS_DEFAULT_LIMIT = 200
export const RECORDS_MAX_LIMIT = 2000

export interface RecordsQuery {
  after: number
  limit: number
}

function toInteger(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.trunc(value) : null
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? Math.trunc(parsed) : null
  }
  return null
}

/**
 * `?after=&limit=` for the backfill endpoint.
 *
 * - `after` defaults to 0, i.e. as far back as the buffer still holds.
 * - `limit` defaults to 200 and is clamped to 2000, so one request cannot ask
 *   for everything.
 */
export function parseRecordsQuery(
  query: Record<string, unknown>,
): RecordsQuery {
  const rawAfter = toInteger(query['after'])
  const after = rawAfter !== null && rawAfter >= 0 ? rawAfter : 0

  const rawLimit = toInteger(query['limit'])
  const limit =
    rawLimit !== null && rawLimit > 0
      ? Math.min(rawLimit, RECORDS_MAX_LIMIT)
      : RECORDS_DEFAULT_LIMIT

  return { after, limit }
}

/**
 * The resume cursor for the stream endpoint.
 *
 * An explicit cursor replays from the buffer so a reconnect has no gap. No
 * cursor means "from here on": replaying up to 20k records into a fresh
 * connection would be a burst the client did not ask for, and backfill is the
 * records endpoint's job.
 */
export function parseStreamCursor(
  query: Record<string, unknown>,
  latestSeq: number,
): number {
  const raw = toInteger(query['after'])
  if (raw !== null && raw >= 0) return Math.min(raw, latestSeq)
  return latestSeq
}
