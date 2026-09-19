/**
 * Locating the things this app observes.
 *
 * Two rules shape this file:
 *
 * - The advertised host is never trusted. OpenCode reports `http://0.0.0.0:49374`;
 *   we always connect via `127.0.0.1`. The local-only invariant is not negotiable.
 * - The password is read here and stays here. It is never logged, never returned
 *   in an API response, and never reaches the client bundle.
 */

import { execFile } from 'node:child_process'
import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import type { LogFileInfo } from '#shared/types/logs'

const run = promisify(execFile)

/** The live file. Archives sit beside it and are never parsed. */
export const ACTIVE_LOG_NAME = 'opencode.log'

/** `2026-06-28T191941.log` */
const ARCHIVE_NAME = /^\d{4}-\d{2}-\d{2}T\d{6}\.log$/

const COMMAND_TIMEOUT_MS = 2000

export interface ServiceConnection {
  /** Always `127.0.0.1`, whatever the service advertises. */
  url: string
  password: string
}

// --- pure helpers -----------------------------------------------------------

/** True for the rotated archives this app inventories but never parses. */
export function isArchiveName(name: string): boolean {
  return ARCHIVE_NAME.test(name)
}

/** `http://0.0.0.0:49374` → `{ host: '0.0.0.0', port: 49374 }` */
export function parseServiceStatus(
  stdout: string,
): { host: string; port: number } | null {
  const match = /https?:\/\/([^:/\s]+):(\d+)/.exec(stdout)
  if (!match) return null
  const port = Number(match[2])
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null
  return { host: match[1] as string, port }
}

/**
 * Force the loopback address.
 *
 * The service advertises `0.0.0.0` because that is what it bound, not because
 * that is a valid destination. Connecting to it would be wrong.
 */
export function toLoopback(port: number): string {
  return `http://127.0.0.1:${port}`
}

export function parseServiceConfig(raw: string): { password: string } | null {
  try {
    const parsed = JSON.parse(raw) as { password?: unknown }
    return typeof parsed.password === 'string' && parsed.password.length > 0
      ? { password: parsed.password }
      : null
  } catch {
    return null
  }
}

/** Sort archives newest first; the UI shows the most recent at the top. */
export function sortArchives(files: LogFileInfo[]): LogFileInfo[] {
  return [...files].sort((a, b) => b.mtimeMs - a.mtimeMs)
}

// --- filesystem -------------------------------------------------------------

export function resolveDataHome(): string {
  const xdg = process.env['XDG_DATA_HOME']
  return xdg && xdg.length > 0 ? xdg : join(homedir(), '.local', 'share')
}

export function resolveConfigHome(): string {
  const xdg = process.env['XDG_CONFIG_HOME']
  return xdg && xdg.length > 0 ? xdg : join(homedir(), '.config')
}

export function resolveLogDirectory(): string {
  return join(resolveDataHome(), 'opencode', 'log')
}

export function resolveActiveLogPath(): string {
  return join(resolveLogDirectory(), ACTIVE_LOG_NAME)
}

export function resolveServiceConfigPath(): string {
  return join(resolveConfigHome(), 'opencode', 'service.json')
}

export async function listLogFiles(): Promise<{
  active: LogFileInfo | null
  archives: LogFileInfo[]
}> {
  const directory = resolveLogDirectory()

  let names: string[]
  try {
    names = await readdir(directory)
  } catch {
    return { active: null, archives: [] }
  }

  let active: LogFileInfo | null = null
  const archives: LogFileInfo[] = []

  for (const name of names) {
    const isActive = name === ACTIVE_LOG_NAME
    if (!isActive && !isArchiveName(name)) continue

    const path = join(directory, name)
    try {
      const info = await stat(path)
      if (!info.isFile()) continue
      const entry: LogFileInfo = {
        name,
        path,
        size: info.size,
        mtimeMs: info.mtimeMs,
        active: isActive,
      }
      if (isActive) active = entry
      else archives.push(entry)
    } catch {
      // Raced with rotation; skip it.
    }
  }

  return { active, archives: sortArchives(archives) }
}

// --- service ----------------------------------------------------------------

async function command(
  file: string,
  args: string[],
): Promise<string | null> {
  try {
    const { stdout } = await run(file, args, { timeout: COMMAND_TIMEOUT_MS })
    return stdout
  } catch {
    return null
  }
}

/** Read the password without ever putting it in a log line or an error. */
export async function readServicePassword(): Promise<string | null> {
  try {
    const raw = await readFile(resolveServiceConfigPath(), 'utf8')
    return parseServiceConfig(raw)?.password ?? null
  } catch {
    return null
  }
}

async function resolveServicePort(): Promise<number | null> {
  const status = await command('opencode', ['service', 'status'])
  if (status) {
    const parsed = parseServiceStatus(status)
    if (parsed) return parsed.port
  }

  // Fallback: find the listening port of an opencode process directly.
  const pids = await command('pgrep', ['-x', 'opencode'])
  const pidList = (pids ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^\d+$/.test(line))
  if (pidList.length === 0) return null

  for (const pid of pidList) {
    const lsof = await command('lsof', [
      '-nP',
      '-iTCP',
      '-sTCP:LISTEN',
      '-a',
      '-p',
      pid,
    ])
    const match = lsof ? /:(\d+)\s+\(LISTEN\)/.exec(lsof) : null
    if (match) {
      const port = Number(match[1])
      if (Number.isInteger(port) && port > 0 && port <= 65535) return port
    }
  }

  return null
}

/**
 * Resolve how to reach the OpenCode service, or null when it is not running.
 *
 * Returning null is a normal outcome, not an error: Explorer A must keep
 * working with the service stopped.
 */
export async function resolveServiceConnection(): Promise<ServiceConnection | null> {
  const password = await readServicePassword()
  if (!password) return null

  const port = await resolveServicePort()
  if (port === null) return null

  return { url: toLoopback(port), password }
}
