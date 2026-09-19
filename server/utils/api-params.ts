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
  /**
   * `null` means the caller did not specify a cursor, which is a different
   * question from `0`. See `defaultCursor`.
   */
  after: number | null
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
 * - `after` is null when absent or unusable; `after=0` means "from the oldest
 *   record still held", which is a deliberate request for everything.
 * - `limit` defaults to 200 and is clamped to 2000, so one request cannot ask
 *   for the whole buffer by accident.
 */
export function parseRecordsQuery(
  query: Record<string, unknown>,
): RecordsQuery {
  const rawAfter = toInteger(query['after'])
  const after = rawAfter !== null && rawAfter >= 0 ? rawAfter : null

  const rawLimit = toInteger(query['limit'])
  const limit =
    rawLimit !== null && rawLimit > 0
      ? Math.min(rawLimit, RECORDS_MAX_LIMIT)
      : RECORDS_DEFAULT_LIMIT

  return { after, limit }
}

/**
 * Where an unspecified cursor starts: the newest `limit` records.
 *
 * The first load of the UI wants the most recent window, not the oldest one.
 * Paging backwards is a separate, deliberate request (`after=0` then forward).
 */
export function defaultCursor(latestSeq: number, limit: number): number {
  return Math.max(0, latestSeq - limit)
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
