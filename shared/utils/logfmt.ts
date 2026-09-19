import type { LogLevel, LogRole, LogRecord } from '../types/records.ts'

/**
 * logfmt parser.
 *
 * This is the highest-risk component in the project: the definition of done is
 * that it round-trips every line of a 39 MB log with zero failures.
 *
 * The grammar below is the full go-logfmt grammar, which is what OpenCode
 * emits. It is small on purpose — no JSON decoding happens here.
 *
 *   line   := field (separator field)*
 *   field  := key ( '=' value )?
 *   key    := [A-Za-z0-9_.-]+          (dotted keys are common: `http.span`)
 *   value  := quoted | bare
 *   quoted := '"' ( escape | char )* '"'
 *   bare   := any run of non-whitespace
 *   escape := '\' ( '"' | '\' | 'n' | 't' | 'r' )
 *
 * Rules that matter:
 *
 * - Quoted values are unescaped at the logfmt level (`\"` becomes `"`), but the
 *   result is never JSON-decoded. `args="[\"-c\"]"` yields the string
 *   `["-c"]`, which the UI may pretty-print lazily. Decoding in the hot path
 *   would throw on the many values that only look like JSON.
 * - An unknown escape keeps both characters. Losing a backslash from a path
 *   would be silent data corruption; keeping it is merely ugly.
 * - A repeated key keeps the last occurrence, matching go-logfmt.
 * - A bare key (no `=`) is legal and means the key is present: value `"true"`.
 */

const SPACE = 32
const TAB = 9
const QUOTE = 34
const BACKSLASH = 92
const EQUALS = 61
const DOT = 46
const HYPHEN = 45
const UNDERSCORE = 95
const UPPER_A = 65
const UPPER_Z = 90
const LOWER_A = 97
const LOWER_Z = 122
const DIGIT_0 = 48
const DIGIT_9 = 57
const LOWER_N = 110
const LOWER_T = 116
const LOWER_R = 114

/** Thrown by `parseLogfmt` on malformed input, carrying the exact offset. */
export class LogfmtParseError extends Error {
  readonly index: number
  readonly line: string

  constructor(reason: string, index: number, line: string) {
    super(`${reason} at index ${index}`)
    this.name = 'LogfmtParseError'
    this.index = index
    this.line = line
  }
}

function isKeyChar(code: number): boolean {
  return (
    (code >= LOWER_A && code <= LOWER_Z) ||
    (code >= UPPER_A && code <= UPPER_Z) ||
    (code >= DIGIT_0 && code <= DIGIT_9) ||
    code === UNDERSCORE ||
    code === DOT ||
    code === HYPHEN
  )
}

function isSeparator(code: number): boolean {
  return code === SPACE || code === TAB
}

/**
 * Parse one logfmt line into its raw field map.
 *
 * @throws {LogfmtParseError} on malformed input. A blank line yields `{}`
 * rather than throwing — the caller decides whether that is acceptable.
 */
export function parseLogfmt(line: string): Record<string, string> {
  const fields: Record<string, string> = {}
  const length = line.length
  let i = 0

  while (i < length) {
    while (i < length && isSeparator(line.charCodeAt(i))) i++
    if (i >= length) break

    const keyStart = i
    while (i < length && isKeyChar(line.charCodeAt(i))) i++
    if (i === keyStart) {
      throw new LogfmtParseError('invalid key', i, line)
    }
    const key = line.slice(keyStart, i)

    if (i < length && line.charCodeAt(i) === EQUALS) {
      i++

      if (i < length && line.charCodeAt(i) === QUOTE) {
        const quoteStart = i
        i++
        let value = ''
        let closed = false

        while (i < length) {
          const code = line.charCodeAt(i)

          if (code === BACKSLASH) {
            i++
            if (i >= length) break
            const escaped = line.charCodeAt(i)
            if (escaped === QUOTE) value += '"'
            else if (escaped === BACKSLASH) value += '\\'
            else if (escaped === LOWER_N) value += '\n'
            else if (escaped === LOWER_T) value += '\t'
            else if (escaped === LOWER_R) value += '\r'
            else value += '\\' + line[i]
            i++
          } else if (code === QUOTE) {
            i++
            closed = true
            break
          } else {
            value += line[i]
            i++
          }
        }

        if (!closed) {
          throw new LogfmtParseError('unterminated quoted value', quoteStart, line)
        }

        fields[key] = value
      } else {
        const valueStart = i
        while (i < length && !isSeparator(line.charCodeAt(i))) i++
        fields[key] = line.slice(valueStart, i)
      }
    } else {
      fields[key] = 'true'
    }

    // A field must end at a separator or at end of line. Anything else means
    // we mis-parsed, e.g. `key="closed"trailing`.
    if (i < length && !isSeparator(line.charCodeAt(i))) {
      throw new LogfmtParseError('expected whitespace between fields', i, line)
    }
  }

  return fields
}

export type LogfmtResult =
  | { ok: true; fields: Record<string, string> }
  | { ok: false; error: LogfmtParseError }

/**
 * Tolerant variant for consumers that must not throw — a live tailer reading
 * one bad line should log it and keep going rather than die.
 */
export function tryParseLogfmt(line: string): LogfmtResult {
  try {
    return { ok: true, fields: parseLogfmt(line) }
  } catch (error) {
    if (error instanceof LogfmtParseError) return { ok: false, error }
    throw error
  }
}

/** Keys promoted onto `LogRecord`; everything else lands in `fields`. */
const PROMOTED_KEYS = new Set([
  'timestamp',
  'level',
  'role',
  'run',
  'http.span',
  'message',
  // Some lines use `msg` instead of `message` for the same thing. Verified
  // across the whole buffer that the two never co-occur, so this is an
  // unambiguous alternative rather than a guess.
  'msg',
])

const LEVELS = new Set<LogLevel>(['INFO', 'WARN', 'ERROR', 'DEBUG'])

function toLevel(raw: string | undefined): LogLevel {
  if (!raw) return 'INFO'
  const upper = raw.toUpperCase() as LogLevel
  return LEVELS.has(upper) ? upper : 'INFO'
}

function toRole(raw: string | undefined): LogRole | undefined {
  return raw === 'server' || raw === 'cli' ? raw : undefined
}

function toSpan(raw: string | undefined): number | undefined {
  if (!raw) return undefined
  const value = Number(raw)
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

/**
 * FNV-1a over the field map, as a fallback identity.
 *
 * Deterministic but not unique: two identical lines in the same millisecond
 * collide. Readers must pass a byte-offset id; this exists so tests, fixtures
 * and one-shot parses still produce something usable.
 */
function contentId(fields: Record<string, string>): string {
  let hash = 0x811c9dc5
  for (const key of Object.keys(fields)) {
    const chunk = `${key}=${fields[key]}\u0000`
    for (let i = 0; i < chunk.length; i++) {
      hash ^= chunk.charCodeAt(i)
      hash = Math.imul(hash, 0x01000193)
    }
  }
  return `h${(hash >>> 0).toString(16)}`
}

/**
 * Map a raw field map onto a `LogRecord`.
 *
 * @param id Stable identity. The tailer must supply `${file}:${offset}`; when
 * omitted a content hash is used (see `contentId`).
 */
export function toLogRecord(
  fields: Record<string, string>,
  id?: string,
): LogRecord {
  const rest: Record<string, string> = {}
  for (const key of Object.keys(fields)) {
    if (PROMOTED_KEYS.has(key)) continue
    rest[key] = fields[key] as string
  }

  return {
    id: id ?? contentId(fields),
    ts: fields['timestamp'] ?? '',
    level: toLevel(fields['level']),
    role: toRole(fields['role']),
    run: fields['run'],
    span: toSpan(fields['http.span']),
    message: fields['message'] ?? fields['msg'] ?? '',
    fields: rest,
  }
}

/** Parse and normalize in one step. @throws {LogfmtParseError} */
export function parseLogLine(line: string, id?: string): LogRecord {
  return toLogRecord(parseLogfmt(line), id)
}
