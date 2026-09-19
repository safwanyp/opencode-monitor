import type { SessionMessage, SessionSummary } from '#shared/types/events'

/**
 * Upstream payload → the shapes the UI renders.
 *
 * Deliberately defensive: the service's fields are data-driven (only five event
 * types have been observed, and the design warns against assuming a closed set),
 * so anything unrecognised becomes `undefined` rather than crashing a page.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

interface RawSession {
  id?: unknown
  parentID?: unknown
  title?: unknown
  agent?: unknown
  model?: { id?: unknown; providerID?: unknown; variant?: unknown } | null
  cost?: unknown
  tokens?: Record<string, unknown>
  outcome?: unknown
  time?: { created?: unknown; updated?: unknown }
  location?: { directory?: unknown }
}

export function normalizeSession(raw: unknown): SessionSummary | null {
  if (!isRecord(raw)) return null
  const session = raw as RawSession
  const id = stringOrUndefined(session.id)
  if (!id) return null

  const tokens = isRecord(session.tokens) ? session.tokens : null
  const cache = tokens && isRecord(tokens['cache']) ? tokens['cache'] : null

  return {
    id,
    parentID: stringOrUndefined(session.parentID),
    title: stringOrUndefined(session.title) ?? 'Untitled session',
    directory: stringOrUndefined(session.location?.directory),
    agent: stringOrUndefined(session.agent),
    model: session.model
      ? {
          id: stringOrUndefined(session.model.id),
          providerID: stringOrUndefined(session.model.providerID),
          variant: stringOrUndefined(session.model.variant),
        }
      : undefined,
    cost: numberOrUndefined(session.cost),
    tokens: tokens
      ? {
          input: numberOrUndefined(tokens['input']),
          output: numberOrUndefined(tokens['output']),
          reasoning: numberOrUndefined(tokens['reasoning']),
          cache: cache
            ? {
                read: numberOrUndefined(cache['read']),
                write: numberOrUndefined(cache['write']),
              }
            : undefined,
        }
      : undefined,
    outcome: stringOrUndefined(session.outcome),
    created: numberOrUndefined(session.time?.created),
    updated: numberOrUndefined(session.time?.updated),
  }
}

interface RawMessage {
  id?: unknown
  type?: unknown
  agent?: unknown
  model?: { id?: unknown; providerID?: unknown; variant?: unknown } | null
  time?: { created?: unknown; streamed?: unknown }
  content?: unknown
}

export function normalizeMessage(raw: unknown): SessionMessage | null {
  if (!isRecord(raw)) return null
  const message = raw as RawMessage
  const id = stringOrUndefined(message.id)
  if (!id) return null

  const content = Array.isArray(message.content)
    ? message.content
        .filter(isRecord)
        .map((part) => ({ ...part, type: String(part['type'] ?? 'unknown') }))
    : []

  return {
    id,
    type: stringOrUndefined(message.type) ?? 'unknown',
    agent: stringOrUndefined(message.agent),
    model: message.model
      ? {
          id: stringOrUndefined(message.model.id),
          providerID: stringOrUndefined(message.model.providerID),
          variant: stringOrUndefined(message.model.variant),
        }
      : undefined,
    created: numberOrUndefined(message.time?.created),
    streamed: numberOrUndefined(message.time?.streamed),
    content,
  }
}

/** Human-readable text of a message, from its text and tool parts. */
export function messageText(message: SessionMessage): string {
  return message.content
    .filter((part) => part.type === 'text')
    .map((part) => part.text ?? '')
    .join('\n')
    .trim()
}
