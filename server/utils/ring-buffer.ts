/**
 * Bounded in-memory buffer of recent records.
 *
 * Explorer A's history lives here: the file is 39 MB and growing, so the client
 * never reads it directly. Records are addressed by a monotonically increasing
 * sequence number rather than by time or offset, because the only question the
 * client ever asks is "what is newer than the last thing I saw".
 *
 * The sequence is deliberately not reused after a `clear()`. A cursor is only
 * ever compared for "greater than", so allowing it to go backwards would make a
 * stale client silently stop receiving records instead of noticing a gap.
 */

export interface BufferEntry<T> {
  /** Monotonic. Assigned on push, never reused. */
  seq: number
  value: T
}

export interface RingBuffer<T> {
  readonly capacity: number
  /** Appends and returns the assigned sequence number. */
  push(value: T): number
  /** Up to `limit` retained entries strictly newer than `fromSeq`, oldest first. */
  after(fromSeq: number, limit: number): BufferEntry<T>[]
  /** Sequence of the most recent push, or 0 when nothing has been pushed. */
  latestSeq(): number
  /**
   * Sequence of the oldest retained entry, or `latestSeq() + 1` when empty.
   *
   * A caller whose `after()` cursor is below this has fallen out of the window
   * and must be told, rather than silently served a gap.
   */
  oldestSeq(): number
  size(): number
  clear(): void
}

export function createRingBuffer<T>(capacity: number): RingBuffer<T> {
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw new RangeError(`capacity must be a positive integer, got ${capacity}`)
  }

  const slots: Array<BufferEntry<T> | undefined> = new Array(capacity)
  let start = 0
  let count = 0
  let nextSeq = 1

  return {
    capacity,

    push(value: T): number {
      const seq = nextSeq++
      const entry: BufferEntry<T> = { seq, value }

      if (count < capacity) {
        slots[(start + count) % capacity] = entry
        count++
      } else {
        // Full: overwrite the oldest and advance the window.
        slots[start] = entry
        start = (start + 1) % capacity
      }

      return seq
    },

    after(fromSeq: number, limit: number): BufferEntry<T>[] {
      const out: BufferEntry<T>[] = []
      if (limit <= 0) return out

      for (let i = 0; i < count && out.length < limit; i++) {
        const entry = slots[(start + i) % capacity]
        if (entry && entry.seq > fromSeq) out.push(entry)
      }

      return out
    },

    latestSeq(): number {
      return nextSeq - 1
    },

    oldestSeq(): number {
      if (count === 0) return nextSeq
      const oldest = slots[start]
      return oldest ? oldest.seq : nextSeq
    },

    size(): number {
      return count
    },

    clear(): void {
      slots.fill(undefined)
      start = 0
      count = 0
      // nextSeq intentionally keeps climbing.
    },
  }
}
