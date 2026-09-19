/**
 * OpenCode configuration contexts.
 *
 * Configuration is discovered by walking the ancestor chain of the directories
 * sessions actually ran in. That bounds the cost to the sessions that exist
 * (~940 stats for 521 sessions here) and means every context found governs real
 * work — a config in a repo OpenCode has never opened governs nothing.
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
 * config**, regardless of depth. An implementation that just takes the nearest
 * `opencode.json` gets this wrong the first time a `.opencode/` appears.
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import { frontMatterModel, tryParseJsonc } from '#shared/utils/jsonc'

import { resolveConfigHome } from './discovery'

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

/** Candidate filenames, in the order OpenCode applies them. */
export const CONFIG_FILES: ReadonlyArray<{ name: string; kind: ConfigKind }> = [
  { name: 'opencode.json', kind: 'direct' },
  { name: 'opencode.jsonc', kind: 'direct' },
  { name: '.opencode/opencode.json', kind: 'dotopencode' },
  { name: '.opencode/opencode.jsonc', kind: 'dotopencode' },
]

export function globalConfigPaths(configHome = resolveConfigHome()): string[] {
  return [
    join(configHome, 'opencode', 'opencode.json'),
    join(configHome, 'opencode', 'opencode.jsonc'),
  ]
}

async function readConfig(path: string, kind: ConfigKind): Promise<DiscoveredConfig | null> {
  let raw: string
  try {
    const info = await stat(path)
    if (!info.isFile()) return null
    raw = await readFile(path, 'utf8')
  } catch {
    return null
  }

  const scopeDir = kind === 'global'
    ? dirname(dirname(path)) // ~/.config/opencode/opencode.jsonc -> ~/.config
    : dirname(path).replace(/\/\.opencode$/, '')

  const parsed = tryParseJsonc<Record<string, unknown>>(raw)
  if (!parsed.ok) {
    return { path, scopeDir, kind, keys: [], parseError: parsed.error }
  }

  return {
    path,
    scopeDir,
    kind,
    document: parsed.value,
    keys: Object.keys(parsed.value ?? {}).sort(),
  }
}

async function readIfPresent(path: string, kind: ConfigKind) {
  return readConfig(path, kind)
}

/** `~` for the home directory, so paths read well in a UI. */
export function shortenPath(path: string, home = homedir()): string {
  return path === home ? '~' : path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path
}

/**
 * Every config file governing any of `directories`, plus the global config.
 *
 * Directories are walked to the filesystem root, because that is what OpenCode
 * does — a config one level above a project still applies to it.
 */
export async function discoverConfigs(
  directories: Iterable<string>,
  options: { configHome?: string } = {},
): Promise<DiscoveredConfig[]> {
  const found = new Map<string, DiscoveredConfig>()

  for (const path of globalConfigPaths(options.configHome)) {
    const config = await readIfPresent(path, 'global')
    if (config) found.set(config.path, config)
  }

  const visitedDirs = new Set<string>()

  for (const start of directories) {
    let dir = start
    while (true) {
      if (!visitedDirs.has(dir)) {
        visitedDirs.add(dir)
        for (const { name, kind } of CONFIG_FILES) {
          const path = join(dir, name)
          if (found.has(path)) continue
          const config = await readConfig(path, kind)
          if (config) found.set(config.path, config)
        }
      }

      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  }

  return [...found.values()]
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

export interface Context {
  id: string
  /** Home-relative scope, or `Default` for the global-only context. */
  label: string
  /** Null for the default context, which has no scope directory of its own. */
  scopeDir: string | null
  stack: DiscoveredConfig[]
  depth: number
  /** Keys contributed beyond the global config, i.e. what makes this context. */
  keys: string[]
}

/**
 * The contexts a session can belong to.
 *
 * One per config-carrying directory, plus the default. A session belongs to the
 * innermost context whose scope contains it.
 */
export function buildContexts(configs: DiscoveredConfig[]): Context[] {
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
      stack.filter((c) => c.kind === 'global').flatMap((c) => c.keys),
    )
    const keys = [...new Set(scopeConfigs.flatMap((c) => c.keys))]
      .filter((key) => !globalKeys.has(key))
      .sort()

    contexts.push({
      id: shortenPath(scopeDir).replace(/^\W+/, '').replace(/\W+/g, '-').toLowerCase() || 'scope',
      label: shortenPath(scopeDir),
      scopeDir,
      stack,
      depth: depthOf(scopeDir),
      keys,
    })
  }

  return contexts.sort((a, b) => b.depth - a.depth)
}

/** The innermost context whose scope contains `dir`, or the default one. */
export function contextFor(dir: string, contexts: Context[]): Context | null {
  let best: Context | null = null
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

/** Reads agent definitions from the global config dir. */
export async function readAgentDefinitions(
  configHome = resolveConfigHome(),
): Promise<Map<string, string>> {
  const definitions = new Map<string, string>()
  const dir = join(configHome, 'opencode', 'agents')

  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return definitions
  }

  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue
    try {
      const model = frontMatterModel(await readFile(join(dir, entry), 'utf8'))
      if (model) definitions.set(entry.slice(0, -3), model)
    } catch {
      // A definition we cannot read simply provides no baseline.
    }
  }

  return definitions
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

export interface ModelComparison {
  matches: boolean
  /** Fields that differ, so a caller can say precisely what changed. */
  differing: Array<'provider' | 'model' | 'variant'>
}

export function compareModels(expected: ModelRef, recorded: ModelRef): ModelComparison {
  const differing: ModelComparison['differing'] = []
  if (expected.provider !== recorded.provider) differing.push('provider')
  if (expected.model !== recorded.model) differing.push('model')
  if (expected.variant !== recorded.variant) differing.push('variant')
  return { matches: differing.length === 0, differing }
}
