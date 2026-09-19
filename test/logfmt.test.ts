import { describe, expect, it } from 'vitest'
import {
  LogfmtParseError,
  parseLogfmt,
  parseLogLine,
  toLogRecord,
  tryParseLogfmt,
} from '../shared/utils/logfmt.ts'

describe('parseLogfmt', () => {
  it('parses a plain line', () => {
    expect(
      parseLogfmt(
        'timestamp=2026-09-19T10:19:37.203Z level=INFO run=0cc8cfa0 message="watcher started" backend=node ignores=0 http.span=105663 role=server',
      ),
    ).toEqual({
      timestamp: '2026-09-19T10:19:37.203Z',
      level: 'INFO',
      run: '0cc8cfa0',
      message: 'watcher started',
      backend: 'node',
      ignores: '0',
      'http.span': '105663',
      role: 'server',
    })
  })

  it('unescapes quotes but does not JSON-decode (args)', () => {
    const line =
      'message="spawning process" command=/bin/zsh args="[\\"-c\\",\\"cd ~/.config/opencode && npm run check 2>&1\\"]" cwd=/Users/safwanyp http.span=108213 role=server'
    const fields = parseLogfmt(line)
    expect(fields['args']).toBe(
      '["-c","cd ~/.config/opencode && npm run check 2>&1"]',
    )
    expect(typeof fields['args']).toBe('string')
  })

  it('handles parentheses and a URL inside a quoted value', () => {
    const fields = parseLogfmt(
      'level=ERROR run=556d837a message="Failed to fetch models.dev" cause="Cause([Fail(HttpClientError: Transport error (GET https://models.opencode.ai/api.json))])" http.span=59500628 role=server',
    )
    expect(fields['cause']).toBe(
      'Cause([Fail(HttpClientError: Transport error (GET https://models.opencode.ai/api.json))])',
    )
    expect(fields['message']).toBe('Failed to fetch models.dev')
  })

  it('handles nested escaped JSON in a quoted value', () => {
    const fields = parseLogfmt(
      'errors="[{\\"type\\":\\"TypeError\\",\\"code\\":\\"ConnectionRefused\\"}]"',
    )
    expect(fields['errors']).toBe(
      '[{"type":"TypeError","code":"ConnectionRefused"}]',
    )
  })

  it('keeps bare values containing = and :', () => {
    expect(parseLogfmt('a=b=c')).toEqual({ a: 'b=c' })
    expect(parseLogfmt('url=http://127.0.0.1:4321/api/logs')).toEqual({
      url: 'http://127.0.0.1:4321/api/logs',
    })
  })

  it('handles values with spaces, parentheses and equals when quoted', () => {
    expect(parseLogfmt('msg="a b (c) d=e"')).toEqual({ msg: 'a b (c) d=e' })
  })

  it('supports dotted keys', () => {
    expect(parseLogfmt('http.span=105663 event.type=file status.status=ok')).toEqual({
      'http.span': '105663',
      'event.type': 'file',
      'status.status': 'ok',
    })
  })

  it('treats a bare key as present', () => {
    expect(parseLogfmt('verbose level=INFO')).toEqual({
      verbose: 'true',
      level: 'INFO',
    })
  })

  it('decodes known escapes', () => {
    expect(parseLogfmt('msg="line1\\nline2"')['msg']).toBe('line1\nline2')
    expect(parseLogfmt('msg="a\\tb"')['msg']).toBe('a\tb')
    expect(parseLogfmt('path="C:\\\\tmp"')['path']).toBe('C:\\tmp')
  })

  it('preserves an unknown escape rather than dropping the backslash', () => {
    expect(parseLogfmt('x="a\\qb"')['x']).toBe('a\\qb')
  })

  it('accepts an empty quoted value and a trailing empty bare value', () => {
    expect(parseLogfmt('a="" b=')).toEqual({ a: '', b: '' })
  })

  it('returns an empty map for a blank line', () => {
    expect(parseLogfmt('')).toEqual({})
    expect(parseLogfmt('   ')).toEqual({})
  })

  it('accepts tabs as separators', () => {
    expect(parseLogfmt('a=1\tb=2')).toEqual({ a: '1', b: '2' })
  })

  it('keeps the last occurrence of a repeated key', () => {
    expect(parseLogfmt('a=1 a=2')).toEqual({ a: '2' })
  })

  it('rejects an unterminated quoted value, pointing at the unmatched quote', () => {
    const line = 'level=INFO message="oops'
    try {
      parseLogfmt(line)
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(LogfmtParseError)
      expect((error as LogfmtParseError).index).toBe(line.indexOf('"'))
      expect((error as LogfmtParseError).line).toBe(line)
    }
  })

  it('rejects trailing characters after a closing quote', () => {
    expect(() => parseLogfmt('key="closed"trailing')).toThrow(LogfmtParseError)
  })

  it('rejects a field that does not start with a key character', () => {
    expect(() => parseLogfmt('=value')).toThrow(LogfmtParseError)
    expect(() => parseLogfmt('"quoted key"=1')).toThrow(LogfmtParseError)
  })
})

describe('tryParseLogfmt', () => {
  it('reports success and failure without throwing', () => {
    expect(tryParseLogfmt('a=1').ok).toBe(true)

    const failure = tryParseLogfmt('a="unterminated')
    expect(failure.ok).toBe(false)
    if (!failure.ok) expect(failure.error).toBeInstanceOf(LogfmtParseError)
  })
})

describe('toLogRecord', () => {
  const fields = parseLogfmt(
    'timestamp=2026-09-19T10:19:37.203Z level=warn run=0cc8cfa0 message="watcher started" backend=node ignores=0 http.span=105663 role=server extra="a b"',
  )

  it('promotes known keys and leaves the remainder in fields', () => {
    expect(toLogRecord(fields, 'id-1')).toEqual({
      id: 'id-1',
      ts: '2026-09-19T10:19:37.203Z',
      level: 'WARN',
      role: 'server',
      run: '0cc8cfa0',
      span: 105663,
      message: 'watcher started',
      fields: { backend: 'node', ignores: '0', extra: 'a b' },
    })
  })

  it('derives a stable id when none is given', () => {
    const a = toLogRecord(fields)
    const b = toLogRecord(parseLogfmt(
      'timestamp=2026-09-19T10:19:37.203Z level=warn run=0cc8cfa0 message="watcher started" backend=node ignores=0 http.span=105663 role=server extra="a b"',
    ))
    expect(a.id).toBe(b.id)
    expect(a.id).toMatch(/^h[0-9a-f]+$/)
  })

  it('defaults an unknown or missing level to INFO', () => {
    expect(toLogRecord({ level: 'TRACE' }).level).toBe('INFO')
    expect(toLogRecord({}).level).toBe('INFO')
    expect(toLogRecord({ level: 'debug' }).level).toBe('DEBUG')
  })

  it('drops an unrecognised role rather than trusting it', () => {
    expect(toLogRecord({ role: 'daemon' }).role).toBeUndefined()
    expect(toLogRecord({ role: 'cli' }).role).toBe('cli')
  })

  it('only accepts a non-negative integer span', () => {
    expect(toLogRecord({ 'http.span': '0' }).span).toBe(0)
    expect(toLogRecord({ 'http.span': '12abc' }).span).toBeUndefined()
    expect(toLogRecord({ 'http.span': '-4' }).span).toBeUndefined()
    expect(toLogRecord({}).span).toBeUndefined()
  })

  it('falls back to msg when message is absent', () => {
    // Verified against the whole buffer: some lines carry `msg` instead of
    // `message`, and the two never co-occur.
    const record = toLogRecord(parseLogfmt('msg="loading plugin" id=7'))
    expect(record.message).toBe('loading plugin')
    expect(record.fields).toEqual({ id: '7' })
  })

  it('prefers message when both keys somehow appear', () => {
    const record = toLogRecord(parseLogfmt('message=primary msg=secondary'))
    expect(record.message).toBe('primary')
  })

  it('leaves message empty when neither key is present', () => {
    // 6 of 7,648 records in the live buffer are like this; the UI supplies a
    // fallback rather than the parser inventing one.
    const record = toLogRecord(parseLogfmt('cause="InterruptError" http.status=200'))
    expect(record.message).toBe('')
    expect(record.fields).toEqual({ cause: 'InterruptError', 'http.status': '200' })
  })

  it('never drops a field', () => {
    const record = toLogRecord(parseLogfmt('a=1 b="two words" timestamp=t'))
    expect(record.fields).toEqual({ a: '1', b: 'two words' })
  })
})

describe('parseLogLine', () => {
  it('parses and normalizes in one step', () => {
    const record = parseLogLine(
      'timestamp=2026-09-19T10:19:44.871Z level=ERROR run=556d837a message="Failed to fetch models.dev" http.span=59500628 role=server',
      'log:42',
    )
    expect(record.id).toBe('log:42')
    expect(record.level).toBe('ERROR')
    expect(record.span).toBe(59500628)
    expect(record.fields).toEqual({})
  })
})
