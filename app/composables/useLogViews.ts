import type { LogLevel } from '#shared/types/records'

import type { LogRow } from './useLogStream'

/**
 * Spans and Problems grouping.
 *
 * Both are pure functions over the rows the client already holds: the retained
 * window is at most 20k records, so grouping it is cheap and keeping it on the
 * client means the views cannot disagree with the stream about what a record is.
 *
 * ## Spans are keyed by (run, span), not span
 *
 * The design says "group by `http.span`". Measured against the live log, that is
 * wrong: 43 of 896 distinct span values appear against more than one `run`, and
 * grouping on the span alone merges unrelated records — a startup burst in one
 * run gets fused with a config reload in another. `http.span` is only unique
 * within a run, so the pair is the real key.
 *
 * ## Most groups are one line
 *
 * In the live window, 786 of 939 (run, span) groups contain a single record and
 * only 20 records carry `http.method`. This log is a startup and plugin log, not
 * an HTTP server log, so the view has to be useful without pretending every span
 * is a request.
 */

const LEVEL_RANK: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
}

export interface SpanGroup {
  key: string
  run?: string
  span: number
  lines: LogRow[]
  /** Worst level in the group, so one ERROR makes the whole span stand out. */
  level: LogLevel
  firstTs: string
  lastTs: string
  firstSeq: number
  lastSeq: number
  /** Request shape, present only when some line carried it. */
  method?: string
  url?: string
  status?: string
  durationMs?: number
  /** Distinct messages, for a summary when there is no request shape. */
  messages: string[]
}

function field(row: LogRow, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = row.record.fields[name]
    if (value !== undefined && value !== '') return value
  }
  return undefined
}

function worstLevel(rows: LogRow[]): LogLevel {
  let worst: LogLevel = 'DEBUG'
  for (const row of rows) {
    if (LEVEL_RANK[row.record.level] > LEVEL_RANK[worst]) worst = row.record.level
  }
  return worst
}

/**
 * Group spans. Only records that carry a span are included; records without one
 * are not part of any request and belong in the stream view.
 */
export function groupSpans(rows: LogRow[]): SpanGroup[] {
  const groups = new Map<string, SpanGroup>()

  for (const row of rows) {
    const span = row.record.span
    if (span === undefined) continue

    const run = row.record.run
    const key = `${run ?? '-'}:${span}`
    let group = groups.get(key)

    if (!group) {
      group = {
        key,
        run,
        span,
        lines: [],
        level: 'DEBUG',
        firstTs: row.record.ts,
        lastTs: row.record.ts,
        firstSeq: row.seq,
        lastSeq: row.seq,
        messages: [],
      }
      groups.set(key, group)
    }

    group.lines.push(row)
    group.lastTs = row.record.ts
    group.lastSeq = row.seq
  }

  for (const group of groups.values()) {
    group.level = worstLevel(group.lines)
    group.messages = [...new Set(group.lines.map((l) => l.record.message))]

    // Request shape comes from whichever line in the span carries it.
    for (const line of group.lines) {
      group.method ??= field(line, 'http.method', 'method')
      group.url ??= field(line, 'http.url')
      group.status ??= field(line, 'http.status', 'status.status')
      const duration = field(line, 'durationMs', 'duration')
      if (duration !== undefined && group.durationMs === undefined) {
        const parsed = Number.parseInt(duration, 10)
        if (Number.isFinite(parsed)) group.durationMs = parsed
      }
    }
  }

  return [...groups.values()].sort((a, b) => a.firstSeq - b.firstSeq)
}

export type ProblemGrouping = 'newest' | 'message' | 'cause' | 'run'

export interface ProblemGroup {
  key: string
  level: LogLevel
  message: string
  cause?: string
  run?: string
  span?: number
  count: number
  firstSeq: number
  lastSeq: number
  firstTs: string
  lastTs: string
  lines: LogRow[]
}

/**
 * The Problems lane: WARN and ERROR only.
 *
 * `newest` keeps one entry per occurrence, newest first, which is what the build
 * plan specifies. The grouped modes collapse repeats so a message that fired 128
 * times reads as one row with a count.
 */
export function groupProblems(
  rows: LogRow[],
  grouping: ProblemGrouping,
): ProblemGroup[] {
  const problems = rows.filter(
    (row) => row.record.level === 'WARN' || row.record.level === 'ERROR',
  )

  if (grouping === 'newest') {
    return problems
      .map((row) => ({
        key: `seq:${row.seq}`,
        level: row.record.level,
        message: row.record.message,
        cause: row.record.fields['cause'],
        run: row.record.run,
        span: row.record.span,
        count: 1,
        firstSeq: row.seq,
        lastSeq: row.seq,
        firstTs: row.record.ts,
        lastTs: row.record.ts,
        lines: [row],
      }))
      .reverse()
  }

  const groups = new Map<string, ProblemGroup>()

  for (const row of problems) {
    const key =
      grouping === 'message'
        ? row.record.message
        : grouping === 'cause'
          ? (row.record.fields['cause'] ?? '(no cause)')
          : (row.record.run ?? '(no run)')

    let group = groups.get(key)
    if (!group) {
      group = {
        key: `${grouping}:${key}`,
        level: row.record.level,
        message: row.record.message,
        cause: row.record.fields['cause'],
        run: row.record.run,
        span: row.record.span,
        count: 0,
        firstSeq: row.seq,
        lastSeq: row.seq,
        firstTs: row.record.ts,
        lastTs: row.record.ts,
        lines: [],
      }
      groups.set(key, group)
    }

    group.count++
    group.lines.push(row)
    group.lastSeq = row.seq
    group.lastTs = row.record.ts
    // The worst level wins, so a group that ever errored shows as an error.
    if (LEVEL_RANK[row.record.level] > LEVEL_RANK[group.level]) {
      group.level = row.record.level
    }
    // Keep the longest cause in the group: it is the most informative.
    const cause = row.record.fields['cause']
    if (cause && (!group.cause || cause.length > group.cause.length)) {
      group.cause = cause
    }
  }

  return [...groups.values()].sort((a, b) => b.lastSeq - a.lastSeq)
}

/** Summary numbers for the Spans strip. */
export function summariseSpans(groups: SpanGroup[]) {
  const withShape = groups.filter((g) => g.method !== undefined).length
  const multi = groups.filter((g) => g.lines.length > 1).length
  const failed = groups.filter((g) => g.level === 'ERROR').length
  const durations = groups
    .map((g) => g.durationMs)
    .filter((d): d is number => d !== undefined)
  const slowest = durations.length > 0 ? Math.max(...durations) : null

  return { total: groups.length, withShape, multi, failed, slowest }
}

/**
 * Expandable lists are flattened to a single list of rows at one height.
 *
 * An expanded group's lines could be nested inside a taller row, but that means
 * variable heights and a virtualiser that measures. Emitting each line as its
 * own row of the same height keeps the whole list uniform, so the existing
 * windowing works untouched and the expansion is just more rows.
 */
export interface SpanViewItem {
  kind: 'group' | 'line'
  key: string
  group: SpanGroup
  row?: LogRow
}

export function buildSpanItems(
  groups: SpanGroup[],
  expanded: Set<string>,
): SpanViewItem[] {
  const items: SpanViewItem[] = []

  for (const group of groups) {
    items.push({ kind: 'group', key: group.key, group })
    if (!expanded.has(group.key)) continue
    for (const row of group.lines) {
      items.push({ kind: 'line', key: `${group.key}:${row.seq}`, group, row })
    }
  }

  return items
}

export interface ProblemViewItem {
  kind: 'group' | 'line'
  key: string
  group: ProblemGroup
  row?: LogRow
}

export function buildProblemItems(
  groups: ProblemGroup[],
  expanded: Set<string>,
): ProblemViewItem[] {
  const items: ProblemViewItem[] = []

  for (const group of groups) {
    items.push({ kind: 'group', key: group.key, group })
    if (!expanded.has(group.key)) continue
    for (const row of group.lines) {
      items.push({ kind: 'line', key: `${group.key}:${row.seq}`, group, row })
    }
  }

  return items
}
