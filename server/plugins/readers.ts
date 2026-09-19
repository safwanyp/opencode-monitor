/**
 * Starts the background readers once per process.
 *
 * This plugin re-runs on every Nitro dev reload. `startReaders()` is idempotent
 * and guards its state on `globalThis`, so a reload never produces a second
 * `fs.watch` handle feeding a second set of records into the buffer.
 */
import { startReaders } from '../utils/readers'

export default defineNitroPlugin(() => {
  void startReaders().catch((error: unknown) => {
    console.error('[readers] failed to start', error)
  })
})
