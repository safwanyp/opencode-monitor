const HEALTH_POLL_MS = 5_000

/**
 * Keeps the shell's per-source health in step with the server.
 *
 * Polls rather than subscribing: health is a summary, not a stream, and a
 * dropped poll simply leaves the last known state in place instead of flapping
 * the indicator to an error.
 */
export function useHealthPolling() {
  const health = useSourceHealth()
  let timer: ReturnType<typeof setInterval> | undefined

  async function poll() {
    try {
      health.value = await $fetch<typeof health.value>('/api/health')
    } catch {
      // Keep the last known good value.
    }
  }

  onMounted(() => {
    void poll()
    timer = setInterval(() => void poll(), HEALTH_POLL_MS)
  })

  onBeforeUnmount(() => {
    if (timer) clearInterval(timer)
  })

  return health
}
