import { describe, expect, it } from 'vitest'

import { deriveApiHealth } from '../server/utils/event-reader.ts'

/**
 * Explorer B's health has three states and the app must render all of them.
 * Deriving them is pure, so they can be asserted without taking the service down
 * — which matters, because the service is running this session.
 */

const NOW = 1_800_000_000_000

const base = {
  received: 342,
  unparsable: 0,
  reconnects: 0,
  lastEventAt: NOW - 1_000,
  lastHeartbeatAt: NOW - 500,
}

describe('deriveApiHealth', () => {
  it('reports connected with the event count and freshness', () => {
    expect(deriveApiHealth('connected', base, NOW)).toEqual({
      status: 'connected',
      detail: '342 events · last 1s ago',
    })
  })

  it('reports reconnecting rather than failing, and counts the reconnects', () => {
    const health = deriveApiHealth('reconnecting', { ...base, reconnects: 3 }, NOW)
    expect(health.status).toBe('reconnecting')
    expect(health.detail).toContain('3 reconnects')
  })

  it('reports disconnected when nothing is consuming the stream', () => {
    const health = deriveApiHealth(
      'disconnected',
      { ...base, received: 0, lastEventAt: null },
      NOW,
    )
    expect(health.status).toBe('disconnected')
    expect(health.detail).toBe('waiting for the service')
  })

  it('never claims a status it cannot support', () => {
    // The three states are the whole set the UI renders.
    for (const state of ['connected', 'reconnecting', 'disconnected'] as const) {
      const health = deriveApiHealth(state, base, NOW)
      expect(['connected', 'reconnecting', 'disconnected']).toContain(health.status)
    }
  })

  it('scales the staleness wording so it stays readable', () => {
    expect(
      deriveApiHealth('connected', { ...base, lastEventAt: NOW - 5_000 }, NOW).detail,
    ).toContain('last 5s ago')
    expect(
      deriveApiHealth('connected', { ...base, lastEventAt: NOW - 300_000 }, NOW).detail,
    ).toContain('last 5m ago')
    expect(
      deriveApiHealth('connected', { ...base, lastEventAt: NOW - 7_200_000 }, NOW).detail,
    ).toContain('last 2h ago')
  })
})
