/**
 * Explorer B shapes.
 *
 * These are normalized rather than raw upstream payloads: the client should not
 * be coupled to the service's internal field names, and the shapes below are
 * what the UI actually renders.
 */

export interface SessionModel {
  id?: string
  providerID?: string
  variant?: string
}

export interface SessionTokens {
  input?: number
  output?: number
  reasoning?: number
  cache?: { read?: number; write?: number }
}

export interface SessionSummary {
  id: string
  title: string
  directory?: string
  agent?: string
  model?: SessionModel
  /** Upstream reports a float in dollars. */
  cost?: number
  tokens?: SessionTokens
  /** `succeeded` | `failed` | `interrupted` | … data-driven, not a closed set. */
  outcome?: string
  created?: number
  updated?: number
}

export interface SessionsResponse {
  sessions: SessionSummary[]
  /**
   * Present when the service could not be reached. The request still succeeds,
   * because "the service is not running" is a supported state for this app
   * rather than an exceptional one — Explorer A keeps working without it.
   */
  error?: string
}

export interface SessionContent {
  type: string
  text?: string
  [key: string]: unknown
}

export interface SessionMessage {
  id: string
  type: string
  agent?: string
  model?: SessionModel
  created?: number
  streamed?: number
  content: SessionContent[]
}

export interface TranscriptResponse {
  messages: SessionMessage[]
  /** Opaque cursor for paging further back through the transcript. */
  previous?: string
  error?: string
}

/** Envelope for a streamed event. The cursor lives here, not on the record. */
export interface EventEnvelope {
  seq: number
  event: unknown
}
