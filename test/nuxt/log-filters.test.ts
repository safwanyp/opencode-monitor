import { computed, ref, shallowRef } from 'vue'

import { describe, expect, it } from 'vitest'

import type { LogRow } from '../../app/composables/useLogStream.ts'
import { useLogFilters } from '../../app/composables/useLogFilters.ts'
import { HEARTBEAT_MESSAGES } from '../../shared/utils/noise.ts'

/**
 * Lives under `test/nuxt/` rather than `test/` on purpose.
 *
 * It imports app code, which relies on Nuxt's auto-imported globals. Nuxt's own
 * generated project (`tsconfig.app.json`) covers `test/nuxt/**` and knows those
 * globals; `tsconfig.tools.json` deliberately does not, so that a missing
 * import in `shared/` or `scripts/` cannot hide behind Nuxt's globals.
 */

function row(
  seq: number,
  overrides: Partial<LogRow['record']> = {},
  ageMs = 0,
): LogRow {
  return {
    seq,
    record: {
      id: `log:${seq}`,
      ts: new Date(Date.now() - ageMs).toISOString(),
      level: 'INFO',
      role: 'server',
      run: 'aaa11111',
      message: 'request completed',
      fields: {},
      ...overrides,
    },
  }
}

/** A buffer shaped like the real one: mostly heartbeat noise. */
function sampleRows(): LogRow[] {
  return [
    row(1, { message: 'spawning process', fields: { command: '/bin/zsh' } }),
    row(2, { message: 'watcher subscribe', fields: { path: '/tmp/x' } }),
    row(3, { message: 'request completed', fields: { method: 'GET', status: '200' } }),
    row(4, { message: 'event', fields: { 'event.type': 'file' } }),
    row(5, { message: 'watcher started', role: 'cli' }),
    row(6, {
      level: 'ERROR',
      message: 'Failed to fetch models.dev',
      span: 59500628,
      run: 'bbb22222',
      fields: { cause: 'Transport error' },
    }),
    row(7, { level: 'WARN', message: 'slow request', run: 'bbb22222' }),
  ]
}

function setup(rows: LogRow[] = sampleRows()) {
  const source = shallowRef<LogRow[]>(rows)
  const filters = useLogFilters(source)
  return { source, filters }
}

describe('mute-by-default', () => {
  it('hides the heartbeat messages on first load without the user doing anything', () => {
    const { filters } = setup()

    // This is the Phase 4 exit criterion: noise is silenced by default.
    expect(filters.muted.value).toEqual([...HEARTBEAT_MESSAGES])
    expect(filters.visible.value.map((r) => r.record.message)).toEqual([
      'request completed',
      'Failed to fetch models.dev',
      'slow request',
    ])
  })

  it('counts the hidden records rather than dropping them silently', () => {
    const { filters } = setup()
    expect(filters.filteredOut.value).toBe(4)
  })

  it('reveals everything with one reversible action', () => {
    const { filters } = setup()
    filters.unmuteAll()
    expect(filters.muted.value).toEqual([])
    expect(filters.visible.value).toHaveLength(7)
  })

  it('can mute a single message and keep the earlier ones muted', () => {
    const { filters } = setup()
    filters.toggleMute('slow request')
    expect(filters.muted.value).toContain('slow request')
    expect(filters.visible.value.map((r) => r.record.message)).not.toContain(
      'slow request',
    )
  })

  it('un-mutes a heartbeat message back into the stream', () => {
    const { filters } = setup()
    filters.toggleMute('event')
    expect(filters.visible.value.map((r) => r.record.message)).toContain('event')
  })
})

describe('ordering', () => {
  it('stays ascending so the newest record is last, like tail -f', () => {
    const { filters } = setup()
    filters.unmuteAll()
    const seqs = filters.visible.value.map((r) => r.seq)
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b))
  })
})

describe('filters', () => {
  it('filters by level', () => {
    const { filters } = setup()
    filters.unmuteAll()
    filters.setLevels(['ERROR', 'WARN'])
    expect(filters.visible.value.map((r) => r.record.level)).toEqual([
      'ERROR',
      'WARN',
    ])
  })

  it('shows nothing when every level is unchecked', () => {
    const { filters } = setup()
    filters.setLevels([])
    expect(filters.visible.value).toEqual([])
  })

  it('filters by role', () => {
    const { filters } = setup()
    filters.unmuteAll()
    filters.role.value = 'cli'
    expect(filters.visible.value.map((r) => r.record.role)).toEqual(['cli'])
  })

  it('filters by run', () => {
    const { filters } = setup()
    filters.unmuteAll()
    filters.run.value = 'bbb22222'
    expect(filters.visible.value.map((r) => r.seq)).toEqual([6, 7])
  })

  it('filters by span', () => {
    const { filters } = setup()
    filters.span.value = '59500628'
    expect(filters.visible.value.map((r) => r.seq)).toEqual([6])
  })

  it('finds text in the message', () => {
    const { filters } = setup()
    filters.unmuteAll()
    filters.text.value = 'models.dev'
    expect(filters.visible.value.map((r) => r.seq)).toEqual([6])
  })

  it('finds text in field values', () => {
    const { filters } = setup()
    filters.unmuteAll()
    filters.text.value = 'transport error'
    expect(filters.visible.value.map((r) => r.seq)).toEqual([6])
  })

  it('finds text in field keys', () => {
    const { filters } = setup()
    filters.unmuteAll()
    filters.text.value = 'event.type'
    expect(filters.visible.value.map((r) => r.seq)).toEqual([4])
  })

  it('is case-insensitive and ignores surrounding space', () => {
    const { filters } = setup()
    filters.unmuteAll()
    filters.text.value = '  MODELS.DEV  '
    expect(filters.visible.value.map((r) => r.seq)).toEqual([6])
  })

  it('finds a heartbeat message when it is unmuted and searched for', () => {
    const { filters } = setup()
    filters.unmuteAll()
    filters.text.value = 'watcher'
    expect(filters.visible.value.map((r) => r.seq)).toEqual([2, 5])
  })

  it('combines filters with AND', () => {
    const { filters } = setup()
    filters.unmuteAll()
    filters.role.value = 'server'
    filters.setLevels(['ERROR'])
    expect(filters.visible.value.map((r) => r.seq)).toEqual([6])
  })

  it('excludes records older than the time range', () => {
    const source = shallowRef<LogRow[]>([
      row(1, { message: 'old' }, 10 * 60_000),
      row(2, { message: 'recent' }, 1_000),
    ])
    const filters = useLogFilters(source)

    filters.rangeMs.value = 60_000
    expect(filters.visible.value.map((r) => r.record.message)).toEqual(['recent'])

    filters.rangeMs.value = null
    expect(filters.visible.value).toHaveLength(2)
  })
})

describe('reset', () => {
  it('restores the default view, including the mute list', () => {
    const { filters } = setup()
    filters.unmuteAll()
    filters.setLevels(['ERROR'])
    filters.role.value = 'cli'
    filters.run.value = 'bbb22222'
    filters.text.value = 'zzz'
    filters.span.value = '1'

    filters.reset()

    expect(filters.muted.value).toEqual([...HEARTBEAT_MESSAGES])
    expect(filters.text.value).toBe('')
    expect(filters.span.value).toBe('')
    expect(filters.role.value).toBe('any')
    expect(filters.run.value).toBe('any')
    expect(filters.rangeMs.value).toBeNull()
    expect(filters.visible.value).toHaveLength(3)
  })

  it('reports how many filters are active, so Reset can advertise itself', () => {
    const { filters } = setup()
    expect(filters.activeFilterCount.value).toBe(0)
    filters.role.value = 'cli'
    filters.text.value = 'x'
    expect(filters.activeFilterCount.value).toBe(2)
  })
})

describe('reactivity', () => {
  it('recomputes when new records arrive', () => {
    const { source, filters } = setup()
    expect(filters.visible.value).toHaveLength(3)

    source.value = [...source.value, row(8, { message: 'snapshot written' })]

    expect(filters.visible.value).toHaveLength(4)
    expect(filters.visible.value.at(-1)?.record.message).toBe('snapshot written')
  })

  it('reads live through a derived computed, not a stale snapshot', () => {
    const source = shallowRef<LogRow[]>([row(1, { message: 'keep' })])
    const filters = useLogFilters(source)
    const count = computed(() => filters.visible.value.length)

    expect(count.value).toBe(1)
    source.value = [...source.value, row(2, { message: 'also' })]
    expect(count.value).toBe(2)
  })
})
