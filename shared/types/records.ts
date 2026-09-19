/**
 * Normalized records.
 *
 * These shapes are shared by the client and the Nitro server, which is the
 * reason this project uses Nuxt at all: the logfmt parser and the record types
 * are written once and consumed on both sides.
 *
 * Nothing in this file may import Vue or Nitro code.
 */

export type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG'

export type LogRole = 'server' | 'cli'

/**
 * One line of `opencode.log`, normalized.
 *
 * `fields` holds everything that is not one of the promoted keys, so nothing
 * is ever dropped — the detail drawer renders it verbatim.
 */
export interface LogRecord {
  /**
   * Identity for keyed rendering.
   *
   * A line has no natural id, so the reader assigns one. The tailer must pass
   * a byte-offset id (`${file}:${offset}`), which is unique by construction and
   * stable across re-reads. Identical lines in the same millisecond would
   * otherwise collide.
   */
  id: string
  /** ISO-8601 as written in the log. */
  ts: string
  level: LogLevel
  role?: LogRole
  /** Process grouping, e.g. `0cc8cfa0`. */
  run?: string
  /** `http.span` — the request correlation key. */
  span?: number
  message: string
  /** Every remaining key, values preserved verbatim. */
  fields: Record<string, string>
}

/**
 * One event from the upstream OpenCode SSE stream.
 *
 * Explorer B only. The two sources share zero event types, which is why they
 * get separate explorers rather than a union.
 */
export interface EventRecord {
  id: string
  ts: number
  type: string
  sessionID?: string
  directory?: string
  /** `durable.seq` — orders the live stream and drives resume. */
  seq?: number
  data: unknown
  durable?: unknown
}
