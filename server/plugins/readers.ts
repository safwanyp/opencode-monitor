/**
 * Starts the background readers once per process.
 *
 * This plugin re-runs on every Nitro dev reload. Both starters are idempotent
 * and guard their state on `globalThis`, so a reload never produces a second
 * `fs.watch` handle or a second upstream connection feeding duplicate rows.
 */
import { startEventReader } from '../utils/event-reader'
import { startReaders } from '../utils/readers'

export default defineNitroPlugin(() => {
  void startReaders().catch((error: unknown) => {
    console.error('[readers] failed to start', error)
  })

  try {
    startEventReader()
  } catch (error) {
    console.error('[events] failed to start', error)
  }
})
