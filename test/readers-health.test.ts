import { describe, expect, it } from 'vitest'

import { deriveLogHealth } from '../server/utils/readers.ts'

const NOW = 1_800_000_000_000
const base = {
  hasTailer: true,
  records: 6902,
  parseFailures: 0,
  lastBatchAt: NOW - 5_000,
  lastErrorAt: null,
  now: NOW,
}

describe('deriveLogHealth', () => {
  it('reports paused before the reader has started', () => {
    expect(deriveLogHealth({ ...base, hasTailer: false })).toEqual({
      status: 'paused',
    })
  })

  it('reports following with the record count and staleness', () => {
    expect(deriveLogHealth(base)).toEqual({
      status: 'following',
      detail: '6,902 records · last write 5s ago',
    })
  })

  it('keeps following when the source goes quiet, and shows the growing age', () => {
    // This is the "service stopped" case. The reader is fine; nothing is being
    // written. Reporting `paused` would blame the reader.
    const health = deriveLogHealth({ ...base, lastBatchAt: NOW - 240_000 })
    expect(health.status).toBe('following')
    expect(health.detail).toContain('last write 4m ago')
  })

  it('reports error when the last failure is newer than the last successful read', () => {
    const health = deriveLogHealth({ ...base, lastErrorAt: NOW - 3_000 })
    expect(health.status).toBe('error')
    expect(health.detail).toContain('reader failed 3s ago')
  })

  it('does not report error once a later read has succeeded', () => {
    // A transient failure that the next poll recovered from is not unhealthy.
    const health = deriveLogHealth({
      ...base,
      lastErrorAt: NOW - 30_000,
      lastBatchAt: NOW - 1_000,
    })
    expect(health.status).toBe('following')
  })

  it('reports error when the reader has never read anything successfully', () => {
    const health = deriveLogHealth({
      ...base,
      lastBatchAt: null,
      lastErrorAt: NOW - 1_000,
    })
    expect(health.status).toBe('error')
  })

  it('surfaces unparsed lines without changing the status', () => {
    const health = deriveLogHealth({ ...base, parseFailures: 12 })
    expect(health.status).toBe('following')
    expect(health.detail).toContain('12 unparsed')
  })

  it('omits the staleness clause when nothing has ever been read', () => {
    expect(deriveLogHealth({ ...base, lastBatchAt: null }).detail).toBe(
      '6,902 records',
    )
  })
})
