import type { FacetCount, LogFacetsResponse } from '#shared/types/logs'

import { getReaders } from '../../utils/readers'

/** Facets are for scanning, not for enumerating: cap the long tails. */
const MAX_RUNS = 20
const MAX_MESSAGES = 40

function bump(counter: Map<string, number>, key: string): void {
  counter.set(key, (counter.get(key) ?? 0) + 1)
}

function toSorted(counter: Map<string, number>, limit: number): FacetCount[] {
  return [...counter.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
    .slice(0, limit)
}

/**
 * Whole-buffer facet counts for the Explorer A panel.
 *
 * Computed over everything retained rather than over a fetched page: a count
 * over the newest 200 records tells the user almost nothing about what is in
 * the log. One pass over 20k records costs a few milliseconds and is only
 * recomputed when the client asks.
 */
export default defineEventHandler((): LogFacetsResponse => {
  const readers = getReaders()
  const entries = readers.buffer.snapshot()

  const level = new Map<string, number>()
  const role = new Map<string, number>()
  const run = new Map<string, number>()
  const message = new Map<string, number>()

  for (const entry of entries) {
    const record = entry.value
    bump(level, record.level)
    if (record.role) bump(role, record.role)
    if (record.run) bump(run, record.run)
    if (record.message) bump(message, record.message)
  }

  return {
    total: entries.length,
    level: toSorted(level, level.size),
    role: toSorted(role, role.size),
    run: toSorted(run, MAX_RUNS),
    message: toSorted(message, MAX_MESSAGES),
  }
})
