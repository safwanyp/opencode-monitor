import { describe, expect, it } from 'vitest'
import { createRingBuffer } from '../server/utils/ring-buffer.ts'

describe('createRingBuffer', () => {
  it('assigns increasing sequence numbers starting at 1', () => {
    const buffer = createRingBuffer<string>(10)
    expect(buffer.push('a')).toBe(1)
    expect(buffer.push('b')).toBe(2)
    expect(buffer.latestSeq()).toBe(2)
    expect(buffer.size()).toBe(2)
  })

  it('returns entries strictly newer than the cursor, oldest first', () => {
    const buffer = createRingBuffer<string>(10)
    for (const value of ['a', 'b', 'c', 'd']) buffer.push(value)

    expect(buffer.after(0, 10).map((e) => e.value)).toEqual(['a', 'b', 'c', 'd'])
    expect(buffer.after(2, 10).map((e) => e.value)).toEqual(['c', 'd'])
    expect(buffer.after(4, 10)).toEqual([])
  })

  it('honours the limit', () => {
    const buffer = createRingBuffer<number>(10)
    for (let i = 0; i < 6; i++) buffer.push(i)
    expect(buffer.after(0, 2).map((e) => e.value)).toEqual([0, 1])
    expect(buffer.after(2, 2).map((e) => e.value)).toEqual([2, 3])
  })

  it('returns nothing for a non-positive limit', () => {
    const buffer = createRingBuffer<string>(4)
    buffer.push('a')
    expect(buffer.after(0, 0)).toEqual([])
    expect(buffer.after(0, -1)).toEqual([])
  })

  it('drops the oldest entries once full', () => {
    const buffer = createRingBuffer<string>(3)
    for (const value of ['a', 'b', 'c', 'd', 'e']) buffer.push(value)

    expect(buffer.size()).toBe(3)
    expect(buffer.after(0, 10).map((e) => e.value)).toEqual(['c', 'd', 'e'])
    expect(buffer.latestSeq()).toBe(5)
  })

  it('reports the oldest retained sequence so a stale cursor can be detected', () => {
    const buffer = createRingBuffer<string>(3)
    for (const value of ['a', 'b', 'c', 'd']) buffer.push(value)

    // The caller asked for everything after seq 1. Seq 2 was overwritten, so
    // the window starts at 3 and a gap must be reported rather than hidden.
    expect(buffer.oldestSeq()).toBe(2)
    expect(buffer.after(1, 10).map((e) => e.seq)).toEqual([2, 3, 4])
  })

  it('reports oldestSeq as latestSeq + 1 when empty', () => {
    const buffer = createRingBuffer<string>(3)
    expect(buffer.oldestSeq()).toBe(1)
    expect(buffer.latestSeq()).toBe(0)
  })

  it('keeps the sequence climbing across clear()', () => {
    const buffer = createRingBuffer<string>(3)
    buffer.push('a')
    buffer.push('b')
    buffer.clear()

    expect(buffer.size()).toBe(0)
    expect(buffer.after(0, 10)).toEqual([])
    // A cursor from before the clear must not match a reused number.
    expect(buffer.push('c')).toBe(3)
    expect(buffer.latestSeq()).toBe(3)
  })

  it('works at capacity 1', () => {
    const buffer = createRingBuffer<string>(1)
    buffer.push('a')
    buffer.push('b')
    expect(buffer.size()).toBe(1)
    expect(buffer.after(0, 10).map((e) => e.value)).toEqual(['b'])
  })

  it('rejects an invalid capacity', () => {
    expect(() => createRingBuffer<string>(0)).toThrow(RangeError)
    expect(() => createRingBuffer<string>(-1)).toThrow(RangeError)
    expect(() => createRingBuffer<string>(1.5)).toThrow(RangeError)
  })
})
