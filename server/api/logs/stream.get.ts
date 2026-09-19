import type { LogRecord } from '#shared/types/records'

import { parseStreamCursor } from '../../utils/api-params'
import { getReaders } from '../../utils/readers'
import { sseComment, sseRecord } from '../../utils/sse'

/** Heartbeat interval. Keeps the socket alive and lets the client see liveness. */
const HEARTBEAT_MS = 15_000

/**
 * Cap on what a reconnect replays in one go. A client that was away longer than
 * this gets what the buffer still holds; the records endpoint is the way to
 * backfill deliberately.
 */
const REPLAY_LIMIT = 5_000

/**
 * Live records over SSE.
 *
 * `?after=<seq>` resumes from a cursor so a reconnect has no gap. With no
 * cursor the stream starts from the current head: replaying the whole buffer
 * into a fresh connection is a burst the client did not ask for.
 *
 * Events are named `record` and carry `id: <seq>`, so the SSE id field is the
 * cursor the client echoes back. Comments carry heartbeats, which the browser
 * ignores by construction.
 */
export default defineEventHandler((event) => {
  const readers = getReaders()
  const cursor = parseStreamCursor(
    getQuery(event) as Record<string, unknown>,
    readers.buffer.latestSeq(),
  )

  setResponseHeaders(event, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Belt and braces: stop any intermediary from buffering the stream.
    'X-Accel-Buffering': 'no',
  })

  const encoder = new TextEncoder()
  let heartbeat: NodeJS.Timeout | undefined
  let listener: ((payload: { seq: number; record: LogRecord }) => void) | undefined
  let closed = false

  function close() {
    if (closed) return
    closed = true
    if (heartbeat) clearInterval(heartbeat)
    if (listener) readers.events.off('record', listener)
    heartbeat = undefined
    listener = undefined
  }

  return new ReadableStream<Uint8Array>({
    start(controller) {
      function write(chunk: string) {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(chunk))
        } catch {
          // The consumer went away between our check and the write.
          close()
        }
      }

      // A comment first, so a client knows the connection is live before any
      // record arrives.
      write(sseComment('connected'))

      // Resume: whatever the buffer still holds after the cursor.
      for (const entry of readers.buffer.after(cursor, REPLAY_LIMIT)) {
        write(sseRecord(entry.seq, entry.value))
      }

      listener = (payload) => write(sseRecord(payload.seq, payload.record))
      readers.events.on('record', listener)

      heartbeat = setInterval(() => {
        write(sseComment(`heartbeat ${Date.now()}`))
      }, HEARTBEAT_MS)
      heartbeat.unref?.()

      // Node fires 'close' when the client disconnects; without this the
      // listener and interval would outlive the request.
      event.node.res.on('close', close)
    },

    cancel() {
      close()
    },
  })
})
