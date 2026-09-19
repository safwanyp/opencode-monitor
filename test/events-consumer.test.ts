import { afterEach, describe, expect, it, vi } from 'vitest'

import { EventConsumer } from '../server/utils/opencode-client.ts'

/**
 * The restart scenario, exercised against the real consumer with a stubbed
 * transport.
 *
 * A service restart changes the port, so this makes the first attempts fail on a
 * dead address and then hands over the real one. If the consumer cached the
 * address it would retry the dead port forever; the assertion is that it asked
 * again and recovered.
 */

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function sseResponse(payloads: string[]): Response {
  const encoder = new TextEncoder()
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const payload of payloads) controller.enqueue(encoder.encode(payload))
        // Deliberately left open: a real stream does not end after one frame.
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  )
}

async function waitFor(predicate: () => boolean, timeoutMs = 8_000): Promise<void> {
  const started = Date.now()
  while (!predicate() && Date.now() - started < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

describe('EventConsumer recovery', () => {
  it('re-resolves the address after failures and connects to the new one', async () => {
    let resolves = 0
    let fetches = 0
    const data: string[] = []
    const states: string[] = []

    vi.stubGlobal('fetch', async () => {
      fetches++
      if (fetches <= 2) throw new Error('ECONNREFUSED')
      return sseResponse([
        'data: {"type":"session.tool.success","durable":{"seq":7}}\n\n',
      ])
    })

    const consumer = new EventConsumer({
      // A different address on every resolution, standing in for a restarted
      // service that came back on a new port.
      resolveConnection: async () => {
        resolves++
        return { url: `http://127.0.0.1:${5000 + resolves}`, password: 'test' }
      },
      onData: (payload) => data.push(payload),
      onStateChange: (state) => states.push(state),
      onError: () => {},
    })

    consumer.start()
    await waitFor(() => data.length > 0)
    consumer.stop()

    // Three resolutions means the dead address was not cached, and the third
    // attempt used the address that the "restart" produced.
    expect(resolves).toBeGreaterThanOrEqual(3)
    expect(fetches).toBeGreaterThanOrEqual(3)
    expect(data).toHaveLength(1)
    expect(states).toContain('reconnecting')
    expect(states).toContain('connected')
  })

  it('backs off between attempts rather than hammering the service', async () => {
    const attempts: number[] = []
    vi.stubGlobal('fetch', async () => {
      attempts.push(Date.now())
      throw new Error('ECONNREFUSED')
    })

    const consumer = new EventConsumer({
      resolveConnection: async () => ({
        url: 'http://127.0.0.1:1',
        password: 'test',
      }),
      onData: () => {},
      onError: () => {},
    })

    consumer.start()
    await waitFor(() => attempts.length >= 3, 5_000)
    consumer.stop()

    expect(attempts.length).toBeGreaterThanOrEqual(3)
    const firstGap = (attempts[1] as number) - (attempts[0] as number)
    const secondGap = (attempts[2] as number) - (attempts[1] as number)
    // 500ms then 1000ms, so the second gap must be meaningfully larger.
    expect(firstGap).toBeGreaterThan(300)
    expect(secondGap).toBeGreaterThan(firstGap * 1.5)
  }, 10_000)

  it('reports reconnecting, not an error, while the service is down', async () => {
    const errors: unknown[] = []
    const states: string[] = []

    vi.stubGlobal('fetch', async () => {
      throw new Error('ECONNREFUSED')
    })

    const consumer = new EventConsumer({
      resolveConnection: async () => ({
        url: 'http://127.0.0.1:1',
        password: 'test',
      }),
      onData: () => {},
      onStateChange: (state) => states.push(state),
      onError: (error) => errors.push(error),
    })

    consumer.start()
    await waitFor(() => states.includes('reconnecting'), 4_000)
    consumer.stop()

    expect(states).toContain('reconnecting')
    expect(states).not.toContain('connected')
    // Being unreachable is a state this app renders, not a crash.
    expect(consumer.state).toBe('disconnected')
  }, 10_000)

  it('stops cleanly without scheduling more work', async () => {
    let fetches = 0
    vi.stubGlobal('fetch', async () => {
      fetches++
      throw new Error('ECONNREFUSED')
    })

    const consumer = new EventConsumer({
      resolveConnection: async () => ({
        url: 'http://127.0.0.1:1',
        password: 'test',
      }),
      onData: () => {},
      onError: () => {},
    })

    consumer.start()
    await waitFor(() => fetches > 0, 2_000)
    consumer.stop()
    const afterStop = fetches
    await new Promise((resolve) => setTimeout(resolve, 900))
    expect(fetches).toBe(afterStop)
  }, 10_000)
})
