import type { LogRecord } from '../types/records.ts'

/**
 * Key-based redaction.
 *
 * Applied at render time rather than by mutating records in the buffer, so the
 * toggle is instant and reversible and the underlying data is never destroyed.
 *
 * Explorer A defaults redaction *off* (service logs are operational); Explorer B
 * defaults it *on*, because transcripts contain prompts, reasoning and tool
 * output (design §9). The toggle is always visible in both.
 */

const SENSITIVE_KEYS = new Set([
  'args',
  'cause',
  'content',
  'token',
  'password',
  'authorization',
  'credentialid',
  'apikey',
])

export const REDACTED = '••••••'

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key.toLowerCase().replace(/[_-]/g, ''))
}

export interface RedactionResult<T> {
  value: T
  /** How many values were masked, so the UI can say so rather than hint. */
  masked: number
}

export function redactFields(
  fields: Record<string, string>,
): RedactionResult<Record<string, string>> {
  const out: Record<string, string> = {}
  let masked = 0

  for (const [key, value] of Object.entries(fields)) {
    if (isSensitiveKey(key)) {
      out[key] = REDACTED
      masked++
    } else {
      out[key] = value
    }
  }

  return { value: out, masked }
}

export function redactRecord(record: LogRecord): RedactionResult<LogRecord> {
  const { value: fields, masked } = redactFields(record.fields)
  return { value: { ...record, fields }, masked }
}
