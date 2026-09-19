import { appendFile, mkdtemp, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  LogTailer,
  type TailBatch,
  type TailerEvent,
  type TailerOptions,
} from '../server/utils/tailer.ts'

let dir: string
let path: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'oc-tailer-'))
  path = join(dir, 'opencode.log')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** Drives the tailer directly instead of waiting on fs.watch. */
function harness(overrides: Partial<TailerOptions> = {}) {
  const batches: TailBatch[] = []
  const lines: string[] = []
  const events: TailerEvent[] = []

  const tailer = new LogTailer({
    path,
    // Infinity reads from the start of the file; 0 would mean "from EOF".
    startBytesBack: Number.POSITIVE_INFINITY,
    maxBytesPerPump: 1024 * 1024,
    onBatch: (batch) => {
      batches.push(batch)
      for (const line of batch.lines) lines.push(line.line)
    },
    onEvent: (event) => events.push(event),
    ...overrides,
  })

  return { tailer, batches, lines, events }
}

describe('LogTailer', () => {
  it('emits only whole lines and holds a partial line back', async () => {
    await writeFile(path, 'a=1\nb=2')
    const h = harness()

    await h.tailer.pump()
    expect(h.lines).toEqual(['a=1'])

    await appendFile(path, '\nc=3\n')
    await h.tailer.pump()
    expect(h.lines).toEqual(['a=1', 'b=2', 'c=3'])

    h.tailer.stop()
  })

  it('reassembles a line that was written in two pieces', async () => {
    await writeFile(path, 'partial')
    const h = harness()

    await h.tailer.pump()
    expect(h.lines).toEqual([])

    await appendFile(path, '=done\n')
    await h.tailer.pump()
    expect(h.lines).toEqual(['partial=done'])

    h.tailer.stop()
  })

  it('never emits the same bytes twice across pumps', async () => {
    await writeFile(path, 'a=1\nb=2\n')
    const h = harness()

    await h.tailer.pump()
    await h.tailer.pump()
    await h.tailer.pump()

    expect(h.lines).toEqual(['a=1', 'b=2'])
    expect(h.tailer.stats.bytes).toBe(Buffer.byteLength('a=1\nb=2\n'))

    h.tailer.stop()
  })

  it('reports byte offsets, including past multi-byte characters', async () => {
    const first = 'msg=héllo wörld\n'
    await writeFile(path, `${first}x=1\n`)
    const h = harness()

    await h.tailer.pump()

    expect(h.lines).toEqual(['msg=héllo wörld', 'x=1'])
    const offsets = h.batches.flatMap((b) => b.lines.map((l) => l.offset))
    expect(offsets).toEqual([0, Buffer.byteLength(first, 'utf8')])

    h.tailer.stop()
  })

  it('resets on truncation and bumps the generation', async () => {
    await writeFile(path, 'a=1\nb=2\n')
    const h = harness()

    await h.tailer.pump()
    expect(h.lines).toEqual(['a=1', 'b=2'])

    // Shorter than the current offset, i.e. the file was truncated.
    await writeFile(path, 'z=9\n')
    await h.tailer.pump()

    expect(h.lines).toEqual(['a=1', 'b=2', 'z=9'])
    expect(h.tailer.stats.truncations).toBe(1)
    expect(h.batches.at(-1)?.generation).toBe(2)
    expect(h.events.map((e) => e.kind)).toContain('truncation')

    h.tailer.stop()
  })

  it('resets when the file is replaced by rotation', async () => {
    await writeFile(path, 'a=1\n')
    const h = harness()

    await h.tailer.pump()
    expect(h.lines).toEqual(['a=1'])

    await rename(path, `${path}.rotated`)
    await writeFile(path, 'b=2\n')
    await h.tailer.pump()

    expect(h.lines).toEqual(['a=1', 'b=2'])
    expect(h.tailer.stats.rotations).toBe(1)
    expect(h.batches.at(-1)?.generation).toBe(2)
    expect(h.events.map((e) => e.kind)).toContain('rotation')

    h.tailer.stop()
  })

  it('discards the joined partial line when starting mid-file', async () => {
    await writeFile(path, 'one=1\ntwo=2\nthree=3\n')
    const h = harness({ startBytesBack: 5 })

    await h.tailer.pump()

    // Starting inside the last line means nothing whole was available.
    expect(h.lines).toEqual([])
    expect(h.tailer.stats.skippedBytes).toBeGreaterThan(0)

    await appendFile(path, 'four=4\n')
    await h.tailer.pump()

    expect(h.lines).toEqual(['four=4'])

    h.tailer.stop()
  })

  it('bounds work per pump and resumes', async () => {
    const expected = Array.from({ length: 20 }, (_, i) => `line=${i}`)
    await writeFile(path, `${expected.map((l) => `${l}\n`).join('')}`)
    const h = harness({ maxBytesPerPump: 16 })

    await h.tailer.pump()
    const afterFirst = h.lines.length
    expect(afterFirst).toBeGreaterThan(0)
    expect(afterFirst).toBeLessThan(expected.length)

    for (let i = 0; i < 200 && h.lines.length < expected.length; i++) {
      await h.tailer.pump()
    }

    expect(h.lines).toEqual(expected)
    expect(h.tailer.stats.deferredPumps).toBeGreaterThan(0)

    h.tailer.stop()
  })

  it('treats a missing file as nothing to do, not an error', async () => {
    const h = harness()

    await h.tailer.pump()

    expect(h.lines).toEqual([])
    expect(h.tailer.stats.errors).toBe(0)

    h.tailer.stop()
  })

  it('does nothing for an empty file', async () => {
    await writeFile(path, '')
    const h = harness()

    await h.tailer.pump()

    expect(h.lines).toEqual([])
    expect(h.tailer.stats.batches).toBe(0)

    h.tailer.stop()
  })

  it('signals each catch-up so a backfill can be reported accurately', async () => {
    await writeFile(path, 'a=1\nb=2\n')
    const h = harness()
    const caught = () => h.events.filter((e) => e.kind === 'caught-up').length

    await h.tailer.pump()
    expect(caught()).toBe(1)

    // Nothing new: no second signal.
    await h.tailer.pump()
    expect(caught()).toBe(1)

    await appendFile(path, 'c=3\n')
    await h.tailer.pump()
    expect(caught()).toBe(2)

    h.tailer.stop()
  })

  it('resumes after the file briefly disappears mid-rotation', async () => {
    await writeFile(path, 'a=1\n')
    const h = harness()
    await h.tailer.pump()

    await unlink(path)
    await h.tailer.pump() // no-op, must not throw
    expect(h.lines).toEqual(['a=1'])

    await writeFile(path, 'b=2\n')
    await h.tailer.pump()
    expect(h.lines).toEqual(['a=1', 'b=2'])

    h.tailer.stop()
  })
})
