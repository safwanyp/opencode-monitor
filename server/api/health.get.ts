import type { HealthResponse } from '#shared/types/health'

import { getHealth } from '../utils/readers'

/**
 * Per-source health for the app shell.
 *
 * Explorer A reports on the file reader (`following` / `paused` / `error`) and
 * Explorer B reports on the upstream connection, which is not wired until
 * Phase 6 and says so rather than pretending to be healthy.
 */
export default defineEventHandler((): HealthResponse => getHealth())
