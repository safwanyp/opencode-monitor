/**
 * Byte-offset log tailer.
 *
 * Reads forward from an offset and emits only whole lines. Three invariants
 * matter, and each one is a bug if broken:
 *
 *   1. Never emit a partial trailing line. A line is emitted only once its
 *      terminating newline has been read, so a read that lands mid-write cannot
 *      produce a truncated record.
 *   2. Never emit the same bytes twice. `offset` only ever moves forward, except
 *      when the file was truncated or replaced, which resets it deliberately and
 *      bumps the generation so ids do not collide across the reset.
 *   3. Never block the event loop. Work is bounded per pump; when more remains,
 *      the pump is rescheduled rather than looped.
 *
 * Offsets are byte offsets, not character offsets. The file is read as Buffers
 * and each line is decoded individually, so a multi-byte character spanning a
 * read boundary is never split — newline is ASCII and cannot occur inside a
 * UTF-8 sequence, so decoding newline-delimited slices is always safe.
 *
 * The watch is on the *directory*, not the file, because watching a file breaks
 * when rotation replaces it. A poll runs alongside as a safety net: `fs.watch`
 * is unreliable on macOS under rapid writes.
 */

import { watch, type FSWatcher } from 'node:fs'
import { open, stat } from 'node:fs/promises'
import { dirname } from 'node:path'

const NEWLINE = 0x0a

export interface TailLine {
  line: string
  /** Byte offset of the first character of the line. */
  offset: number
}

export interface TailBatch {
  /** Increments on truncation or rotation. Combine with `offset` for a stable id. */
  generation: number
  path: string
  lines: TailLine[]
}

export type TailerEventKind = 'rotation' | 'truncation' | 'caught-up' | 'error'

export interface TailerEvent {
  kind: TailerEventKind
  path: string
  generation: number
  detail?: string
  error?: unknown
}

export interface TailerStats {
  batches: number
  lines: number
  bytes: number
  rotations: number
  truncations: number
  errors: number
  /** Bytes discarded to reach the first newline when starting mid-file. */
  skippedBytes: number
  /** Pumps that hit the byte budget and rescheduled. */
  deferredPumps: number
  lastReadAt: number | null
}

export interface TailerOptions {
  path: string
  /**
   * How far back from EOF to begin, applied only to the first read.
   *
   * `Infinity` reads the file from the start, which is what tests want; the app
   * uses the default so a 39 MB file is not read in full on boot.
   */
  startBytesBack?: number
  /**
   * Backpressure: the most this tailer will read in a single pump. A larger
   * backlog is spread across pumps so the event loop keeps turning.
   */
  maxBytesPerPump?: number
  /**
   * Safety-net poll interval, because fs.watch is unreliable on macOS under
   * rapid writes. This bounds worst-case detection latency; see the note on
   * `DEFAULT_POLL_INTERVAL_MS`.
   */
  pollIntervalMs?: number
  onBatch: (batch: TailBatch) => void
  onEvent?: (event: TailerEvent) => void
}

const DEFAULT_START_BYTES_BACK = 2 * 1024 * 1024
const DEFAULT_MAX_BYTES_PER_PUMP = 256 * 1024
/**
 * Safety-net poll interval.
 *
 * This is also the worst-case detection latency whenever `fs.watch` drops or
 * coalesces an event, which macOS does under rapid writes. Measured with
 * `fs.watch` working, detection is ~13ms; with it silent, detection is bounded
 * by this value. 250ms keeps the worst case comfortably inside the ~1s budget
 * for a cost of four `stat` calls a second.
 */
const DEFAULT_POLL_INTERVAL_MS = 250

/** Guards against a pathological reschedule loop while draining. */
const MAX_PUMPS_PER_DRAIN = 512

export class LogTailer {
  readonly path: string
  readonly stats: TailerStats = {
    batches: 0,
    lines: 0,
    bytes: 0,
    rotations: 0,
    truncations: 0,
    errors: 0,
    skippedBytes: 0,
    deferredPumps: 0,
    lastReadAt: null,
  }

  private readonly directory: string
  private readonly startBytesBack: number
  private readonly maxBytesPerPump: number
  private readonly pollIntervalMs: number
  private readonly onBatch: TailerOptions['onBatch']
  private readonly onEvent: TailerOptions['onEvent']

  private offset = 0
  private generation = 1
  private pending: Buffer = Buffer.alloc(0)
  private pendingStart = 0
  private ino: number | null = null
  private primed = false
  private skipToFirstNewline = false

  private pumping = false
  private rerunRequested = false
  private stopped = false
  private drainCount = 0
  /** Bytes read as of the last 'caught-up' emit, so it fires once per catch-up. */
  private caughtUpAt = -1
  private watcher: FSWatcher | null = null
  private timer: NodeJS.Timeout | null = null

  constructor(options: TailerOptions) {
    this.path = options.path
    this.directory = dirname(options.path)
    this.startBytesBack = options.startBytesBack ?? DEFAULT_START_BYTES_BACK
    this.maxBytesPerPump = options.maxBytesPerPump ?? DEFAULT_MAX_BYTES_PER_PUMP
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
    this.onBatch = options.onBatch
    this.onEvent = options.onEvent
  }

  /** Begin watching. Idempotent; calling twice does not start two watchers. */
  async start(): Promise<void> {
    if (this.watcher || this.timer) return
    this.stopped = false

    try {
      this.watcher = watch(this.directory, () => {
        void this.pump()
      })
    } catch (error) {
      this.emit({ kind: 'error', detail: 'directory watch failed', error })
    }

    this.timer = setInterval(() => {
      void this.pump()
    }, this.pollIntervalMs)
    // Do not hold the process open just for the poll.
    this.timer.unref?.()

    await this.pump()
  }

  stop(): void {
    this.stopped = true
    this.watcher?.close()
    this.watcher = null
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /**
   * Read up to one byte budget, rescheduling if there is more.
   *
   * Exposed (and safe to call concurrently) so tests can drive it directly
   * rather than waiting on `fs.watch`.
   */
  async pump(): Promise<void> {
    if (this.pumping) {
      this.rerunRequested = true
      return
    }

    this.pumping = true
    let deferred = false

    try {
      let budget = this.maxBytesPerPump
      while (!this.stopped) {
        const result = await this.readOnce(budget)

        // readOnce reports zero bytes only when there is nothing to read, so
        // this also guards against a spin if a read ever comes back empty.
        if (result.bytes === 0) {
          this.drainCount = 0
          break
        }

        budget -= result.bytes
        if (!result.more) {
          this.drainCount = 0
          break
        }
        if (budget <= 0) {
          // Consumed the whole budget and there is still more. Reschedule
          // rather than loop, so a large backfill cannot starve the loop.
          deferred = true
          break
        }
      }

      // Emitted once per catch-up, so a caller can tell "the initial backfill
      // finished" from "one pump finished". Without this the backfill looks
      // like whatever the first 256 KB happened to contain.
      if (!this.stopped && !deferred && this.stats.bytes !== this.caughtUpAt) {
        this.caughtUpAt = this.stats.bytes
        this.emit({ kind: 'caught-up' })
      }

      if (deferred) {
        this.stats.deferredPumps++
        this.drainCount++
        if (this.drainCount > MAX_PUMPS_PER_DRAIN) {
          this.emit({
            kind: 'error',
            detail: `gave up draining after ${MAX_PUMPS_PER_DRAIN} pumps; will resume on the next poll`,
          })
          this.drainCount = 0
          deferred = false
        }
      }
    } catch (error) {
      this.stats.errors++
      this.emit({ kind: 'error', detail: 'pump failed', error })
    } finally {
      this.pumping = false
      if ((this.rerunRequested || deferred) && !this.stopped) {
        this.rerunRequested = false
        // Yield before re-entering so the event loop is never starved.
        setImmediate(() => {
          void this.pump()
        })
      }
    }
  }

  /** @returns bytes read, and whether more is likely available. */
  private async readOnce(
    budget: number,
  ): Promise<{ bytes: number; more: boolean }> {
    let size: number
    let ino: number

    try {
      const info = await stat(this.path)
      size = info.size
      ino = info.ino
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        // Mid-rotation: the path is briefly absent. The poll retries.
        return { bytes: 0, more: false }
      }
      throw error
    }

    if (!this.primed) {
      this.primed = true
      this.ino = ino
      this.offset = Math.max(0, size - this.startBytesBack)
      this.pendingStart = this.offset
      this.skipToFirstNewline = this.offset > 0
    } else if (ino !== this.ino) {
      // Replaced by rotation. The archive it was renamed to is not parsed.
      this.generation++
      this.stats.rotations++
      this.ino = ino
      this.offset = 0
      this.pending = Buffer.alloc(0)
      this.pendingStart = 0
      this.skipToFirstNewline = false
      this.emit({ kind: 'rotation', detail: 'file replaced' })
    } else if (size < this.offset) {
      this.generation++
      this.stats.truncations++
      this.offset = 0
      this.pending = Buffer.alloc(0)
      this.pendingStart = 0
      this.skipToFirstNewline = false
      this.emit({ kind: 'truncation', detail: `size ${size} < offset` })
    }

    if (size <= this.offset) return { bytes: 0, more: false }

    const length = Math.min(budget, size - this.offset)
    const chunk = await this.readAt(this.offset, length)
    if (chunk.length === 0) return { bytes: 0, more: false }

    this.process(chunk)
    this.offset += chunk.length
    this.stats.bytes += chunk.length
    this.stats.lastReadAt = Date.now()

    return { bytes: chunk.length, more: this.offset < size }
  }

  private async readAt(position: number, length: number): Promise<Buffer> {
    const handle = await open(this.path, 'r')
    try {
      const buffer = Buffer.allocUnsafe(length)
      const { bytesRead } = await handle.read(buffer, 0, length, position)
      return bytesRead === length ? buffer : buffer.subarray(0, bytesRead)
    } finally {
      await handle.close()
    }
  }

  /**
   * Split a chunk into whole lines, carrying any trailing partial line forward.
   *
   * Maintains `pendingStart + pending.length === offset` at all times.
   */
  private process(chunk: Buffer): void {
    const hadPending = this.pending.length > 0
    let buffer = hadPending ? Buffer.concat([this.pending, chunk]) : chunk
    let bufferStart = hadPending ? this.pendingStart : this.offset

    if (this.skipToFirstNewline) {
      const firstNewline = buffer.indexOf(NEWLINE)
      if (firstNewline === -1) {
        // Still inside the partial line we joined. Keep skipping.
        this.stats.skippedBytes += buffer.length
        this.pending = buffer
        this.pendingStart = bufferStart
        return
      }
      this.stats.skippedBytes += firstNewline + 1
      buffer = buffer.subarray(firstNewline + 1)
      bufferStart += firstNewline + 1
      this.skipToFirstNewline = false
    }

    const lastNewline = buffer.lastIndexOf(NEWLINE)
    if (lastNewline === -1) {
      // No complete line yet. Hold everything back.
      this.pending = buffer
      this.pendingStart = bufferStart
      return
    }

    const complete = buffer.subarray(0, lastNewline)
    this.pending = buffer.subarray(lastNewline + 1)
    this.pendingStart = bufferStart + lastNewline + 1

    const lines: TailLine[] = []
    let lineStart = 0
    for (let i = 0; i <= complete.length; i++) {
      if (i === complete.length || complete[i] === NEWLINE) {
        lines.push({
          line: complete.toString('utf8', lineStart, i),
          offset: bufferStart + lineStart,
        })
        lineStart = i + 1
      }
    }

    if (lines.length === 0) return

    this.stats.batches++
    this.stats.lines += lines.length
    this.onBatch({ generation: this.generation, path: this.path, lines })
  }

  private emit(event: Omit<TailerEvent, 'path' | 'generation'>): void {
    this.onEvent?.({
      ...event,
      path: this.path,
      generation: this.generation,
    })
  }
}
