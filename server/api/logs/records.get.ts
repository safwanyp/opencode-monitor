import type { LogRecordsResponse } from '#shared/types/logs'

import { parseRecordsQuery } from '../../utils/api-params'
import { getReaders } from '../../utils/readers'

/**
 * Backfill from the ring buffer.
 *
 * `?after=<seq>&limit=<n>` — records strictly newer than `after`, oldest first.
 * The response carries `oldestSeq` so a client that has fallen out of the
 * window can detect the gap instead of silently missing records.
 */
export default defineEventHandler((event): LogRecordsResponse => {
  const readers = getReaders()
  const { after, limit } = parseRecordsQuery(getQuery(event) as Record<string, unknown>)

  const entries = readers.buffer.after(after, limit)

  return {
    records: entries.map((entry) => ({ seq: entry.seq, record: entry.value })),
    oldestSeq: readers.buffer.oldestSeq(),
    latestSeq: readers.buffer.latestSeq(),
    size: readers.buffer.size(),
  }
})
