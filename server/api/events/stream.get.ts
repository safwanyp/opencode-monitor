import type { EventRecord } from '#shared/types/records'

import { parseStreamCursor } from '../../utils/api-params'
import { getEventReader } from '../../utils/event-reader'
import { sseComment, sseEvent } from '../../utils/sse'

const HEARTBEAT_MS = 15_000
const REPLAY_LIMIT = 2_000

/**
 * Live events for Explorer B.
 *
 * `?after=<seq>` resumes from a cursor. `durable.seq` orders the upstream stream
 * and is the only thing that can resume it — it is not a history mechanism, so
 * the buffer is what fills a gap and the cursor is what prevents one.
 *
 * Events without a durable sequence (the upstream's own `server.connected`) get
 * no `id:` field, because the SSE id is the resume cursor and a made-up one would
 * silently resume from the wrong place.
 */
export default defineEventHandler((event) => {
  const reader = getEventReader()
  const cursor = parseStreamCursor(
    getQuery(event) as Record<string, unknown>,
    reader.buffer.latestSeq(),
  )

  setResponseHeaders(event, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })

  const encoder = new TextEncoder()
  let heartbeat: NodeJS.Timeout | undefined
  let listener: ((payload: { seq: number; record: EventRecord }) => void) | undefined
  let closed = false

  function close() {
    if (closed) return
    closed = true
    if (heartbeat) clearInterval(heartbeat)
    if (listener) reader.events.off('event', listener)
    heartbeat = undefined
    listener = undefined
  }

  function frame(seq: number, record: EventRecord): string {
    const payload = JSON.stringify({ seq, event: record })
    return record.seq === undefined
      ? sseEvent({ event: 'event', data: payload })
      : sseEvent({ id: seq, event: 'event', data: payload })
  }

  return new ReadableStream<Uint8Array>({
    start(controller) {
      function write(chunk: string) {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(chunk))
        } catch {
          close()
        }
      }

      write(sseComment('connected'))

      for (const entry of reader.buffer.after(cursor, REPLAY_LIMIT)) {
        write(frame(entry.seq, entry.value))
      }

      listener = ({ seq, record }) => write(frame(seq, record))
      reader.events.on('event', listener)

      heartbeat = setInterval(() => {
        write(sseComment(`heartbeat ${Date.now()}`))
      }, HEARTBEAT_MS)
      heartbeat.unref?.()

      event.node.res.on('close', close)
    },

    cancel() {
      close()
    },
  })
})
