/**
 * OpenCode configuration contexts — the pure half.
 *
 * Lives in `shared/` so the client can attribute a session to a context without
 * duplicating the prefix rules. Deliberately no node built-ins: nothing here may
 * pull `node:path` or `node:fs` into the browser bundle. Path joining and file
 * reading live in `server/utils/contexts.ts`.
 *
 * ## Precedence
 *
 * Lowest to highest:
 *
 *   1. the global config (`~/.config/opencode/opencode.json(c)`)
 *   2. direct `opencode.json(c)` files, farthest ancestor → nearest
 *   3. `.opencode/opencode.json(c)` files, farthest ancestor → nearest
 *
 * Step 3 is the surprising one: **every `.opencode` config outranks every direct
 * config**, regardless of depth. An implementation that takes the nearest
 * `opencode.json` is right until the day a `.opencode/` appears, then silently
 * wrong.
 */

export type ConfigKind = 'global' | 'direct' | 'dotopencode'

export interface DiscoveredConfig {
  path: string
  /** The directory this file scopes. */
  scopeDir: string
  kind: ConfigKind
  /** Parsed document, absent when the file could not be read or parsed. */
  document?: unknown
  /** Top-level keys the file sets, so a context can say what it contributes. */
  keys: string[]
  parseError?: string
}

export interface Context {
  id: string
  /** Home-shortened scope, or `Default` for the global-only context. */
  label: string
  /** Null for the default context, which has no scope directory of its own. */
  scopeDir: string | null
  stack: DiscoveredConfig[]
  depth: number
  /** Keys contributed beyond the global config, i.e. what makes this context. */
  keys: string[]
}

/** Path segments, used to order ancestors from least to most specific. */
export function depthOf(path: string): number {
  return path.split('/').filter(Boolean).length
}

export function isAncestorOf(scopeDir: string, dir: string): boolean {
  return dir === scopeDir || dir.startsWith(scopeDir.endsWith('/') ? scopeDir : `${scopeDir}/`)
}

/**
 * The configs governing `dir`, lowest precedence first.
 *
 * This is the function the whole feature rests on, so it is pure and tested
 * independently of the filesystem.
 */
export function stackFor(dir: string, configs: DiscoveredConfig[]): DiscoveredConfig[] {
  const byDepth = (kind: ConfigKind) =>
    configs
      .filter((config) => config.kind === kind && isAncestorOf(config.scopeDir, dir))
      .sort((a, b) => depthOf(a.scopeDir) - depthOf(b.scopeDir))

  return [
    // The global config applies everywhere, and is the lowest precedence.
    ...configs.filter((config) => config.kind === 'global'),
    ...byDepth('direct'),
    // Applied last, so a `.opencode` config outranks every direct one.
    ...byDepth('dotopencode'),
  ]
}

export function contextIdFor(scopeDir: string): string {
  const slug = scopeDir
    .replace(/^[^A-Za-z0-9]+/, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/-+$/, '')
    .toLowerCase()
  return slug === '' ? 'scope' : slug
}

/**
 * The contexts a session can belong to: one per config-carrying directory, plus
 * the default.
 *
 * `shorten` only affects the display label; attribution never depends on it.
 */
export function buildContexts(
  configs: DiscoveredConfig[],
  shorten: (path: string) => string = (path) => path,
): Context[] {
  const scopes = new Map<string, DiscoveredConfig[]>()

  for (const config of configs) {
    if (config.kind === 'global') continue
    const list = scopes.get(config.scopeDir)
    if (list) list.push(config)
    else scopes.set(config.scopeDir, [config])
  }

  const contexts: Context[] = [
    {
      id: 'default',
      label: 'Default',
      scopeDir: null,
      // No scope directory to walk, so the global config is the whole stack.
      stack: configs.filter((config) => config.kind === 'global'),
      depth: -1,
      keys: [],
    },
  ]

  for (const [scopeDir, scopeConfigs] of scopes) {
    const stack = stackFor(scopeDir, configs)
    const globalKeys = new Set(
      stack.filter((config) => config.kind === 'global').flatMap((config) => config.keys),
    )
    const keys = [...new Set(scopeConfigs.flatMap((config) => config.keys))]
      .filter((key) => !globalKeys.has(key))
      .sort()

    contexts.push({
      id: contextIdFor(scopeDir),
      label: shorten(scopeDir),
      scopeDir,
      stack,
      depth: depthOf(scopeDir),
      keys,
    })
  }

  return contexts.sort((a, b) => b.depth - a.depth)
}

/** Everything attribution needs. The API sends a slimmer context than `Context`. */
export interface ContextScope {
  id: string
  scopeDir: string | null
  depth: number
}

/** The innermost context whose scope contains `dir`, or the default one. */
export function contextFor<T extends ContextScope>(dir: string, contexts: T[]): T | null {
  let best: T | null = null
  for (const context of contexts) {
    if (context.scopeDir === null) continue
    if (!isAncestorOf(context.scopeDir, dir)) continue
    if (!best || context.depth > best.depth) best = context
  }
  return best ?? contexts.find((context) => context.id === 'default') ?? null
}

export interface ModelRef {
  provider: string
  model: string
  /** OpenCode's own default when the declaration omits `#variant`. */
  variant: string
}

export const DEFAULT_VARIANT = 'default'

/** `github-copilot/gpt-5.6-sol` or `openai/gpt-5.6-sol#medium`. */
export function parseModelRef(value: string | undefined | null): ModelRef | null {
  if (!value) return null
  const trimmed = value.trim()
  const hash = trimmed.indexOf('#')
  const body = hash === -1 ? trimmed : trimmed.slice(0, hash)
  const variant = hash === -1 ? DEFAULT_VARIANT : trimmed.slice(hash + 1) || DEFAULT_VARIANT
  const slash = body.indexOf('/')
  if (slash <= 0 || slash === body.length - 1) return null
  return {
    provider: body.slice(0, slash),
    model: body.slice(slash + 1),
    variant,
  }
}

export function formatModelRef(ref: ModelRef): string {
  return `${ref.provider}/${ref.model}#${ref.variant}`
}

function agentModelIn(document: unknown, agent: string): string | undefined {
  if (!document || typeof document !== 'object') return undefined
  const agents = (document as Record<string, unknown>)['agents']
  if (!agents || typeof agents !== 'object') return undefined
  const entry = (agents as Record<string, unknown>)[agent]
  if (typeof entry === 'string') return entry
  if (entry && typeof entry === 'object') {
    const model = (entry as Record<string, unknown>)['model']
    if (typeof model === 'string') return model
  }
  return undefined
}

export function declaredModelIn(document: unknown, agent: string): string | undefined {
  return agentModelIn(document, agent)
}

/**
 * The model an agent should use in a context.
 *
 * The most specific declaration wins, and it **replaces** the definition's
 * wholesale rather than merging field by field — verified against the live
 * workspace, where a config declaring `github-copilot/gpt-5.6-sol` with no
 * variant produced `#default` sessions even though the definition said `#medium`.
 */
export function expectedModel(
  agent: string,
  stack: DiscoveredConfig[],
  definitions: Map<string, string>,
): ModelRef | null {
  for (let i = stack.length - 1; i >= 0; i--) {
    const declared = agentModelIn(stack[i]?.document, agent)
    if (declared) return parseModelRef(declared)
  }

  return parseModelRef(definitions.get(agent))
}

/**
 * Every agent this context can score, with the model it should have used.
 *
 * Resolved on the server so the client does no config parsing and cannot
 * disagree with it about what a context declares.
 */
export function resolvedModels(
  stack: DiscoveredConfig[],
  definitions: Map<string, string>,
): Record<string, string> {
  const agents = new Set<string>(definitions.keys())

  for (const config of stack) {
    const document = config.document
    if (!document || typeof document !== 'object') continue
    const declared = (document as Record<string, unknown>)['agents']
    if (!declared || typeof declared !== 'object') continue
    for (const agent of Object.keys(declared)) agents.add(agent)
  }

  const out: Record<string, string> = {}
  for (const agent of [...agents].sort()) {
    const ref = expectedModel(agent, stack, definitions)
    if (ref) out[agent] = formatModelRef(ref)
  }
  return out
}

export type ModelField = 'provider' | 'model' | 'variant'

export interface ModelComparison {
  matches: boolean
  /** Fields that differ, so a caller can say precisely what changed. */
  differing: ModelField[]
}

export function compareModels(expected: ModelRef, recorded: ModelRef): ModelComparison {
  const differing: ModelField[] = []
  if (expected.provider !== recorded.provider) differing.push('provider')
  if (expected.model !== recorded.model) differing.push('model')
  if (expected.variant !== recorded.variant) differing.push('variant')
  return { matches: differing.length === 0, differing }
}
