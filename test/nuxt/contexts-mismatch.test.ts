import { describe, expect, it } from 'vitest'

import type { ContextSummary } from '../../shared/types/contexts.ts'
import { modelMismatch } from '../../app/composables/useContexts.ts'

const context = (models: Record<string, string>): ContextSummary => ({
  id: 'default',
  label: 'Default',
  scopeDir: null,
  depth: -1,
  stack: [],
  keys: [],
  models,
})

const recorded = (providerID: string, id: string, variant?: string) => ({
  providerID,
  id,
  variant,
})

describe('modelMismatch', () => {
  it('flags a session that used a different model than declared', () => {
    const result = modelMismatch(
      context({ 'safwan-magic-research': 'openai/gpt-5.5#high' }),
      'safwan-magic-research',
      recorded('github-copilot', 'claude-opus-4.8', 'default'),
    )

    expect(result).not.toBeNull()
    expect(result?.expected).toBe('openai/gpt-5.5#high')
    expect(result?.recorded).toBe('github-copilot/claude-opus-4.8#default')
    // All three differ here, and the variant is the one a reader would overlook.
    expect(result?.differing).toEqual(['provider', 'model', 'variant'])
  })

  it('flags a variant-only difference, which is easy to miss by eye', () => {
    const result = modelMismatch(
      context({ panel: 'openai/gpt-5.6-sol#medium' }),
      'panel',
      recorded('openai', 'gpt-5.6-sol'),
    )

    // The declaration says #medium; the session recorded no variant, which
    // OpenCode resolves to #default.
    expect(result?.differing).toEqual(['variant'])
  })

  it('stays quiet when the session used the declared model', () => {
    const result = modelMismatch(
      context({ panel: 'openai/gpt-5.6-sol#medium' }),
      'panel',
      recorded('openai', 'gpt-5.6-sol', 'medium'),
    )

    expect(result).toBeNull()
  })

  it('never scores an agent nothing declares', () => {
    // The root `build` agent has no definition and no declaration. Guessing a
    // model for it would manufacture mismatches.
    expect(
      modelMismatch(context({}), 'build', recorded('anthropic', 'claude-sonnet-5')),
    ).toBeNull()
  })

  it('stays quiet when the context or the recorded model is unknown', () => {
    expect(
      modelMismatch(context({ panel: 'openai/gpt-5.6-sol' }), undefined, recorded('openai', 'x')),
    ).toBeNull()
    expect(modelMismatch(null, 'panel', recorded('openai', 'x'))).toBeNull()
    expect(modelMismatch(context({ panel: 'openai/gpt-5.6-sol' }), 'panel', undefined)).toBeNull()
  })

  it('reports the context label, so the row can say which config expected what', () => {
    const result = modelMismatch(
      { ...context({ panel: 'openai/gpt-5.6-sol#high' }), id: 'dev-ikea', label: '~/dev/ikea' },
      'panel',
      recorded('github-copilot', 'gpt-5.6-sol'),
    )

    expect(result?.contextId).toBe('dev-ikea')
    expect(result?.contextLabel).toBe('~/dev/ikea')
  })
})
