import type { LogRecord } from '#shared/types/records'

/**
 * Explorer A data: backfill the ring buffer, then follow the live stream.
 *
 * Two decisions worth knowing:
 *
 * - The backfill and the stream share one cursor. The UI never asks for the
 *   same records twice and never leaves a hole between the historical window
 *   and the live tail.
 * - `rows` is a `shallowRef` and updates are flushed once per frame. Deep
 *   reactivity over 20,000 records would cost far more than the render, and a
 *   burst of log lines would otherwise cause one re-render per line.
 */

export interface LogRow {
  seq: number
  record: LogRecord
}

export type ConnectionState = 'connecting' | 'live' | 'reconnecting' | 'error'

/** Matches the server's ring capacity, so the client never holds more. */
const MAX_ROWS = 20_000

/** Drop this many at once when trimming, so trimming is not per-append. */
const TRIM_CHUNK = 2_000

const BACKFILL_PAGE = 2_000

/** 20k of buffer at 2k a page, plus slack. */
const MAX_BACKFILL_PAGES = 12

function scheduleFrame(task: () => void): void {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => task())
    return
  }
  setTimeout(task, 16)
}

export function useLogStream() {
  // `shallowRef` + explicit triggers: records are immutable once parsed.
  const rows = shallowRef<LogRow[]>([])
  const connection = ref<ConnectionState>('connecting')
  const errorMessage = ref<string | null>(null)

  const newestSeq = ref(0)
  const oldestSeq = ref(0)
  const bufferSize = ref(0)

  /** Follow means "keep the newest record in view". Pausing never drops data. */
  const following = ref(true)
  const unseen = ref(0)

  let source: EventSource | null = null
  let pending: LogRow[] = []
  let frameScheduled = false

  function flush() {
    frameScheduled = false
    if (pending.length === 0) return

    const batch = pending
    pending = []

    const next = rows.value.concat(batch)
    if (next.length > MAX_ROWS) next.splice(0, next.length - MAX_ROWS + TRIM_CHUNK)

    rows.value = next
    const last = next[next.length - 1]
    if (last) newestSeq.value = last.seq
    if (!following.value) unseen.value += batch.length
    triggerRef(rows)
  }

  function enqueue(incoming: LogRow[]) {
    if (incoming.length === 0) return
    pending.push(...incoming)
    if (frameScheduled) return
    frameScheduled = true
    scheduleFrame(flush)
  }

  function closeStream() {
    source?.close()
    source = null
  }

  function openStream(after: number) {
    closeStream()

    // EventSource rather than fetch+ReadableStream: this endpoint is our own
    // and needs no custom headers, so the browser's reconnect handling is a
    // feature. (The *upstream* OpenCode stream needs an auth header, which is
    // why that one cannot use EventSource — design §12.)
    const es = new EventSource(
      `/api/logs/stream?after=${encodeURIComponent(String(after))}`,
    )
    source = es

    es.addEventListener('open', () => {
      connection.value = 'live'
      errorMessage.value = null
    })

    es.addEventListener('record', (event) => {
      enqueue([JSON.parse((event as MessageEvent<string>).data) as LogRow])
    })

    es.addEventListener('error', () => {
      // Let EventSource retry; it reconnects with the same cursor, so there is
      // no gap. Report the state rather than tearing it down and racing it.
      if (es.readyState === EventSource.CLOSED) {
        connection.value = 'error'
        errorMessage.value = 'stream closed'
      } else {
        connection.value = 'reconnecting'
      }
    })
  }

  async function load() {
    connection.value = 'connecting'
    errorMessage.value = null

    try {
      // Fetch the whole retained window, paged. Fetching only the newest page
      // would make the list and the facet counts describe different sets of
      // records, which reads as a bug.
      const collected: LogRow[] = []
      let cursor = 0
      let oldest = 0
      let latest = 0
      let size = 0

      for (let page = 0; page < MAX_BACKFILL_PAGES; page++) {
        const response = await $fetch<{
          records: LogRow[]
          oldestSeq: number
          latestSeq: number
          size: number
        }>('/api/logs/records', {
          query: { after: cursor, limit: BACKFILL_PAGE },
        })

        oldest = response.oldestSeq
        latest = response.latestSeq
        size = response.size

        if (response.records.length === 0) break
        collected.push(...response.records)

        const last = response.records[response.records.length - 1]
        if (!last) break
        cursor = last.seq

        const caughtUp =
          collected.length >= size || response.records.length < BACKFILL_PAGE
        if (caughtUp || collected.length >= MAX_ROWS) break
      }

      rows.value = collected
      triggerRef(rows)

      oldestSeq.value = oldest
      bufferSize.value = size
      newestSeq.value = latest
      unseen.value = 0

      openStream(latest)
    } catch (error) {
      connection.value = 'error'
      errorMessage.value =
        error instanceof Error ? error.message : 'backfill failed'
    }
  }

  function follow() {
    following.value = true
    unseen.value = 0
  }

  function pause() {
    following.value = false
  }

  function toggleFollow() {
    if (following.value) pause()
    else follow()
  }

  onMounted(() => void load())
  onBeforeUnmount(closeStream)

  return {
    rows,
    connection,
    errorMessage,
    newestSeq,
    oldestSeq,
    bufferSize,
    following,
    unseen,
    follow,
    pause,
    toggleFollow,
    reload: load,
  }
}
