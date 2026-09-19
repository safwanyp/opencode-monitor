import { describe, expect, it } from 'vitest'

import { getHealth, getReaders, getStats } from '../server/utils/readers.ts'

describe('reader singleton', () => {
  it('returns one process-wide state object', () => {
    // This identity is the whole duplication defence: Nitro can re-run the
    // plugin, and a second state object would mean a second tailer feeding a
    // second buffer, which presents as duplicated rows.
    expect(getReaders()).toBe(getReaders())
  })

  it('keeps the buffer and emitter stable across calls', () => {
    const first = getReaders()
    const second = getReaders()
    expect(second.buffer).toBe(first.buffer)
    expect(second.events).toBe(first.events)
  })

  it('reports honest health before any reader has started', () => {
    const health = getHealth()
    expect(health.log.status).toBe('paused')
    // Explorer B is not wired until Phase 6 and must not claim otherwise.
    expect(health.api.status).toBe('unknown')
  })

  it('starts with an empty buffer and no failures', () => {
    const stats = getStats()
    expect(stats.records).toBe(0)
    expect(stats.parseFailures).toBe(0)
    expect(stats.duplicateOffsets).toBe(0)
    expect(stats.bufferSize).toBe(0)
    expect(stats.latestSeq).toBe(0)
  })
})
