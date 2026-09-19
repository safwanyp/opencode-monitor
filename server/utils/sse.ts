/**
 * Server-sent event framing.
 *
 * Kept as pure functions because SSE framing bugs are quiet: a stray newline in
 * a payload silently truncates the event rather than throwing, and the client
 * just sees missing data.
 *
 * Reference: each field is `name: value` terminated by a newline, and the event
 * is terminated by a blank line.
 */

export interface SseEventFields {
  id?: number | string
  event?: string
  data?: string
}

/** A comment. Used for heartbeats, which keep the connection alive. */
export function sseComment(text: string): string {
  return `: ${text}\n\n`
}

export function sseEvent(fields: SseEventFields): string {
  let out = ''

  if (fields.id !== undefined) out += `id: ${fields.id}\n`
  if (fields.event !== undefined) out += `event: ${fields.event}\n`

  if (fields.data !== undefined) {
    // A payload containing a newline must be split across multiple `data:`
    // lines, which the client rejoins with newlines. Emitting a raw newline
    // would end the field early and corrupt the event.
    for (const line of fields.data.split('\n')) out += `data: ${line}\n`
  }

  return `${out}\n`
}

export function sseRecord(seq: number, record: unknown): string {
  return sseEvent({
    id: seq,
    event: 'record',
    data: JSON.stringify({ seq, record }),
  })
}
