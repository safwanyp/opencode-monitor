/**
 * Client for the OpenCode service.
 *
 * Two things here are not obvious:
 *
 * - `EventSource` cannot be used, because the service requires a Basic auth
 *   header and `EventSource` cannot send one (design §12). Everything goes
 *   through `fetch`, including the event stream, read as a `ReadableStream`.
 * - The service's port changes when it restarts, and it advertises `0.0.0.0`.
 *   Every connection therefore re-resolves the address and rewrites the host to
 *   loopback; nothing here caches an address for longer than the short window
 *   below.
 */

import { resolveServiceConnection, type ServiceConnection } from './discovery'

/** How long a resolved address is trusted before it is looked up again. */
const CONNECTION_TTL_MS = 30_000

const BASE_BACKOFF_MS = 500
const MAX_BACKOFF_MS = 30_000

/**
 * Incremental server-sent-event parser.
 *
 * Kept separate from the connection so the framing rules — which fail quietly —
 * can be tested without a socket.
 */
export class SseParser {
  private buffer = ''

  /**
   * Feed a chunk and take out whatever complete frames it finished.
   *
   * Returns the `data:` payloads (newline-joined per the spec) and a count of
   * comments, which is how the service sends heartbeats.
   */
  push(chunk: string): { data: string[]; comments: number } {
    this.buffer += chunk
    const data: string[] = []
    let comments = 0

    let index: number
    while ((index = this.buffer.indexOf('\n\n')) !== -1) {
      const frame = this.buffer.slice(0, index)
      this.buffer = this.buffer.slice(index + 2)

      if (frame.startsWith(':')) {
        comments++
        continue
      }

      const lines = frame
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).replace(/^ /, ''))

      if (lines.length > 0) data.push(lines.join('\n'))
    }

    return { data, comments }
  }

  reset(): void {
    this.buffer = ''
  }
}

/** Exponential backoff, capped. Exported so the policy can be asserted. */
export function nextBackoff(
  attempt: number,
  base = BASE_BACKOFF_MS,
  max = MAX_BACKOFF_MS,
): number {
  if (attempt <= 0) return base
  return Math.min(max, base * 2 ** attempt)
}

export type ConsumerState = 'connected' | 'reconnecting' | 'disconnected'

export interface EventConsumerOptions {
  /** Resolved fresh on every connect attempt, because the port can change. */
  resolveConnection: () => Promise<ServiceConnection | null>
  onData: (payload: string) => void
  onComment?: () => void
  onStateChange?: (state: ConsumerState) => void
  onError?: (error: unknown) => void
  path?: string
}

/**
 * Consumes the upstream `/api/event` stream and reconnects forever.
 *
 * The service restarting is a normal event, not an error: it comes back on a
 * different port, so the backoff loop re-resolves rather than retrying a dead
 * address.
 */
export class EventConsumer {
  private controller: AbortController | null = null
  private timer: NodeJS.Timeout | null = null
  private stopped = false
  private attempt = 0

  state: ConsumerState = 'disconnected'

  // Assigned explicitly rather than as a parameter property: Node's TypeScript
  // type stripping cannot handle parameter properties, and every other file in
  // this project runs under plain `node`.
  private readonly options: EventConsumerOptions

  constructor(options: EventConsumerOptions) {
    this.options = options
  }

  private setState(state: ConsumerState) {
    if (this.state === state) return
    this.state = state
    this.options.onStateChange?.(state)
  }

  start(): void {
    if (this.controller || this.timer) return
    this.stopped = false
    void this.connect()
  }

  stop(): void {
    this.stopped = true
    this.controller?.abort()
    this.controller = null
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.setState('disconnected')
  }

  private scheduleReconnect() {
    if (this.stopped) return
    const delay = nextBackoff(this.attempt)
    this.attempt++
    this.setState('reconnecting')

    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      void this.connect()
    }, delay)
    this.timer.unref?.()
  }

  private async connect(): Promise<void> {
    if (this.stopped) return

    const path = this.options.path ?? '/api/event'
    let connection: ServiceConnection | null = null

    try {
      connection = await this.options.resolveConnection()
    } catch (error) {
      this.options.onError?.(error)
    }

    if (!connection) {
      // Not an error: the service being down is a supported state.
      this.scheduleReconnect()
      return
    }

    const controller = new AbortController()
    this.controller = controller
    const parser = new SseParser()

    try {
      const response = await fetch(`${connection.url}${path}`, {
        headers: {
          authorization:
            'Basic ' +
            Buffer.from(`opencode:${connection.password}`).toString('base64'),
          accept: 'text/event-stream',
        },
        signal: controller.signal,
      })

      if (!response.ok || !response.body) {
        throw new Error(`upstream responded ${response.status}`)
      }

      this.attempt = 0
      this.setState('connected')

      const reader = response.body.getReader()
      const decoder = new TextDecoder()

      for (;;) {
        const { value, done } = await reader.read()
        if (done || this.stopped) break

        const { data, comments } = parser.push(
          decoder.decode(value, { stream: true }),
        )
        for (let i = 0; i < comments; i++) this.options.onComment?.()
        for (const payload of data) this.options.onData(payload)
      }

      if (!this.stopped) throw new Error('upstream closed the stream')
    } catch (error) {
      if (!this.stopped && (error as Error)?.name !== 'AbortError') {
        this.options.onError?.(error)
      }
    } finally {
      if (this.controller === controller) this.controller = null
      if (!this.stopped) this.scheduleReconnect()
    }
  }
}

/** Authenticated JSON GET against the service. */
export class OpenCodeClient {
  private cached: { connection: ServiceConnection; at: number } | null = null

  // Explicit assignment, for the same reason as EventConsumer above.
  private readonly resolveConnection: () => Promise<ServiceConnection | null>

  constructor(resolveConnection: () => Promise<ServiceConnection | null>) {
    this.resolveConnection = resolveConnection
  }

  private async connection(): Promise<ServiceConnection | null> {
    const now = Date.now()
    if (this.cached && now - this.cached.at < CONNECTION_TTL_MS) {
      return this.cached.connection
    }
    const connection = await this.resolveConnection()
    this.cached = connection ? { connection, at: now } : null
    return connection
  }

  /** Drops the cached address, so the next call re-resolves the port. */
  invalidate(): void {
    this.cached = null
  }

  async get<T>(
    path: string,
    query?: Record<string, string | number>,
  ): Promise<T> {
    const connection = await this.connection()
    if (!connection) throw new Error('OpenCode service is not reachable')

    const url = new URL(connection.url + path)
    for (const [key, value] of Object.entries(query ?? {})) {
      url.searchParams.set(key, String(value))
    }

    const response = await fetch(url, {
      headers: {
        authorization:
          'Basic ' +
          Buffer.from(`opencode:${connection.password}`).toString('base64'),
        accept: 'application/json',
      },
    })

    if (!response.ok) {
      // A failure may mean the service moved; make the next attempt re-resolve.
      if (response.status >= 500 || response.status === 401) this.invalidate()
      throw new Error(`OpenCode responded ${response.status} for ${path}`)
    }

    return (await response.json()) as T
  }
}

const CLIENT_KEY = '__opencodeMonitorServiceClient'

/**
 * One client per process, so the address cache is shared rather than duplicated
 * per request. Guarded on `globalThis` for the same reason the readers are.
 */
export function getOpenCodeClient(): OpenCodeClient {
  const global = globalThis as typeof globalThis & {
    [CLIENT_KEY]?: OpenCodeClient
  }
  if (!global[CLIENT_KEY]) {
    global[CLIENT_KEY] = new OpenCodeClient(resolveServiceConnection)
  }
  return global[CLIENT_KEY]
}
