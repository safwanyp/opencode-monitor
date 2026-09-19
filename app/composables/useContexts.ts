import type { ContextSummary, ContextsResponse } from '#shared/types/contexts'
import { compareModels, contextFor, parseModelRef } from '#shared/utils/contexts'

/**
 * Configuration contexts, for attributing sessions to the config that governs
 * them.
 *
 * The server resolves each context's expected model per agent, so this composable
 * never parses a config — it only looks values up. That keeps one implementation
 * of the precedence rules rather than two that can disagree.
 */

const POLL_MS = 60_000

export function useContexts() {
  const contexts = shallowRef<ContextSummary[]>([])
  const error = ref<string | null>(null)
  const loading = ref(true)
  const loadedAt = ref<number | null>(null)

  async function load(refresh = false) {
    try {
      const response = await $fetch<ContextsResponse>('/api/config/contexts', {
        query: refresh ? { refresh: '1' } : undefined,
      })
      contexts.value = response.contexts
      error.value = response.error ?? null
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
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      void load()
    }, POLL_MS)
    onBeforeUnmount(() => clearInterval(timer))
  })

  /** The context governing a session directory, or null when unknown. */
  function forDirectory(directory: string | undefined): ContextSummary | null {
    if (!directory || contexts.value.length === 0) return null
    return contextFor(directory, contexts.value)
  }

  return { contexts, error, loading, loadedAt, reload: load, forDirectory }
}

export interface SessionModelMismatch {
  contextId: string
  contextLabel: string
  /** `provider/model#variant` the context declares. */
  expected: string
  /** `provider/model#variant` the session actually used. */
  recorded: string
  differing: string[]
}

export interface RecordedModel {
  providerID?: string
  id?: string
  variant?: string
}

/**
 * Whether a session used the model its context declares.
 *
 * Two honest limits, both deliberate:
 *
 * - An agent with no declaration anywhere is never scored, rather than guessed
 *   at. The root `build` agent is the common case.
 * - A mismatch does **not** imply a mistake. It can be config drift over time or
 *   a model chosen deliberately for one invocation, and the data cannot tell
 *   them apart — so callers must word it as "did not use the declared model".
 */
export function modelMismatch(
  context: ContextSummary | null,
  agent: string | undefined,
  recorded: RecordedModel | undefined,
): SessionModelMismatch | null {
  if (!context || !agent || !recorded?.providerID) return null

  const declared = context.models[agent]
  if (!declared) return null

  const expected = parseModelRef(declared)
  if (!expected) return null

  const comparison = compareModels(expected, {
    provider: recorded.providerID,
    model: recorded.id ?? '',
    variant: recorded.variant ?? 'default',
  })
  if (comparison.matches) return null

  return {
    contextId: context.id,
    contextLabel: context.label,
    expected: declared,
    recorded: `${recorded.providerID}/${recorded.id ?? '?'}#${recorded.variant ?? 'default'}`,
    differing: comparison.differing,
  }
}
