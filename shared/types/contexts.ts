/**
 * Contexts as the API serves them.
 *
 * Deliberately slimmer than the server's `Context`: the parsed config documents
 * stay on the server. The client receives what it needs to attribute a session
 * and to explain the answer — the scope, the merge order, and the resolved model
 * per agent — and does no config parsing of its own, so it cannot disagree with
 * the server about what a context declares.
 */

import type { ConfigKind } from '../utils/contexts.ts'

export interface ContextStackEntry {
  /** Home-shortened path, for display. */
  path: string
  kind: ConfigKind
  /** Top-level keys this file sets. */
  keys: string[]
  parseError?: string
}

export interface ContextSummary {
  id: string
  label: string
  scopeDir: string | null
  depth: number
  /** Lowest precedence first, so the list reads as the merge order. */
  stack: ContextStackEntry[]
  /** Keys contributed beyond the global config — what makes this context. */
  keys: string[]
  /** Agent name → `provider/model#variant` this context expects. */
  models: Record<string, string>
}

export interface ContextsResponse {
  contexts: ContextSummary[]
  /**
   * Present when the service or the config files could not be read. The request
   * still succeeds: a monitor reporting a degraded source is the point.
   */
  error?: string
}
