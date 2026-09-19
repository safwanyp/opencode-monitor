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
