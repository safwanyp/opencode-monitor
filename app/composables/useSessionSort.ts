import type { SessionSummary } from '#shared/types/events'
import { billableTokens } from '#shared/utils/format'

/**
 * Sorting for the sessions table.
 *
 * The comparator and the default direction are pure, so the tie-break and the
 * missing-value rules can be asserted instead of eyeballed. The state lives in
 * `useState` so a round trip into a session and back does not silently reset the
 * sort the user just chose.
 */

export type SessionSortKey =
  | 'title'
  | 'directory'
  | 'model'
  | 'agent'
  | 'cost'
  | 'tokens'
  | 'outcome'
  | 'updated'

export type SortDirection = 'asc' | 'desc'

/** Numbers read best largest-first; text reads best A–Z. */
export const NUMERIC_SORT_KEYS: readonly SessionSortKey[] = ['cost', 'tokens', 'updated']

export function defaultDirection(key: SessionSortKey): SortDirection {
  return NUMERIC_SORT_KEYS.includes(key) ? 'desc' : 'asc'
}

/**
 * The value a column sorts on.
 *
 * Missing values sort as the smallest thing in the column rather than as zero,
 * so a session with no recorded cost lands at the bottom of a descending sort
 * instead of pretending it cost nothing.
 */
export function sortValue(
  session: SessionSummary,
  key: SessionSortKey,
): string | number {
  switch (key) {
    case 'title':
      return session.title.toLowerCase()
    case 'directory':
      return (session.directory ?? '').toLowerCase()
    case 'model':
      return (session.model?.id ?? '').toLowerCase()
    case 'agent':
      return (session.agent ?? '').toLowerCase()
    case 'outcome':
      return (session.outcome ?? '').toLowerCase()
    case 'cost':
      return session.cost ?? Number.NEGATIVE_INFINITY
    case 'tokens':
      return billableTokens(session.tokens) ?? Number.NEGATIVE_INFINITY
    case 'updated':
      return session.updated ?? Number.NEGATIVE_INFINITY
  }
}

export function sortSessions(
  sessions: SessionSummary[],
  key: SessionSortKey,
  direction: SortDirection,
): SessionSummary[] {
  const sign = direction === 'asc' ? 1 : -1

  return [...sessions].sort((a, b) => {
    const left = sortValue(a, key)
    const right = sortValue(b, key)

    if (left < right) return -sign
    if (left > right) return sign

    // A stable tie-break, deliberately independent of direction: two sessions
    // with the same cost should not swap places when the arrow is flipped.
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}

export function useSessionSort() {
  const key = useState<SessionSortKey>('session-sort-key', () => 'updated')
  const direction = useState<SortDirection>('session-sort-direction', () => 'desc')

  /** Same column flips direction; a new column takes its natural direction. */
  function toggle(next: SessionSortKey) {
    if (key.value === next) {
      direction.value = direction.value === 'asc' ? 'desc' : 'asc'
      return
    }
    key.value = next
    direction.value = defaultDirection(next)
  }

  return { key, direction, toggle }
}
