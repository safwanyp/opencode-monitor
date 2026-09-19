import { computed, ref, shallowRef } from 'vue'
import type { Ref, ShallowRef } from 'vue'

import type {
  SessionMessage,
  SessionSummary,
  SessionsResponse,
  TranscriptResponse,
} from '#shared/types/events'

/**
 * Explorer B data.
 *
 * Sessions are polled rather than streamed: the live signal for a session comes
 * from the event stream, and the list itself changes slowly. A poll keeps the
 * list honest without a second stream to reconcile against.
 */

const LIST_POLL_MS = 15_000

/** The upstream pages sessions, so one request is a fraction of the machine. */
const PAGE_SIZE = 500

/** A ceiling so a very large history cannot turn a poll into a stampede. */
const MAX_SESSIONS = 2_000

export function useSessions() {
  const sessions = shallowRef<SessionSummary[]>([])
  const error = ref<string | null>(null)
  const loading = ref(true)
  const loadedAt = ref<number | null>(null)

  /** True when the history hit the ceiling rather than ending naturally. */
  const truncated = ref(false)

  async function load() {
    const collected: SessionSummary[] = []
    let cursor: string | undefined

    try {
      // Walk every page. Requesting one page was covering 100 of 521 sessions
      // while the summary presented those totals as if they were the machine's.
      for (let page = 0; page < Math.ceil(MAX_SESSIONS / PAGE_SIZE); page++) {
        const response = await $fetch<SessionsResponse>('/api/events/sessions', {
          query: { limit: PAGE_SIZE, cursor },
        })

        collected.push(...response.sessions)

        if (response.error) {
          error.value = response.error
          break
        }

        cursor = response.next
        if (!cursor) break
        if (collected.length >= MAX_SESSIONS) {
          truncated.value = true
          break
        }
      }

      sessions.value = collected
      loadedAt.value = Date.now()
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'request failed'
    } finally {
      loading.value = false
    }
  }

  onMounted(() => {
    void load()
    const timer = setInterval(() => {
      // A full load is now several hundred sessions across two requests, so
      // there is no reason to keep fetching while the tab is hidden.
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return
      }
      void load()
    }, LIST_POLL_MS)
    onBeforeUnmount(() => clearInterval(timer))
  })

  return { sessions, error, loading, loadedAt, truncated, reload: load }
}

export interface Transcript {
  messages: ShallowRef<SessionMessage[]>
  error: Ref<string | null>
  loading: Ref<boolean>
  loadingMore: Ref<boolean>
  hasOlder: Ref<boolean>
  reload: () => Promise<void>
  loadOlder: () => Promise<void>
}

export function useTranscript(sessionId: Ref<string>): Transcript {
  const messages = shallowRef<SessionMessage[]>([])
  const error = ref<string | null>(null)
  const loading = ref(true)
  const loadingMore = ref(false)
  const previous = ref<string | undefined>(undefined)

  async function load() {
    loading.value = true
    try {
      const response = await $fetch<TranscriptResponse>(
        `/api/events/session/${encodeURIComponent(sessionId.value)}`,
        { query: { limit: 50 } },
      )
      // The service returns messages newest-first (its cursor says order=desc),
      // so reverse each page to read oldest to newest.
      messages.value = [...response.messages].reverse()
      previous.value = response.previous
      error.value = response.error ?? null
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'request failed'
    } finally {
      loading.value = false
    }
  }

  /** Pages further back, prepending older messages. */
  async function loadOlder() {
    if (!previous.value || loadingMore.value) return
    loadingMore.value = true
    try {
      const response = await $fetch<TranscriptResponse>(
        `/api/events/session/${encodeURIComponent(sessionId.value)}`,
        { query: { limit: 50, cursor: previous.value } },
      )
      messages.value = [
        ...[...response.messages].reverse(),
        ...messages.value,
      ]
      previous.value = response.previous
    } catch {
      // Keep what we have rather than emptying the transcript.
    } finally {
      loadingMore.value = false
    }
  }

  watch(sessionId, () => void load())
  onMounted(() => void load())

  return {
    messages,
    error,
    loading,
    loadingMore,
    hasOlder: computed(() => previous.value !== undefined),
    reload: load,
    loadOlder,
  }
}
