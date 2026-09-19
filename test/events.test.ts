import { describe, expect, it } from 'vitest'

import {
  EventConsumer,
  SseParser,
  nextBackoff,
} from '../server/utils/opencode-client.ts'
import {
  messageText,
  normalizeMessage,
  normalizeSession,
} from '../server/utils/normalize.ts'
import { toEventRecord } from '../server/utils/event-reader.ts'

describe('SseParser', () => {
  it('extracts data payloads from complete frames', () => {
    const parser = new SseParser()
    const result = parser.push('data: {"a":1}\n\ndata: {"b":2}\n\n')
    expect(result.data).toEqual(['{"a":1}', '{"b":2}'])
    expect(result.comments).toBe(0)
  })

  it('counts comments, which is how the upstream sends heartbeats', () => {
    const parser = new SseParser()
    expect(parser.push(': heartbeat\n\n').comments).toBe(1)
    expect(parser.push(': heartbeat\n\n: heartbeat\n\n').comments).toBe(2)
  })

  it('holds an incomplete frame until the blank line arrives', () => {
    const parser = new SseParser()
    expect(parser.push('data: {"partial"').data).toEqual([])
    expect(parser.push('}\n\n').data).toEqual(['{"partial"}'])
  })

  it('joins multiple data lines per the spec', () => {
    const parser = new SseParser()
    expect(parser.push('data: line1\ndata: line2\n\n').data).toEqual([
      'line1\nline2',
    ])
  })

  it('handles a frame split across three chunks', () => {
    const parser = new SseParser()
    expect(parser.push('data: {"a"').data).toEqual([])
    expect(parser.push(':1}').data).toEqual([])
    expect(parser.push('\n\n').data).toEqual(['{"a":1}'])
  })

  it('ignores an event name and other fields', () => {
    const parser = new SseParser()
    expect(parser.push('event: message\nid: 4\ndata: {"x":1}\n\n').data).toEqual([
      '{"x":1}',
    ])
  })

  it('resets its buffer', () => {
    const parser = new SseParser()
    parser.push('data: incomplete')
    parser.reset()
    expect(parser.push('data: fresh\n\n').data).toEqual(['fresh'])
  })
})

describe('nextBackoff', () => {
  it('doubles and then caps', () => {
    expect(nextBackoff(0, 500, 30_000)).toBe(500)
    expect(nextBackoff(1, 500, 30_000)).toBe(1000)
    expect(nextBackoff(2, 500, 30_000)).toBe(2000)
    expect(nextBackoff(20, 500, 30_000)).toBe(30_000)
  })
})

describe('EventConsumer', () => {
  it('re-resolves the connection on every attempt, because the port changes', async () => {
    let resolves = 0
    const consumer = new EventConsumer({
      resolveConnection: async () => {
        resolves++
        return null // nothing to connect to
      },
      onData: () => {},
    })

    consumer.start()
    await new Promise((r) => setTimeout(r, 10))
    consumer.stop()

    // It resolved at least once, and stopping prevented a retry storm.
    expect(resolves).toBeGreaterThan(0)
    expect(consumer.state).toBe('disconnected')
  })

  it('reports reconnecting rather than failing when the service is absent', async () => {
    const states: string[] = []
    const consumer = new EventConsumer({
      resolveConnection: async () => null,
      onData: () => {},
      onStateChange: (s) => states.push(s),
    })

    consumer.start()
    await new Promise((r) => setTimeout(r, 10))
    consumer.stop()

    expect(states).toContain('reconnecting')
    // Being down is not an error: no onError callback is required.
    expect(states).not.toContain('connected')
  })

  it('stops cleanly and does not schedule further work', async () => {
    const consumer = new EventConsumer({
      resolveConnection: async () => null,
      onData: () => {},
    })
    consumer.start()
    consumer.stop()
    await new Promise((r) => setTimeout(r, 20))
    expect(consumer.state).toBe('disconnected')
  })
})

describe('normalizeSession', () => {
  it('maps the real upstream shape', () => {
    const session = normalizeSession({
      id: 'ses_1',
      title: 'Fix the parser',
      agent: 'build',
      model: { id: 'claude-sonnet-4', providerID: 'anthropic', variant: 'high' },
      cost: 0.9146,
      tokens: { input: 237198, output: 231716, cache: { read: 194099968, write: 0 } },
      outcome: 'succeeded',
      time: { created: 1789816509685, updated: 1789829625118 },
      location: { directory: '/Users/safwanyp/dev' },
    })

    expect(session).toMatchObject({
      id: 'ses_1',
      title: 'Fix the parser',
      agent: 'build',
      directory: '/Users/safwanyp/dev',
      outcome: 'succeeded',
      created: 1789816509685,
    })
    expect(session?.tokens?.cache?.read).toBe(194099968)
  })

  it('rejects anything without an id rather than rendering a broken row', () => {
    expect(normalizeSession({})).toBeNull()
    expect(normalizeSession(null)).toBeNull()
    expect(normalizeSession({ id: '' })).toBeNull()
    expect(normalizeSession({ id: 42 })).toBeNull()
  })

  it('supplies a title when the upstream has none', () => {
    expect(normalizeSession({ id: 'ses_2' })?.title).toBe('Untitled session')
  })

  it('does not assume a closed set of outcomes', () => {
    // The design warns the catalog is partial; an unknown outcome must survive.
    expect(normalizeSession({ id: 's', outcome: 'something.new' })?.outcome).toBe(
      'something.new',
    )
  })

  it('tolerates missing optional blocks', () => {
    const session = normalizeSession({ id: 'ses_3' })
    expect(session?.tokens).toBeUndefined()
    expect(session?.model).toBeUndefined()
    expect(session?.cost).toBeUndefined()
  })
})

describe('normalizeMessage', () => {
  it('maps content parts and their types', () => {
    const message = normalizeMessage({
      id: 'msg_1',
      type: 'assistant',
      time: { created: 1, streamed: 2 },
      content: [{ type: 'reasoning', text: 'thinking' }, { type: 'text', text: 'hello' }],
    })
    expect(message?.type).toBe('assistant')
    expect(message?.content).toHaveLength(2)
    expect(messageText(message!)).toBe('hello')
  })

  it('keeps unknown content types instead of dropping the message', () => {
    const message = normalizeMessage({
      id: 'msg_2',
      type: 'assistant',
      content: [{ type: 'brand.new', value: 1 }],
    })
    expect(message?.content[0]?.type).toBe('brand.new')
  })

  it('rejects a message without an id', () => {
    expect(normalizeMessage({ type: 'user' })).toBeNull()
  })

  it('handles a missing content array', () => {
    expect(normalizeMessage({ id: 'm', type: 'user' })?.content).toEqual([])
  })
})

describe('toEventRecord', () => {
  it('promotes sessionID and seq from the durable block', () => {
    const record = toEventRecord({
      id: 'evt_1',
      created: 1789813771537,
      type: 'session.tool.success',
      location: { directory: '/Users/safwanyp' },
      data: { sessionID: 'ses_abc', metadata: { exit: 0 } },
      durable: { aggregateID: 'ses_agg', seq: 220, version: 2 },
    })

    expect(record).toMatchObject({
      id: 'evt_1',
      ts: 1789813771537,
      type: 'session.tool.success',
      sessionID: 'ses_abc',
      directory: '/Users/safwanyp',
      seq: 220,
    })
  })

  it('falls back to the durable aggregate id when data has no sessionID', () => {
    const record = toEventRecord({
      type: 'shell.exited',
      data: {},
      durable: { aggregateID: 'ses_from_durable', seq: 1 },
    })
    expect(record?.sessionID).toBe('ses_from_durable')
  })

  it('leaves seq absent rather than inventing one', () => {
    // server.connected carries no durable block, and seq is the resume cursor.
    const record = toEventRecord({ type: 'server.connected', data: {} })
    expect(record?.seq).toBeUndefined()
    expect(record?.type).toBe('server.connected')
  })

  it('rejects a payload with no type', () => {
    expect(toEventRecord({ id: 'x' })).toBeNull()
    expect(toEventRecord(null)).toBeNull()
    expect(toEventRecord('nonsense')).toBeNull()
  })
})
