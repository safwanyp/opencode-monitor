import { describe, expect, it } from 'vitest'

import type { SessionSummary } from '../../shared/types/events.ts'
import {
  defaultDirection,
  sortSessions,
  sortValue,
} from '../../app/composables/useSessionSort.ts'

function session(
  id: string,
  overrides: Partial<SessionSummary> = {},
): SessionSummary {
  return { id, title: id, ...overrides }
}

const a = session('a', {
  title: 'Alpha',
  directory: '/work/alpha',
  model: { id: 'claude-sonnet-4' },
  agent: 'build',
  cost: 0.5,
  tokens: { input: 100, output: 100 },
  outcome: 'succeeded',
  updated: 300,
})
const b = session('b', {
  title: 'beta',
  directory: '/work/beta',
  model: { id: 'gpt-5.2' },
  agent: 'plan',
  cost: 2.25,
  tokens: { input: 4_000, output: 1_000 },
  outcome: 'failed',
  updated: 100,
})
const c = session('c', {
  title: 'Gamma',
  directory: '/work/gamma',
  model: { id: 'claude-opus-4' },
  agent: 'explore',
  cost: 0.25,
  tokens: { input: 50, output: 50 },
  outcome: 'interrupted',
  updated: 200,
})

const all = [a, b, c]
const ids = (sessions: SessionSummary[]) => sessions.map((s) => s.id)

describe('defaultDirection', () => {
  it('puts the largest number first for numeric columns', () => {
    expect(defaultDirection('cost')).toBe('desc')
    expect(defaultDirection('tokens')).toBe('desc')
    expect(defaultDirection('updated')).toBe('desc')
  })

  it('reads text A to Z', () => {
    expect(defaultDirection('title')).toBe('asc')
    expect(defaultDirection('directory')).toBe('asc')
    expect(defaultDirection('model')).toBe('asc')
    expect(defaultDirection('agent')).toBe('asc')
    expect(defaultDirection('outcome')).toBe('asc')
  })
})

describe('sortValue', () => {
  it('sorts text case-insensitively', () => {
    // 'Alpha' and 'beta' must not sort by ASCII, where every capital wins.
    expect(sortValue(a, 'title')).toBe('alpha')
    expect(sortValue(b, 'title')).toBe('beta')
  })

  it('treats a missing number as the smallest, not as zero', () => {
    // A session with no recorded cost should sink to the bottom of a
    // largest-first sort rather than pretending it was free.
    const noCost = session('x')
    expect(sortValue(noCost, 'cost')).toBe(Number.NEGATIVE_INFINITY)
    expect(sortValue(noCost, 'tokens')).toBe(Number.NEGATIVE_INFINITY)
    expect(sortValue(noCost, 'updated')).toBe(Number.NEGATIVE_INFINITY)
  })

  it('uses empty strings for missing text rather than undefined', () => {
    const bare = session('x')
    expect(sortValue(bare, 'directory')).toBe('')
    expect(sortValue(bare, 'model')).toBe('')
    expect(sortValue(bare, 'agent')).toBe('')
    expect(sortValue(bare, 'outcome')).toBe('')
  })
})

describe('sortSessions', () => {
  it('sorts text ascending and descending', () => {
    expect(ids(sortSessions(all, 'title', 'asc'))).toEqual(['a', 'b', 'c'])
    expect(ids(sortSessions(all, 'title', 'desc'))).toEqual(['c', 'b', 'a'])
  })

  it('sorts numbers by their real value, not their text', () => {
    // As text, "0.25" < "0.5" < "2.25" happens to agree here, so tokens is the
    // better check: 50, 200 and 5000 must not compare as strings.
    expect(ids(sortSessions(all, 'tokens', 'asc'))).toEqual(['c', 'a', 'b'])
    expect(ids(sortSessions(all, 'tokens', 'desc'))).toEqual(['b', 'a', 'c'])
  })

  it('sorts by updated time', () => {
    expect(ids(sortSessions(all, 'updated', 'desc'))).toEqual(['a', 'c', 'b'])
  })

  it('keeps ties in a stable order that does not flip with the direction', () => {
    const tieOne = session('m', { cost: 1 })
    const tieTwo = session('n', { cost: 1 })
    const list = [tieTwo, tieOne]

    expect(ids(sortSessions(list, 'cost', 'asc'))).toEqual(['m', 'n'])
    // Same order for equal rows even when the arrow is reversed.
    expect(ids(sortSessions(list, 'cost', 'desc'))).toEqual(['m', 'n'])
  })

  it('does not mutate the input', () => {
    const before = ids(all)
    sortSessions(all, 'title', 'desc')
    expect(ids(all)).toEqual(before)
  })

  it('handles an empty list', () => {
    expect(sortSessions([], 'title', 'asc')).toEqual([])
  })

  it('groups missing values at the end of a largest-first sort', () => {
    const bare = session('z')
    const result = sortSessions([bare, a, b], 'cost', 'desc')
    expect(ids(result)).toEqual(['b', 'a', 'z'])
  })
})
