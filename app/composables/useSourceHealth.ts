import type { HealthResponse } from '#shared/types/health'

/**
 * Per-source health for the app shell.
 *
 * Phase 0 has no `/api/health` route yet, so this reports `unknown` for both
 * sources. Phase 3 replaces the body with a poll of `/api/health`; the shape
 * it returns is already final, so nothing that consumes it has to change.
 */
export function useSourceHealth() {
  return useState<HealthResponse>('source-health', () => ({
    log: { status: 'unknown' },
    api: { status: 'unknown' },
  }))
}
