/**
 * Display formatting shared by both explorers.
 *
 * Pure and separate so the shapes the UI promises — money, token counts, relative
 * time — can be asserted rather than eyeballed.
 */

/** Sub-dollar costs need more precision than dollar costs to be meaningful. */
export function formatCost(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '—'
  if (value === 0) return '$0'
  if (value < 1) return `$${value.toFixed(4)}`
  if (value < 10) return `$${value.toFixed(3)}`
  return `$${value.toFixed(2)}`
}

export function formatTokens(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '—'
  if (value < 1_000) return String(value)
  if (value < 1_000_000) return `${(value / 1_000).toFixed(1)}k`
  return `${(value / 1_000_000).toFixed(1)}M`
}

/** Input plus output. Reasoning is tracked separately and is not billed the same. */
export function billableTokens(tokens: {
  input?: number
  output?: number
} | undefined): number | undefined {
  if (!tokens) return undefined
  const input = tokens.input ?? 0
  const output = tokens.output ?? 0
  return input + output
}

export function formatCount(value: number | undefined): string {
  if (value === undefined) return '—'
  return value.toLocaleString('en-US')
}

export function formatRelative(ts: number | undefined, now = Date.now()): string {
  if (ts === undefined || !Number.isFinite(ts)) return '—'
  const delta = now - ts
  if (delta < 0) return 'now'
  if (delta < 1_000) return 'now'
  const seconds = Math.floor(delta / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

/** Wall-clock with milliseconds, matching the log rows. */
export function formatClock(ts: number | undefined): string {
  if (ts === undefined || !Number.isFinite(ts)) return ''
  const d = new Date(ts)
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`
}

/** Duration in a log-friendly unit. */
export function formatDuration(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) return '—'
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)}s`
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`
}

/**
 * Local calendar day of a timestamp, as `YYYY-MM-DD`.
 *
 * Local rather than UTC on purpose: the user is reading their own machine's log
 * and expects "today" to mean their today.
 */
export function dayKey(ts: string | number | undefined): string | null {
  if (ts === undefined) return null
  const at = typeof ts === 'number' ? ts : Date.parse(ts)
  if (!Number.isFinite(at)) return null
  const d = new Date(at)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const

/**
 * A day separator label, relative where that is clearer.
 *
 * The log window can span several days, and a bare `HH:MM:SS` column cannot tell
 * them apart — so the list states the day whenever it changes.
 */
export function formatDayLabel(
  key: string | null,
  now = Date.now(),
): string {
  if (!key) return 'Unknown date'

  const today = dayKey(now)
  if (key === today) return 'Today'

  const yesterday = dayKey(now - 86_400_000)
  if (key === yesterday) return 'Yesterday'

  const [year, month, day] = key.split('-').map(Number)
  if (!year || !month || !day) return key

  const date = new Date(year, month - 1, day)
  const name = `${DAY_NAMES[date.getDay()]} ${day} ${MONTH_NAMES[month - 1]}`
  // The year only earns its space when it is not the current one.
  return year === new Date(now).getFullYear() ? name : `${name} ${year}`
}

/** Full, unambiguous local timestamp. Used where precision matters. */
export function formatDateTime(ts: string | number | undefined): string {
  if (ts === undefined) return '—'
  const at = typeof ts === 'number' ? ts : Date.parse(ts)
  if (!Number.isFinite(at)) return '—'
  const d = new Date(at)
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  const day = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  return `${day} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`
}

export interface DayMarker {
  kind: 'day'
  key: string
  label: string
}

/**
 * A cursor that yields a marker exactly when the calendar day changes.
 *
 * Every list that shows bare clock times needs this, and every one of them needs
 * it to fire on change rather than per row. Keeping the rule here means the
 * stream, the span list and the problems list cannot disagree about it.
 */
export function createDayCursor(now = Date.now()) {
  let last: string | null = null

  return (ts: string | number | undefined): DayMarker | null => {
    const day = dayKey(ts)
    if (day === null || day === last) return null
    last = day
    return { kind: 'day', key: `day:${day}`, label: formatDayLabel(day, now) }
  }
}
