import type { EventRecord } from '#shared/types/records'

/**
 * The upstream event stream, as the browser sees it.
 *
 * `EventSource` is fine here — unlike the upstream connection, this one is our
 * own endpoint and needs no auth header. The cursor is `durable.seq`, echoed
 * back as `?after=`, which is what makes a reconnect resume rather than restart.
 */

export interface EventEnvelope {
  seq: number
  event: EventRecord
}

export type EventConnection = 'connecting' | 'live' | 'reconnecting' | 'error'

/** Matches the server's event ring capacity. */
const MAX_EVENTS = 5_000

/** How recent an event must be for a session to count as live. */
export const LIVE_WINDOW_MS = 90_000

function scheduleFrame(task: () => void): void {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => task())
    return
  }
  setTimeout(task, 16)
}

export function useEventStream() {
  const events = shallowRef<EventEnvelope[]>([])
  const connection = ref<EventConnection>('connecting')
  /** The buffer cursor. Every event has one, including synthetic ones. */
  const lastSeq = ref(0)
  /**
   * The highest `durable.seq` seen. This is the upstream's own ordering and what
   * the design means by "seq" — distinct from the buffer cursor above, which
   * includes events the upstream never sequenced.
   */
  const lastDurableSeq = ref(0)
  const errorMessage = ref<string | null>(null)

  let source: EventSource | null = null
  let pending: EventEnvelope[] = []
  let frameScheduled = false

  function flush() {
    frameScheduled = false
    if (pending.length === 0) return
    const batch = pending
    pending = []

    const next = events.value.concat(batch)
    if (next.length > MAX_EVENTS) next.splice(0, next.length - MAX_EVENTS)
    events.value = next
    triggerRef(events)
  }

  function close() {
    source?.close()
    source = null
  }

  function open(after: number) {
    close()
    const es = new EventSource(
      `/api/events/stream?after=${encodeURIComponent(String(after))}`,
    )
    source = es

    es.addEventListener('open', () => {
      connection.value = 'live'
      errorMessage.value = null
    })

    es.addEventListener('event', (message) => {
      const envelope = JSON.parse((message as MessageEvent<string>).data) as EventEnvelope
      // Track the highest sequence seen. Events without a durable seq carry a
      // buffer sequence instead, which is still a valid resume cursor.
      if (envelope.seq > lastSeq.value) lastSeq.value = envelope.seq
      const durableSeq = envelope.event?.seq
      if (typeof durableSeq === 'number' && durableSeq > lastDurableSeq.value) {
        lastDurableSeq.value = durableSeq
      }
      pending.push(envelope)
      if (frameScheduled) return
      frameScheduled = true
      scheduleFrame(flush)
    })

    es.addEventListener('error', () => {
      if (es.readyState === EventSource.CLOSED) {
        connection.value = 'error'
        errorMessage.value = 'event stream closed'
      } else {
        connection.value = 'reconnecting'
      }
    })
  }

  onMounted(() => {
    // No cursor: a fresh page wants new events, not a replay of the buffer.
    open(0)
  })

  onBeforeUnmount(close)

  /** Sessions with an event inside the live window, and when they last fired. */
  const liveSessions = computed(() => {
    const cutoff = Date.now() - LIVE_WINDOW_MS
    const map = new Map<string, number>()

    for (let i = events.value.length - 1; i >= 0; i--) {
      const record = events.value[i]?.event
      if (!record) continue
      if (record.ts < cutoff) break
      const id = record.sessionID
      if (!id) continue
      if (!map.has(id)) map.set(id, record.ts)
    }

    return map
  })

  function eventsForSession(sessionId: string) {
    return events.value.filter((envelope) => envelope.event.sessionID === sessionId)
  }

  return {
    events,
    connection,
    errorMessage,
    lastSeq,
    lastDurableSeq,
    liveSessions,
    eventsForSession,
  }
}
