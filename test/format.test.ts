import { describe, expect, it } from 'vitest'

import {
  createDayCursor,
  dayKey,
  formatDateTime,
  formatDayLabel,
} from '../shared/utils/format.ts'

/**
 * Dates are constructed in local time throughout, because that is what these
 * functions use — the user is reading their own machine's log and expects
 * "today" to mean their today.
 */
const at = (y: number, m: number, d: number, h = 12, min = 0) =>
  new Date(y, m - 1, d, h, min).getTime()

describe('dayKey', () => {
  it('returns the local calendar day', () => {
    expect(dayKey(at(2026, 9, 19))).toBe('2026-09-19')
    expect(dayKey(at(2026, 1, 5))).toBe('2026-01-05')
  })

  it('accepts an ISO string as well as a number', () => {
    expect(dayKey(new Date(at(2026, 9, 19, 23, 30)).toISOString())).toBe('2026-09-19')
  })

  it('is null for something unusable', () => {
    expect(dayKey(undefined)).toBeNull()
    expect(dayKey('not a date')).toBeNull()
    expect(dayKey(Number.NaN)).toBeNull()
  })
})

describe('formatDayLabel', () => {
  it('names today and yesterday rather than printing the date', () => {
    const now = at(2026, 9, 19, 15)
    expect(formatDayLabel('2026-09-19', now)).toBe('Today')
    expect(formatDayLabel('2026-09-18', now)).toBe('Yesterday')
  })

  it('prints the weekday and date for anything older, in the same year', () => {
    const now = at(2026, 9, 19, 15)
    // 15 Sep 2026 is a Tuesday.
    expect(formatDayLabel('2026-09-15', now)).toBe('Tue 15 Sep')
  })

  it('adds the year when it is not the current one', () => {
    const now = at(2026, 9, 19, 15)
    expect(formatDayLabel('2025-12-31', now)).toBe('Wed 31 Dec 2025')
  })

  it('handles a missing key without throwing', () => {
    expect(formatDayLabel(null)).toBe('Unknown date')
  })
})

describe('formatDateTime', () => {
  it('includes the date, so the detail view is never ambiguous', () => {
    const value = formatDateTime(at(2026, 9, 19, 16, 12))
    expect(value).toMatch(/^2026-09-19 16:12:00\.\d{3}$/)
  })

  it('accepts an ISO string', () => {
    const iso = new Date(at(2026, 9, 19, 8, 5)).toISOString()
    expect(formatDateTime(iso)).toContain('2026-09-19')
  })

  it('degrades rather than throwing', () => {
    expect(formatDateTime(undefined)).toBe('—')
    expect(formatDateTime('nope')).toBe('—')
  })
})

describe('createDayCursor', () => {
  const now = at(2026, 9, 19, 15)

  it('emits once for the first item, then only when the day changes', () => {
    const next = createDayCursor(now)

    expect(next(at(2026, 9, 18, 23))?.label).toBe('Yesterday')
    // Same day: no marker.
    expect(next(at(2026, 9, 18, 23, 59))).toBeNull()
    expect(next(at(2026, 9, 18, 23, 59))).toBeNull()
    // Day changes.
    expect(next(at(2026, 9, 19, 0, 1))?.label).toBe('Today')
    expect(next(at(2026, 9, 19, 9))).toBeNull()
  })

  it('gives each marker a stable, unique key', () => {
    const next = createDayCursor(now)
    const a = next(at(2026, 9, 18))
    const b = next(at(2026, 9, 19))
    expect(a?.key).toBe('day:2026-09-18')
    expect(b?.key).toBe('day:2026-09-19')
    expect(a?.key).not.toBe(b?.key)
  })

  it('skips items with an unusable timestamp without losing the run', () => {
    const next = createDayCursor(now)
    expect(next(at(2026, 9, 19))).not.toBeNull()
    expect(next('garbage')).toBeNull()
    expect(next(undefined)).toBeNull()
    // Still the same day, so still no marker.
    expect(next(at(2026, 9, 19, 23))).toBeNull()
  })

  it('handles several days in one pass, in order', () => {
    const next = createDayCursor(now)
    const labels = [
      at(2026, 9, 17),
      at(2026, 9, 17, 18),
      at(2026, 9, 18),
      at(2026, 9, 19),
    ]
      .map((ts) => next(ts)?.label)
      .filter(Boolean)

    expect(labels).toEqual(['Thu 17 Sep', 'Yesterday', 'Today'])
  })
})
