import { describe, expect, it } from 'vitest'

import {
  compareModels,
  contextFor,
  buildContexts,
  depthOf,
  expectedModel,
  isAncestorOf,
  parseModelRef,
  stackFor,
  type ConfigKind,
  type DiscoveredConfig,
} from '../server/utils/contexts.ts'
import { frontMatterModel, parseJsonc, stripJsonc, tryParseJsonc } from '../shared/utils/jsonc.ts'

const HOME = '/Users/me'

function cfg(
  path: string,
  kind: ConfigKind,
  scopeDir: string,
  document?: unknown,
): DiscoveredConfig {
  return {
    path,
    scopeDir,
    kind,
    document,
    keys: document && typeof document === 'object' ? Object.keys(document).sort() : [],
  }
}

const GLOBAL = cfg(
  `${HOME}/.config/opencode/opencode.jsonc`,
  'global',
  `${HOME}/.config`,
  { mcp: {}, skills: [] },
)

describe('stripJsonc', () => {
  it('removes line comments', () => {
    expect(stripJsonc('{\n  // a note\n  "a": 1\n}')).toBe('{\n  \n  "a": 1\n}')
  })

  it('removes block comments', () => {
    expect(stripJsonc('{ /* why */ "a": 1 }')).toBe('{  "a": 1 }')
  })

  it('keeps // inside a string value', () => {
    // A regex that strips `//` would corrupt every URL — the real config has one.
    const input = '{ "url": "https://mcp.linear.app/mcp" }'
    expect(parseJsonc(input)).toEqual({ url: 'https://mcp.linear.app/mcp' })
  })

  it('removes trailing commas in objects and arrays', () => {
    expect(parseJsonc('{ "a": [1, 2,], "b": 3, }')).toEqual({ a: [1, 2], b: 3 })
  })

  it('removes a trailing comma followed by a comment', () => {
    expect(parseJsonc('{ "a": 1, // last\n }')).toEqual({ a: 1 })
  })

  it('keeps a comma that is genuinely separating', () => {
    expect(parseJsonc('{ "a": 1, "b": 2 }')).toEqual({ a: 1, b: 2 })
  })

  it('leaves a comma inside a string alone', () => {
    expect(parseJsonc('{ "a": "x,]y" }')).toEqual({ a: 'x,]y' })
  })

  it('handles escaped quotes without losing string state', () => {
    expect(parseJsonc('{ "a": "he said \\"hi\\" // not a comment" }')).toEqual({
      a: 'he said "hi" // not a comment',
    })
  })

  it('tolerates a leading BOM', () => {
    expect(parseJsonc('\uFEFF{ "a": 1 }')).toEqual({ a: 1 })
  })

  it('parses the real config shape', () => {
    const real = `{
  "$schema": "https://opencode.ai/config.json",
  "agents": {
    "comment-sicko": {
      "model": "github-copilot/gpt-5.6-terra" // work only
    },
  },
}`
    expect(parseJsonc(real)).toEqual({
      $schema: 'https://opencode.ai/config.json',
      agents: { 'comment-sicko': { model: 'github-copilot/gpt-5.6-terra' } },
    })
  })

  it('reports malformed input instead of throwing, via tryParseJsonc', () => {
    expect(tryParseJsonc('{ nope }').ok).toBe(false)
    expect(tryParseJsonc('{ "a": 1 }').ok).toBe(true)
  })
})

describe('frontMatterModel', () => {
  const markdown = `---
description: A reviewer
mode: subagent
model: openai/gpt-5.6-sol#medium
steps: 25
---
Body text mentioning model: something else.
`

  it('reads the model from front matter only', () => {
    expect(frontMatterModel(markdown)).toBe('openai/gpt-5.6-sol#medium')
  })

  it('returns null when there is no front matter or no model', () => {
    expect(frontMatterModel('no front matter here')).toBeNull()
    expect(frontMatterModel('---\ndescription: x\n---\n')).toBeNull()
  })
})

describe('parseModelRef', () => {
  it('parses provider and model', () => {
    expect(parseModelRef('github-copilot/gpt-5.6-sol')).toEqual({
      provider: 'github-copilot',
      model: 'gpt-5.6-sol',
      variant: 'default',
    })
  })

  it('parses an explicit variant', () => {
    expect(parseModelRef('openai/gpt-5.6-sol#medium')).toEqual({
      provider: 'openai',
      model: 'gpt-5.6-sol',
      variant: 'medium',
    })
  })

  it('treats a missing variant as default, matching what OpenCode records', () => {
    // Verified: a config declaring no variant produced `#default` sessions even
    // though the agent definition said `#medium`.
    expect(parseModelRef('github-copilot/gpt-5.6-sol')?.variant).toBe('default')
  })

  it('rejects anything without a provider', () => {
    expect(parseModelRef(undefined)).toBeNull()
    expect(parseModelRef('')).toBeNull()
    expect(parseModelRef('gpt-5.6-sol')).toBeNull()
    expect(parseModelRef('openai/')).toBeNull()
  })
})

describe('isAncestorOf / depthOf', () => {
  it('treats a directory as its own ancestor', () => {
    expect(isAncestorOf('/a/b', '/a/b')).toBe(true)
  })

  it('matches descendant directories only', () => {
    expect(isAncestorOf('/a/b', '/a/b/c')).toBe(true)
    expect(isAncestorOf('/a/b', '/a/bc')).toBe(false)
    expect(isAncestorOf('/a/b', '/a')).toBe(false)
  })

  it('counts path segments', () => {
    expect(depthOf('/a/b/c')).toBe(3)
    expect(depthOf('/')).toBe(0)
  })
})

describe('stackFor precedence', () => {
  it('puts the global config lowest', () => {
    const stack = stackFor(`${HOME}/dev/x`, [GLOBAL])
    expect(stack.map((c) => c.kind)).toEqual(['global'])
  })

  it('orders direct configs from the farthest ancestor inward', () => {
    const dev = cfg(`${HOME}/dev/opencode.jsonc`, 'direct', `${HOME}/dev`)
    const ikea = cfg(`${HOME}/dev/ikea/opencode.jsonc`, 'direct', `${HOME}/dev/ikea`)
    const stack = stackFor(`${HOME}/dev/ikea/rew`, [ikea, dev, GLOBAL])
    expect(stack.map((c) => c.path)).toEqual([GLOBAL.path, dev.path, ikea.path])
  })

  it('excludes a direct config that is not an ancestor', () => {
    const other = cfg(`${HOME}/dev/other/opencode.jsonc`, 'direct', `${HOME}/dev/other`)
    expect(stackFor(`${HOME}/dev/ikea`, [GLOBAL, other]).map((c) => c.path)).toEqual([
      GLOBAL.path,
    ])
  })

  it('applies every .opencode config after every direct config', () => {
    // The surprising rule: a shallower `.opencode` still outranks a deeper
    // direct config. Taking the nearest file would get this backwards.
    const deepDirect = cfg(
      `${HOME}/dev/ikea/rew/sub/opencode.jsonc`,
      'direct',
      `${HOME}/dev/ikea/rew/sub`,
    )
    const shallowDot = cfg(
      `${HOME}/dev/ikea/rew/.opencode/opencode.jsonc`,
      'dotopencode',
      `${HOME}/dev/ikea/rew`,
    )
    const stack = stackFor(`${HOME}/dev/ikea/rew/sub`, [GLOBAL, deepDirect, shallowDot])
    expect(stack.map((c) => c.kind)).toEqual(['global', 'direct', 'dotopencode'])
    expect(stack.at(-1)?.path).toBe(shallowDot.path)
  })

  it('breaks ties between same-depth kinds in favour of .opencode', () => {
    const direct = cfg(`${HOME}/dev/x/opencode.jsonc`, 'direct', `${HOME}/dev/x`)
    const dot = cfg(`${HOME}/dev/x/.opencode/opencode.jsonc`, 'dotopencode', `${HOME}/dev/x`)
    const stack = stackFor(`${HOME}/dev/x`, [GLOBAL, direct, dot])
    expect(stack.map((c) => c.kind)).toEqual(['global', 'direct', 'dotopencode'])
  })
})

describe('buildContexts', () => {
  const dev = cfg(`${HOME}/dev/opencode.jsonc`, 'direct', `${HOME}/dev`, { formatter: {} })
  const ikea = cfg(`${HOME}/dev/ikea/opencode.jsonc`, 'direct', `${HOME}/dev/ikea`, {
    agents: {},
  })
  const rew = cfg(`${HOME}/dev/ikea/rew/.opencode/opencode.jsonc`, 'dotopencode', `${HOME}/dev/ikea/rew`, {
    permissions: [],
  })
  const contexts = buildContexts([GLOBAL, dev, ikea, rew])

  it('includes a default context for global-only sessions', () => {
    const def = contexts.find((c) => c.id === 'default')
    expect(def?.scopeDir).toBeNull()
    expect(def?.stack.map((c) => c.kind)).toEqual(['global'])
  })

  it('creates one context per config-carrying directory', () => {
    expect(contexts.filter((c) => c.scopeDir !== null).map((c) => c.scopeDir).sort()).toEqual(
      [`${HOME}/dev`, `${HOME}/dev/ikea`, `${HOME}/dev/ikea/rew`].sort(),
    )
  })

  it('lists contexts deepest first', () => {
    const depths = contexts.filter((c) => c.scopeDir !== null).map((c) => c.depth)
    expect(depths).toEqual([...depths].sort((a, b) => b - a))
  })

  it('reports the keys a context contributes beyond the global one', () => {
    const devContext = contexts.find((c) => c.scopeDir === `${HOME}/dev`)
    expect(devContext?.keys).toEqual(['formatter'])
    // The global already sets `skills` and `mcp`, so they are not "contributed".
    expect(devContext?.keys).not.toContain('skills')
  })

  it('gives each context a unique, readable label', () => {
    const labels = contexts.map((c) => c.label)
    expect(new Set(labels).size).toBe(labels.length)
    expect(labels).toContain('Default')
    expect(labels.some((l) => l.includes('ikea'))).toBe(true)
  })
})

describe('contextFor', () => {
  const contexts = buildContexts([
    GLOBAL,
    cfg(`${HOME}/dev/ikea/opencode.jsonc`, 'direct', `${HOME}/dev/ikea`, {}),
    cfg(`${HOME}/dev/ikea/rew/.opencode/opencode.jsonc`, 'dotopencode', `${HOME}/dev/ikea/rew`, {}),
  ])

  it('picks the innermost scope', () => {
    expect(contextFor(`${HOME}/dev/ikea/rew/sub`, contexts)?.scopeDir).toBe(
      `${HOME}/dev/ikea/rew`,
    )
    expect(contextFor(`${HOME}/dev/ikea/other`, contexts)?.scopeDir).toBe(`${HOME}/dev/ikea`)
  })

  it('falls back to the default context when nothing governs the directory', () => {
    expect(contextFor(`${HOME}/dev/pers/x`, contexts)?.id).toBe('default')
  })

  it('never matches a sibling with a shared prefix', () => {
    // /dev/ikea must not claim /dev/ikeafoo.
    expect(contextFor(`${HOME}/dev/ikeafoo`, contexts)?.id).toBe('default')
  })
})

describe('expectedModel', () => {
  const definitions = new Map([
    ['panel-a', 'openai/gpt-5.6-sol#medium'],
    ['panel-b', 'openai/gpt-5.5#high'],
  ])

  const globalWith = cfg(`${HOME}/.config/opencode/opencode.jsonc`, 'global', `${HOME}/.config`, {
    agents: { 'panel-b': { model: 'openai/gpt-5.5#high' } },
  })

  it('falls back to the agent definition', () => {
    expect(expectedModel('panel-a', [GLOBAL], definitions)).toEqual({
      provider: 'openai',
      model: 'gpt-5.6-sol',
      variant: 'medium',
    })
  })

  it('lets a config override the definition', () => {
    const ikea = cfg(`${HOME}/dev/ikea/opencode.jsonc`, 'direct', `${HOME}/dev/ikea`, {
      agents: { 'panel-a': { model: 'github-copilot/gpt-5.6-sol' } },
    })
    expect(expectedModel('panel-a', [globalWith, ikea], definitions)).toEqual({
      provider: 'github-copilot',
      model: 'gpt-5.6-sol',
      variant: 'default',
    })
  })

  it('replaces the definition wholesale rather than merging fields', () => {
    // The live case: config omits the variant and the session records `default`
    // rather than inheriting the definition's `#medium`.
    const ikea = cfg(`${HOME}/dev/ikea/opencode.jsonc`, 'direct', `${HOME}/dev/ikea`, {
      agents: { 'panel-a': { model: 'github-copilot/gpt-5.6-sol' } },
    })
    expect(expectedModel('panel-a', [ikea], definitions)?.variant).toBe('default')
  })

  it('returns null for an agent with no declaration anywhere', () => {
    // The root `build` agent has no definition, so it must not be flagged.
    expect(expectedModel('build', [GLOBAL], definitions)).toBeNull()
  })

  it('accepts the shorthand where the agent maps straight to a model string', () => {
    const shorthand = cfg(`${HOME}/dev/x/opencode.jsonc`, 'direct', `${HOME}/dev/x`, {
      agents: { 'panel-b': 'github-copilot/claude-opus-4.8' },
    })
    expect(expectedModel('panel-b', [shorthand], definitions)).toEqual({
      provider: 'github-copilot',
      model: 'claude-opus-4.8',
      variant: 'default',
    })
  })
})

describe('compareModels', () => {
  it('matches identical refs', () => {
    const ref = parseModelRef('openai/gpt-5.6-sol#medium')!
    expect(compareModels(ref, ref).matches).toBe(true)
  })

  it('names the fields that differ', () => {
    const result = compareModels(
      parseModelRef('openai/gpt-5.6-sol#medium')!,
      parseModelRef('github-copilot/gpt-5.6-sol#default')!,
    )
    expect(result.matches).toBe(false)
    expect(result.differing).toEqual(['provider', 'variant'])
  })

  it('flags a variant-only difference', () => {
    const result = compareModels(
      parseModelRef('openai/gpt-5.6-sol#medium')!,
      parseModelRef('openai/gpt-5.6-sol#high')!,
    )
    expect(result.differing).toEqual(['variant'])
  })
})
