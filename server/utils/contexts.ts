/**
 * OpenCode configuration contexts — the filesystem half.
 *
 * Discovery walks the ancestor chain of the directories sessions actually ran
 * in. That bounds the cost to the sessions that exist (~940 stat() calls for 521
 * sessions here) and means every context found governs real work — a config in a
 * repo OpenCode has never opened governs nothing.
 *
 * The resolution rules themselves are pure and live in `shared/utils/contexts.ts`,
 * so the client can attribute sessions to contexts without reimplementing them.
 * Nothing is re-exported from here: Nuxt already auto-imports `shared/utils/*`,
 * and re-exporting produced duplicate-name warnings on every start.
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import {
  buildContexts,
  type ConfigKind,
  type Context,
  type DiscoveredConfig,
} from '#shared/utils/contexts'
import { frontMatterModel, tryParseJsonc } from '#shared/utils/jsonc'

import { resolveConfigHome } from './discovery'

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

/** `~` for the home directory, so paths read well in a UI. */
export function shortenPath(path: string, home = homedir()): string {
  if (path === home) return '~'
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path
}

async function readConfig(
  path: string,
  kind: ConfigKind,
): Promise<DiscoveredConfig | null> {
  let raw: string
  try {
    const info = await stat(path)
    if (!info.isFile()) return null
    raw = await readFile(path, 'utf8')
  } catch {
    return null
  }

  // `~/.config/opencode/opencode.jsonc` scopes its grandparent, while a
  // `.opencode/opencode.jsonc` scopes the directory containing `.opencode/`.
  const scopeDir =
    kind === 'global'
      ? dirname(dirname(path))
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

/**
 * Every config file governing any of `directories`, plus the global config.
 *
 * Directories are walked to the filesystem root, because that is what OpenCode
 * does — a config one level above a project still applies to it. The global
 * config is added explicitly, since it is on no session's ancestor chain.
 */
export async function discoverConfigs(
  directories: Iterable<string>,
  options: { configHome?: string } = {},
): Promise<DiscoveredConfig[]> {
  const found = new Map<string, DiscoveredConfig>()

  for (const path of globalConfigPaths(options.configHome)) {
    const config = await readConfig(path, 'global')
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

/** Agent definitions from the global config dir — the baseline configs override. */
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

export interface DiscoveredLayout {
  configs: DiscoveredConfig[]
  contexts: Context[]
  definitions: Map<string, string>
}

/**
 * Discover configs from the directories sessions ran in, and build the contexts.
 *
 * Directories come from the caller rather than from a filesystem scan, which is
 * what keeps this cheap and keeps unused configs out of the result.
 */
export async function discoverLayout(
  directories: Iterable<string>,
  options: { configHome?: string } = {},
): Promise<DiscoveredLayout> {
  const configs = await discoverConfigs(directories, options)
  const contexts = buildContexts(configs, (path) => shortenPath(path))
  const definitions = await readAgentDefinitions(options.configHome)
  return { configs, contexts, definitions }
}
