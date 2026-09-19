import type { HealthResponse } from '#shared/types/health'

import { getApiHealth } from '../utils/event-reader'
import { getHealth } from '../utils/readers'

/**
 * Per-source health for the app shell.
 *
 * The two sources fail independently: Explorer A reads a file and keeps working
 * with the service stopped, Explorer B needs a live connection and reconnects.
 * Reporting them together would hide exactly the distinction this app exists to
 * make.
 */
export default defineEventHandler((): HealthResponse => {
  const health = getHealth()
  return { ...health, api: getApiHealth() }
})
