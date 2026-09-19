/**
 * Health of the two independent sources this app observes.
 *
 * Explorer A reads a file, so it is "following" or "paused" and can keep
 * working while the OpenCode service is down. Explorer B depends on a live
 * HTTP connection, so it reconnects. They are reported separately on purpose:
 * the two sources share no data and fail independently.
 */

export type LogSourceStatus = 'following' | 'paused' | 'error' | 'unknown'

export type ApiSourceStatus =
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'unknown'

export interface SourceHealth {
  status: LogSourceStatus | ApiSourceStatus
  /** Short human-readable qualifier, e.g. "last write 4m ago". */
  detail?: string
}

export interface HealthResponse {
  /** Explorer A — the logfmt file tailer. */
  log: SourceHealth
  /** Explorer B — the upstream OpenCode event stream. */
  api: SourceHealth
}
