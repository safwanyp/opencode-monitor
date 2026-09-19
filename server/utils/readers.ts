/**
 * The Explorer A reader: one file tailer, one ring buffer, one event emitter.
 *
 * Everything lives on `globalThis` on purpose. Nitro plugins re-run on dev
 * reload, and a second tailer would produce duplicate rows that look like a
 * parser or UI bug rather than a lifecycle bug. The guard is the fix, and
 * `startCount` exists so the duplication can be *proven* absent rather than
 * assumed.
 */

import { EventEmitter } from 'node:events'
import type { TailBatch, TailerEvent } from './tailer'

import type { HealthResponse, SourceHealth } from '#shared/types/health'
import type { LogRecord } from '#shared/types/records'
import { tryParseLogfmt, toLogRecord } from '#shared/utils/logfmt'

import { resolveActiveLogPath } from './discovery'
import { createRingBuffer, type RingBuffer } from './ring-buffer'
import { LogTailer } from './tailer'

/** 20k records, per the design's starting point; measured before raising it. */
const RING_CAPACITY = 20_000

/** Dev-only progress line so the reader can be observed while running. */
const REPORT_INTERVAL_MS = 30_000

const GLOBAL_KEY = '__opencodeMonitorReaders'

export interface ReaderStats {
  /** Records read in the initial backfill, before live traffic. */
  backfillRecords: number
  records: number
  parseFailures: number
  /** Offsets that did not advance. Any non-zero value is a real bug. */
  duplicateOffsets: number
  lastBatchAt: number | null
}

export interface ReadersState {
  buffer: RingBuffer<LogRecord>
  events: EventEmitter
  tailer: LogTailer | null
  started: boolean
  startCount: number
  logPath: string | null
  stats: ReaderStats
}

function createState(): ReadersState {
  return {
    buffer: createRingBuffer<LogRecord>(RING_CAPACITY),
    events: new EventEmitter(),
    tailer: null,
    started: false,
    startCount: 0,
    logPath: null,
    stats: {
      backfillRecords: 0,
      records: 0,
      parseFailures: 0,
      duplicateOffsets: 0,
      lastBatchAt: null,
    },
  }
}

/** The single, process-wide reader state. */
export function getReaders(): ReadersState {
  const global = globalThis as typeof globalThis & {
    [GLOBAL_KEY]?: ReadersState
  }
  if (!global[GLOBAL_KEY]) global[GLOBAL_KEY] = createState()
  return global[GLOBAL_KEY]
}

/** Tracks the last emitted offset so a non-advancing reader is visible. */
interface OffsetGuard {
  generation: number
  offset: number
}

const guards = new WeakMap<ReadersState, OffsetGuard>()

function acceptBatch(state: ReadersState, batch: TailBatch): void {
  const guard = guards.get(state) ?? { generation: 0, offset: -1 }

  for (const { line, offset } of batch.lines) {
    if (line.length === 0) continue

    // The tailer must never re-emit a byte range. If it does, every downstream
    // symptom is a duplicate row, so catch it at the source.
    if (guard.generation === batch.generation && offset <= guard.offset) {
      state.stats.duplicateOffsets++
      continue
    }
    guard.generation = batch.generation
    guard.offset = offset

    const parsed = tryParseLogfmt(line)
    if (!parsed.ok) {
      state.stats.parseFailures++
      continue
    }

    const id = `${batch.path}:${batch.generation}:${offset}`
    const record = toLogRecord(parsed.fields, id)
    const seq = state.buffer.push(record)
    state.stats.records++
    state.events.emit('record', { seq, record })
  }

  guards.set(state, guard)
  state.stats.lastBatchAt = Date.now()
}

function deriveLogHealth(state: ReadersState): SourceHealth {
  if (!state.tailer) {
    return { status: 'paused' }
  }

  const { lastBatchAt, records, parseFailures } = state.stats
  const age = lastBatchAt ? Date.now() - lastBatchAt : null

  const parts: string[] = [`${records.toLocaleString('en-US')} records`]
  if (age !== null) parts.push(`last write ${formatAge(age)} ago`)
  if (parseFailures > 0) parts.push(`${parseFailures} unparsed`)

  return {
    status: 'following',
    detail: parts.join(' · '),
  }
}

function formatAge(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  return `${Math.round(minutes / 60)}h`
}

export function getHealth(): HealthResponse {
  const state = getReaders()
  return {
    log: deriveLogHealth(state),
    // Explorer B is wired in Phase 6 and reports honestly until then.
    api: { status: 'unknown', detail: 'not wired yet' },
  }
}

export function getStats(): ReaderStats & { bufferSize: number; latestSeq: number } {
  const state = getReaders()
  return {
    ...state.stats,
    bufferSize: state.buffer.size(),
    latestSeq: state.buffer.latestSeq(),
  }
}

/**
 * Start the reader. Idempotent: a re-run reports and returns.
 */
export async function startReaders(): Promise<void> {
  const state = getReaders()
  state.startCount++

  if (state.started) {
    console.info(
      `[readers] plugin run #${state.startCount}: already started, not creating a second reader`,
    )
    return
  }

  state.started = true
  const logPath = resolveActiveLogPath()
  state.logPath = logPath

  let rotations = 0
  let backfillReported = false

  const tailer = new LogTailer({
    path: logPath,
    onBatch: (batch) => acceptBatch(state, batch),
    onEvent: (event: TailerEvent) => {
      if (event.kind === 'error') {
        console.warn(
          `[readers] ${event.kind} on ${event.path}: ${event.detail ?? ''}`,
          event.error ?? '',
        )
        return
      }

      if (event.kind === 'caught-up') {
        // Only the first catch-up is the initial backfill; later ones are just
        // the reader having drained live traffic.
        if (backfillReported) return
        backfillReported = true
        state.stats.backfillRecords = state.stats.records
        console.info(
          `[readers] backfill complete: ${state.stats.records.toLocaleString('en-US')} records from ${tailer.stats.bytes.toLocaleString('en-US')} bytes (${tailer.stats.skippedBytes} skipped to the first newline)`,
        )
        return
      }

      if (event.kind === 'rotation') rotations++
      console.info(
        `[readers] ${event.kind} on ${event.path} (generation ${event.generation}) ${event.detail ?? ''}`,
      )
    },
  })
  state.tailer = tailer

  console.info(`[readers] tailing ${logPath}`)

  await tailer.start()

  if (process.env['NODE_ENV'] !== 'production') {
    const timer = setInterval(() => {
      const { records, parseFailures, duplicateOffsets } = state.stats
      console.info(
        `[readers] buffer ${state.buffer.size().toLocaleString('en-US')}/${RING_CAPACITY.toLocaleString('en-US')} · ${records.toLocaleString('en-US')} records total · ${parseFailures} unparsed · ${duplicateOffsets} duplicate offsets · ${rotations} rotations`,
      )
    }, REPORT_INTERVAL_MS)
    timer.unref?.()
  }
}

export function stopReaders(): void {
  const state = getReaders()
  state.tailer?.stop()
  state.tailer = null
  state.started = false
}
