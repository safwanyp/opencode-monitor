import { describe, expect, it } from 'vitest'

import { sseComment, sseEvent, sseRecord } from '../server/utils/sse.ts'

describe('sseComment', () => {
  it('frames a comment terminated by a blank line', () => {
    expect(sseComment('heartbeat 123')).toBe(': heartbeat 123\n\n')
  })
})

describe('sseEvent', () => {
  it('emits id, event and data in order', () => {
    expect(sseEvent({ id: 7, event: 'record', data: '{"a":1}' })).toBe(
      'id: 7\nevent: record\ndata: {"a":1}\n\n',
    )
  })

  it('omits fields that are not provided', () => {
    expect(sseEvent({ data: 'x' })).toBe('data: x\n\n')
    expect(sseEvent({})).toBe('\n')
  })

  it('splits a multi-line payload across data lines', () => {
    // A raw newline would end the field early and corrupt every event after it.
    expect(sseEvent({ data: 'line1\nline2' })).toBe(
      'data: line1\ndata: line2\n\n',
    )
    expect(sseEvent({ data: '' })).toBe('data: \n\n')
  })
})

describe('sseRecord', () => {
  it('frames a record with the cursor as the SSE id', () => {
    const frame = sseRecord(42, { id: 'log:1', message: 'hello' })

    expect(frame.startsWith('id: 42\nevent: record\n')).toBe(true)
    expect(frame.endsWith('\n\n')).toBe(true)

    const dataLine = frame.split('\n').find((l) => l.startsWith('data: '))
    expect(dataLine).toBeDefined()
    expect(JSON.parse((dataLine as string).slice('data: '.length))).toEqual({
      seq: 42,
      record: { id: 'log:1', message: 'hello' },
    })
  })

  it('produces exactly one data line for a JSON payload', () => {
    // JSON.stringify never emits a raw newline, so records must not be split.
    const frame = sseRecord(1, { message: 'a\nb' })
    const dataLines = frame.split('\n').filter((l) => l.startsWith('data: '))
    expect(dataLines).toHaveLength(1)
    expect(JSON.parse(dataLines[0]!.slice('data: '.length)).record.message).toBe('a\nb')
  })
})
