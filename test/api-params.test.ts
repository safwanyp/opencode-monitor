import { describe, expect, it } from 'vitest'

import {
  RECORDS_DEFAULT_LIMIT,
  RECORDS_MAX_LIMIT,
  defaultCursor,
  parseRecordsQuery,
  parseStreamCursor,
} from '../server/utils/api-params.ts'

describe('parseRecordsQuery', () => {
  it('reports no cursor when nothing is given, which is not the same as 0', () => {
    expect(parseRecordsQuery({})).toEqual({
      after: null,
      limit: RECORDS_DEFAULT_LIMIT,
    })
  })

  it('reads string values, which is what a query string actually contains', () => {
    expect(parseRecordsQuery({ after: '12', limit: '50' })).toEqual({
      after: 12,
      limit: 50,
    })
  })

  it('treats an explicit 0 as a real cursor', () => {
    // after=0 means "from the oldest record still held", a deliberate request
    // for everything, not an absent cursor.
    expect(parseRecordsQuery({ after: '0' }).after).toBe(0)
  })

  it('clamps limit so one request cannot ask for everything', () => {
    expect(parseRecordsQuery({ limit: '999999' }).limit).toBe(RECORDS_MAX_LIMIT)
    expect(parseRecordsQuery({ limit: '2000' }).limit).toBe(RECORDS_MAX_LIMIT)
  })

  it('falls back on unusable values rather than throwing', () => {
    expect(parseRecordsQuery({ after: 'abc', limit: 'abc' })).toEqual({
      after: null,
      limit: RECORDS_DEFAULT_LIMIT,
    })
    expect(parseRecordsQuery({ after: '-5', limit: '0' })).toEqual({
      after: null,
      limit: RECORDS_DEFAULT_LIMIT,
    })
    expect(parseRecordsQuery({ after: '  ', limit: '' })).toEqual({
      after: null,
      limit: RECORDS_DEFAULT_LIMIT,
    })
  })

  it('truncates fractional values', () => {
    expect(parseRecordsQuery({ after: '3.9', limit: '10.7' })).toEqual({
      after: 3,
      limit: 10,
    })
  })

  it('ignores values that are not finite numbers', () => {
    expect(parseRecordsQuery({ after: 'Infinity', limit: 'NaN' })).toEqual({
      after: null,
      limit: RECORDS_DEFAULT_LIMIT,
    })
  })
})

describe('defaultCursor', () => {
  it('returns the newest window, not the oldest', () => {
    // First load wants recent records; the buffer holds 20k.
    expect(defaultCursor(20_000, 200)).toBe(19_800)
  })

  it('never goes negative on a buffer smaller than the page', () => {
    expect(defaultCursor(50, 200)).toBe(0)
    expect(defaultCursor(0, 200)).toBe(0)
  })
})

describe('parseStreamCursor', () => {
  it('starts at the head when no cursor is given', () => {
    // Otherwise a fresh connection would be flooded with the whole buffer.
    expect(parseStreamCursor({}, 500)).toBe(500)
  })

  it('resumes from an explicit cursor so a reconnect has no gap', () => {
    expect(parseStreamCursor({ after: '490' }, 500)).toBe(490)
    expect(parseStreamCursor({ after: '0' }, 500)).toBe(0)
  })

  it('never returns a cursor ahead of the buffer', () => {
    expect(parseStreamCursor({ after: '9999' }, 500)).toBe(500)
  })

  it('falls back to the head on an unusable cursor', () => {
    expect(parseStreamCursor({ after: 'nonsense' }, 500)).toBe(500)
    expect(parseStreamCursor({ after: '-1' }, 500)).toBe(500)
  })
})
