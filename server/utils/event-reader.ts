/**
 * Explorer B's reader: the upstream `/api/event` stream, normalized and buffered.
 *
 * Same shape as the log reader on purpose — a ring buffer, an in-process emitter
 * and `globalThis`-guarded state — so the two explorers are wired identically and
 * the SSE fan-out can be written once.
 *
 * Unlike Explorer A this source can be down. The service restarting is normal,
 * so state is reported rather than treated as a failure.
 */

import { EventEmitter } from 'node:events'

import type { EventRecord } from '#shared/types/records'
import type { ApiSourceStatus, SourceHealth } from '#shared/types/health'

import { resolveServiceConnection } from './discovery'
import { EventConsumer, type ConsumerState } from './opencode-client'
import { createRingBuffer, type RingBuffer } from './ring-buffer'

/** Events are far lower volume than log lines but can burst on tool calls. */
const RING_CAPACITY = 5_000
const GLOBAL_KEY = '__opencodeMonitorEvents'

export interface EventReaderStats {
  received: number
  unparsable: number
  reconnects: number
  lastEventAt: number | null
  lastHeartbeatAt: number | null
}

export interface EventReaderState {
  buffer: RingBuffer<EventRecord>
  events: EventEmitter
  consumer: EventConsumer | null
  started: boolean
  startCount: number
  state: ConsumerState
  stats: EventReaderStats
}

function createState(): EventReaderState {
  return {
    buffer: createRingBuffer<EventRecord>(RING_CAPACITY),
    events: new EventEmitter(),
    consumer: null,
    started: false,
    startCount: 0,
    state: 'disconnected',
    stats: {
      received: 0,
      unparsable: 0,
      reconnects: 0,
      lastEventAt: null,
      lastHeartbeatAt: null,
    },
  }
}

export function getEventReader(): EventReaderState {
  const global = globalThis as typeof globalThis & {
    [GLOBAL_KEY]?: EventReaderState
  }
  if (!global[GLOBAL_KEY]) global[GLOBAL_KEY] = createState()
  return global[GLOBAL_KEY]
}

interface RawEvent {
  id?: unknown
  type?: unknown
  created?: unknown
  location?: { directory?: unknown }
  data?: { sessionID?: unknown }
  durable?: { aggregateID?: unknown; seq?: unknown }
}

/**
 * Map an upstream event onto `EventRecord`.
 *
 * `session.connected` and friends carry no `durable`, so the sequence is left
 * absent rather than invented — it is the resume cursor and must not be faked.
 */
export function toEventRecord(raw: unknown, now = Date.now()): EventRecord | null {
  if (!raw || typeof raw !== 'object') return null
  const event = raw as RawEvent
  if (typeof event.type !== 'string' || event.type === '') return null

  const durable = event.durable
  const sessionID = event.data?.sessionID ?? durable?.aggregateID

  return {
    id: typeof event.id === 'string' ? event.id : `evt_${now}`,
    ts: typeof event.created === 'number' ? event.created : now,
    type: event.type,
    sessionID: typeof sessionID === 'string' ? sessionID : undefined,
    directory:
      typeof event.location?.directory === 'string'
        ? event.location.directory
        : undefined,
    seq: typeof durable?.seq === 'number' ? durable.seq : undefined,
    data: event.data,
    durable: event.durable,
  }
}

/** Explorer B health, derived from consumer state rather than from a failure. */
export function deriveApiHealth(
  state: ConsumerState,
  stats: EventReaderStats,
  now = Date.now(),
): SourceHealth {
  const status: ApiSourceStatus =
    state === 'connected'
      ? 'connected'
      : state === 'reconnecting'
        ? 'reconnecting'
        : 'disconnected'

  const parts: string[] = []
  if (stats.received > 0) parts.push(`${stats.received} events`)
  if (stats.lastEventAt !== null) {
    parts.push(`last ${formatAge(now - stats.lastEventAt)} ago`)
  }
  if (stats.reconnects > 0) parts.push(`${stats.reconnects} reconnects`)

  return { status, detail: parts.join(' · ') || 'waiting for the service' }
}

function formatAge(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  return `${Math.round(minutes / 60)}h`
}

function accept(state: EventReaderState, payload: string): void {
  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch {
    state.stats.unparsable++
    return
  }

  const record = toEventRecord(parsed)
  if (!record) {
    state.stats.unparsable++
    return
  }

  state.stats.received++
  state.stats.lastEventAt = Date.now()

  const seq = state.buffer.push(record)
  state.events.emit('event', { seq, record })
}

export function startEventReader(): void {
  const state = getEventReader()
  state.startCount++

  if (state.started) {
    console.info(
      `[events] plugin run #${state.startCount}: already started, not creating a second consumer`,
    )
    return
  }
  state.started = true

  const consumer = new EventConsumer({
    resolveConnection: resolveServiceConnection,
    onData: (payload) => accept(state, payload),
    onComment: () => {
      state.stats.lastHeartbeatAt = Date.now()
    },
    onStateChange: (next) => {
      if (next === 'reconnecting' && state.state !== 'disconnected') {
        state.stats.reconnects++
      }
      state.state = next
      console.info(`[events] ${next}`)
    },
    onError: (error) => {
      console.warn(`[events] ${(error as Error)?.message ?? error}`)
    },
  })

  state.consumer = consumer
  consumer.start()
  console.info('[events] consuming /api/event')
}

export function stopEventReader(): void {
  const state = getEventReader()
  state.consumer?.stop()
  state.consumer = null
  state.started = false
}

export function getApiHealth(): SourceHealth {
  const state = getEventReader()
  return deriveApiHealth(state.state, state.stats)
}
