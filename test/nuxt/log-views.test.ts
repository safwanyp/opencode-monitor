import { ref, shallowRef } from 'vue'

import { describe, expect, it } from 'vitest'

import type { LogRow } from '../../app/composables/useLogStream.ts'
import {
  groupProblems,
  groupSpans,
  summariseSpans,
} from '../../app/composables/useLogViews.ts'

function row(
  seq: number,
  overrides: Partial<LogRow['record']> = {},
): LogRow {
  return {
    seq,
    record: {
      id: `log:${seq}`,
      ts: new Date(Date.now() + seq * 1000).toISOString(),
      level: 'INFO',
      role: 'server',
      run: 'runA',
      message: 'request completed',
      fields: {},
      ...overrides,
    },
  }
}

describe('groupSpans', () => {
  it('ignores records without a span', () => {
    const groups = groupSpans([
      row(1, { span: 10 }),
      row(2),
      row(3, { span: 11 }),
    ])
    expect(groups).toHaveLength(2)
    expect(groups.flatMap((g) => g.lines).map((l) => l.seq)).toEqual([1, 3])
  })

  it('groups lines that share a span', () => {
    const groups = groupSpans([
      row(1, { span: 10, message: 'a' }),
      row(2, { span: 10, message: 'b' }),
      row(3, { span: 10, message: 'c' }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0]!.lines).toHaveLength(3)
    expect(groups[0]!.messages).toEqual(['a', 'b', 'c'])
  })

  it('keys by (run, span), because a span is only unique within a run', () => {
    // Verified against the live log: 43 of 896 span values appear in more than
    // one run, so grouping on the span alone fuses unrelated records.
    const groups = groupSpans([
      row(1, { span: 42, run: 'runA', message: 'from A' }),
      row(2, { span: 42, run: 'runB', message: 'from B' }),
    ])

    expect(groups).toHaveLength(2)
    expect(groups.map((g) => g.run)).toEqual(['runA', 'runB'])
    expect(groups[0]!.key).not.toBe(groups[1]!.key)
  })

  it('reports the worst level in the group', () => {
    const groups = groupSpans([
      row(1, { span: 10, level: 'INFO' }),
      row(2, { span: 10, level: 'ERROR' }),
      row(3, { span: 10, level: 'WARN' }),
    ])
    expect(groups[0]!.level).toBe('ERROR')
  })

  it('picks up request shape from whichever line carries it', () => {
    const groups = groupSpans([
      row(1, { span: 10, message: 'http request' }),
      row(2, {
        span: 10,
        message: 'Sent HTTP response',
        fields: {
          'http.method': 'GET',
          'http.url': '/api/event',
          'http.status': '200',
          durationMs: '95',
        },
      }),
    ])
    expect(groups[0]).toMatchObject({
      method: 'GET',
      url: '/api/event',
      status: '200',
      durationMs: 95,
    })
  })

  it('falls back to the unprefixed method and status keys', () => {
    // `mcp http request failed` uses `method=` and `status.status=`.
    const groups = groupSpans([
      row(1, {
        span: 7,
        message: 'mcp http request failed',
        fields: { method: 'POST' },
      }),
      row(2, {
        span: 7,
        message: 'mcp connect failed',
        fields: { 'status.status': 'failed' },
      }),
    ])
    expect(groups[0]).toMatchObject({ method: 'POST', status: 'failed' })
  })

  it('orders groups by their first sequence', () => {
    const groups = groupSpans([
      row(5, { span: 2 }),
      row(1, { span: 1 }),
      row(3, { span: 1 }),
    ])
    expect(groups.map((g) => g.span)).toEqual([1, 2])
  })
})

describe('summariseSpans', () => {
  it('counts shape, multi-line and failed spans', () => {
    const groups = groupSpans([
      row(1, { span: 1, fields: { 'http.method': 'GET' } }),
      row(2, { span: 1 }),
      row(3, { span: 2, level: 'ERROR' }),
      row(4, { span: 3, fields: { durationMs: '250' } }),
      row(5, { span: 4, fields: { durationMs: '40' } }),
    ])
    expect(summariseSpans(groups)).toEqual({
      total: 4,
      withShape: 1,
      multi: 1,
      failed: 1,
      slowest: 250,
    })
  })

  it('reports no slowest when nothing has a duration', () => {
    expect(summariseSpans(groupSpans([row(1, { span: 1 })])).slowest).toBeNull()
  })
})

describe('groupProblems', () => {
  const rows = [
    row(1, { level: 'INFO', message: 'fine' }),
    row(2, { level: 'WARN', message: 'slow request', fields: { cause: 'timeout' } }),
    row(3, { level: 'ERROR', message: 'fetch failed', fields: { cause: 'Transport error' } }),
    row(4, { level: 'WARN', message: 'slow request', fields: { cause: 'timeout' } }),
    row(5, { level: 'ERROR', message: 'fetch failed', fields: { cause: 'Transport error' } }),
  ]

  it('excludes INFO, which is not a problem', () => {
    expect(
      groupProblems(rows, 'newest').every((g) => g.level !== 'INFO'),
    ).toBe(true)
  })

  it('keeps one entry per occurrence, newest first', () => {
    const groups = groupProblems(rows, 'newest')
    expect(groups).toHaveLength(4)
    expect(groups.map((g) => g.lastSeq)).toEqual([5, 4, 3, 2])
  })

  it('collapses repeats by message with a count', () => {
    const groups = groupProblems(rows, 'message')
    expect(groups).toHaveLength(2)
    const slow = groups.find((g) => g.message === 'slow request')
    expect(slow?.count).toBe(2)
    expect(slow?.level).toBe('WARN')
  })

  it('lets an ERROR in a group win over a WARN', () => {
    const mixed = [
      row(1, { level: 'WARN', message: 'same', run: 'r' }),
      row(2, { level: 'ERROR', message: 'same', run: 'r' }),
    ]
    expect(groupProblems(mixed, 'message')[0]!.level).toBe('ERROR')
  })

  it('groups by cause and by run', () => {
    expect(groupProblems(rows, 'cause').map((g) => g.cause)).toEqual([
      'Transport error',
      'timeout',
    ])
    const byRun = groupProblems(
      [row(1, { level: 'WARN', run: 'r1' }), row(2, { level: 'WARN', run: 'r2' })],
      'run',
    )
    expect(byRun.map((g) => g.run).sort()).toEqual(['r1', 'r2'])
  })

  it('keeps the longest cause for a group', () => {
    const groups = groupProblems(
      [
        row(1, { level: 'ERROR', message: 'm', fields: { cause: 'short' } }),
        row(2, { level: 'ERROR', message: 'm', fields: { cause: 'a much longer cause' } }),
      ],
      'message',
    )
    expect(groups[0]!.cause).toBe('a much longer cause')
  })

  it('keeps the underlying lines so a group can be expanded', () => {
    const groups = groupProblems(rows, 'message')
    expect(groups.flatMap((g) => g.lines)).toHaveLength(4)
  })

  it('preserves group order deterministically when counts tie', () => {
    const a = groupProblems(rows, 'message')
    const b = groupProblems(rows, 'message')
    expect(a.map((g) => g.key)).toEqual(b.map((g) => g.key))
  })

  it('does not mutate its input', () => {
    const source = shallowRef(rows.map((r) => r))
    const before = source.value.map((r) => r.seq)
    groupProblems(source.value, 'newest')
    expect(source.value.map((r) => r.seq)).toEqual(before)
  })

  it('works from a reactive source without caching', () => {
    const source = ref(rows)
    const first = groupProblems(source.value, 'message').length
    source.value = [...source.value, row(6, { level: 'ERROR', message: 'new one' })]
    expect(first).toBe(2)
    expect(groupProblems(source.value, 'message')).toHaveLength(3)
  })
})
