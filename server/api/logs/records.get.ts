import type { LogRecordsResponse } from '#shared/types/logs'

import { defaultCursor, parseRecordsQuery } from '../../utils/api-params'
import { getReaders } from '../../utils/readers'

/**
 * Backfill from the ring buffer.
 *
 * `?after=<seq>&limit=<n>` — records strictly newer than `after`, oldest first.
 * With no `after`, the newest `limit` records are returned, which is what a
 * first load wants; `after=0` explicitly asks for everything still held.
 *
 * The response carries `oldestSeq` so a client that has fallen out of the
 * window can detect the gap instead of silently missing records.
 */
export default defineEventHandler((event): LogRecordsResponse => {
  const readers = getReaders()
  const { after, limit } = parseRecordsQuery(
    getQuery(event) as Record<string, unknown>,
  )

  const cursor = after ?? defaultCursor(readers.buffer.latestSeq(), limit)
  const entries = readers.buffer.after(cursor, limit)

  return {
    records: entries.map((entry) => ({ seq: entry.seq, record: entry.value })),
    oldestSeq: readers.buffer.oldestSeq(),
    latestSeq: readers.buffer.latestSeq(),
    size: readers.buffer.size(),
  }
})
