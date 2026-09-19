import { computed, ref } from 'vue'
import type { ShallowRef } from 'vue'

import type { LogLevel, LogRole } from '#shared/types/records'
import type { LogFacetsResponse } from '#shared/types/logs'
import { HEARTBEAT_MESSAGES } from '#shared/utils/noise'

import type { LogRow } from './useLogStream'

export interface TimeRangeOption {
  label: string
  ms: number | null
}

export const TIME_RANGES: TimeRangeOption[] = [
  { label: 'Last 1 min', ms: 60_000 },
  { label: 'Last 5 min', ms: 300_000 },
  { label: 'Last 15 min', ms: 900_000 },
  { label: 'Last hour', ms: 3_600_000 },
  { label: 'Whole buffer', ms: null },
]

export type RoleFilter = 'any' | LogRole

/**
 * Filtering runs entirely on the client.
 *
 * The buffer is at most 20k records and the server already handed them over, so
 * a round trip per keystroke would be slower and would make the filters feel
 * disconnected from the data they describe.
 */
export function useLogFilters(rows: ShallowRef<LogRow[]>) {
  const ALL_LEVELS: LogLevel[] = ['INFO', 'WARN', 'ERROR', 'DEBUG']

  const levels = ref<LogLevel[]>([...ALL_LEVELS])
  const role = ref<RoleFilter>('any')
  const run = ref<string>('any')
  const span = ref('')
  const text = ref('')
  const rangeMs = ref<number | null>(null)
  /** Muted by default; the UI always shows this and it is one click to undo. */
  const muted = ref<string[]>([...HEARTBEAT_MESSAGES])

  /**
   * Full-text haystack per record, built on demand and cached.
   *
   * Only rows that survive the cheap filters ever get one built, and a record's
   * text never changes, so the cost is paid once per row rather than once per
   * keystroke.
   */
  const haystacks = new Map<number, string>()

  function haystack(row: LogRow): string {
    const cached = haystacks.get(row.seq)
    if (cached !== undefined) return cached

    const { record } = row
    const parts: string[] = [
      record.message,
      record.level,
      record.role ?? '',
      record.run ?? '',
      record.span === undefined ? '' : String(record.span),
    ]
    for (const [key, value] of Object.entries(record.fields)) {
      parts.push(key, value)
    }

    const built = parts.join(' ').toLowerCase()
    // Bound the cache so a long session cannot grow without limit.
    if (haystacks.size > 40_000) haystacks.clear()
    haystacks.set(row.seq, built)
    return built
  }

  const visible = computed<LogRow[]>(() => {
    const source = rows.value
    const levelSet = new Set(levels.value)
    const mutedSet = new Set(muted.value)
    const roleValue = role.value
    const runValue = run.value
    const spanValue = span.value.trim()
    const query = text.value.trim().toLowerCase()
    const cutoff =
      rangeMs.value === null ? null : Date.now() - rangeMs.value

    const out: LogRow[] = []

    // Ascending, so the newest record is last — the list reads like `tail -f`
    // and "follow" means scrolling to the bottom.
    for (const row of source) {
      const { record } = row

      if (!levelSet.has(record.level)) continue
      if (roleValue !== 'any' && record.role !== roleValue) continue
      if (runValue !== 'any' && record.run !== runValue) continue
      if (mutedSet.has(record.message)) continue
      if (spanValue !== '' && String(record.span ?? '') !== spanValue) continue

      if (cutoff !== null) {
        const at = Date.parse(record.ts)
        if (Number.isFinite(at) && at < cutoff) continue
      }

      if (query !== '' && !haystack(row).includes(query)) continue

      out.push(row)
    }

    return out
  })

  const filteredOut = computed(() => rows.value.length - visible.value.length)

  const activeFilterCount = computed(() => {
    let count = 0
    if (levels.value.length !== ALL_LEVELS.length) count++
    if (role.value !== 'any') count++
    if (run.value !== 'any') count++
    if (span.value.trim() !== '') count++
    if (text.value.trim() !== '') count++
    if (rangeMs.value !== null) count++
    return count
  })

  function toggleLevel(level: LogLevel) {
    levels.value = levels.value.includes(level)
      ? levels.value.filter((l) => l !== level)
      : [...levels.value, level]
  }

  function setLevels(next: LogLevel[]) {
    levels.value = next
  }

  function toggleMute(message: string) {
    muted.value = muted.value.includes(message)
      ? muted.value.filter((m) => m !== message)
      : [...muted.value, message]
  }

  function unmuteAll() {
    muted.value = []
  }

  function muteAll(messages: string[]) {
    muted.value = [...new Set([...muted.value, ...messages])]
  }

  function reset() {
    levels.value = [...ALL_LEVELS]
    role.value = 'any'
    run.value = 'any'
    span.value = ''
    text.value = ''
    rangeMs.value = null
    muted.value = [...HEARTBEAT_MESSAGES]
  }

  return {
    levels,
    role,
    run,
    span,
    text,
    rangeMs,
    muted,
    visible,
    filteredOut,
    activeFilterCount,
    toggleLevel,
    setLevels,
    toggleMute,
    unmuteAll,
    muteAll,
    reset,
  }
}

/** Whole-buffer facet counts, refreshed occasionally rather than per record. */
export function useLogFacets() {
  const facets = ref<LogFacetsResponse | null>(null)

  async function refresh() {
    try {
      facets.value = await $fetch<LogFacetsResponse>('/api/logs/facets')
    } catch {
      // Keep the last counts rather than blanking the panel.
    }
  }

  onMounted(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), 30_000)
    onBeforeUnmount(() => clearInterval(timer))
  })

  return { facets, refresh }
}
