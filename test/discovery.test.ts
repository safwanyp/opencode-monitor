import { describe, expect, it } from 'vitest'

import {
  isArchiveName,
  parseServiceConfig,
  parseServiceStatus,
  resolveActiveLogPath,
  resolveLogDirectory,
  sortArchives,
  toLoopback,
} from '../server/utils/discovery.ts'

describe('isArchiveName', () => {
  it('matches the timestamped archives', () => {
    expect(isArchiveName('2026-06-28T191941.log')).toBe(true)
    expect(isArchiveName('2026-06-07T205940.log')).toBe(true)
  })

  it('does not match the live file or unrelated logs', () => {
    expect(isArchiveName('opencode.log')).toBe(false)
    expect(isArchiveName('safwan-magic.log')).toBe(false)
    expect(isArchiveName('2026-06-28.log')).toBe(false)
    expect(isArchiveName('2026-06-28T191941.log.gz')).toBe(false)
  })
})

describe('parseServiceStatus', () => {
  it('extracts the advertised host and port', () => {
    expect(parseServiceStatus('http://0.0.0.0:49374\n')).toEqual({
      host: '0.0.0.0',
      port: 49374,
    })
    expect(parseServiceStatus('http://127.0.0.1:4321')).toEqual({
      host: '127.0.0.1',
      port: 4321,
    })
  })

  it('tolerates surrounding output', () => {
    expect(parseServiceStatus('service running at http://0.0.0.0:51000 (pid 42)')).toEqual({
      host: '0.0.0.0',
      port: 51000,
    })
  })

  it('returns null when there is nothing to parse', () => {
    expect(parseServiceStatus('')).toBeNull()
    expect(parseServiceStatus('service not running')).toBeNull()
    expect(parseServiceStatus('http://0.0.0.0:99999')).toBeNull()
    expect(parseServiceStatus('http://0.0.0.0:0')).toBeNull()
  })
})

describe('toLoopback', () => {
  it('never returns the advertised wildcard address', () => {
    // The service binds 0.0.0.0 because that is what it bound, not because it
    // is a valid destination.
    expect(toLoopback(49374)).toBe('http://127.0.0.1:49374')
    expect(toLoopback(49374)).not.toContain('0.0.0.0')
  })
})

describe('parseServiceConfig', () => {
  it('reads the password field', () => {
    expect(parseServiceConfig('{"password":"secret","hostname":"0.0.0.0"}')).toEqual({
      password: 'secret',
    })
  })

  it('rejects unusable payloads rather than returning a partial result', () => {
    expect(parseServiceConfig('not json')).toBeNull()
    expect(parseServiceConfig('{}')).toBeNull()
    expect(parseServiceConfig('{"password":""}')).toBeNull()
    expect(parseServiceConfig('{"password":42}')).toBeNull()
  })
})

describe('sortArchives', () => {
  it('orders newest first', () => {
    const sorted = sortArchives([
      { name: 'a', path: '/a', size: 1, mtimeMs: 100, active: false },
      { name: 'b', path: '/b', size: 1, mtimeMs: 300, active: false },
      { name: 'c', path: '/c', size: 1, mtimeMs: 200, active: false },
    ])
    expect(sorted.map((f) => f.name)).toEqual(['b', 'c', 'a'])
  })

  it('does not mutate its input', () => {
    const input = [
      { name: 'a', path: '/a', size: 1, mtimeMs: 100, active: false },
      { name: 'b', path: '/b', size: 1, mtimeMs: 300, active: false },
    ]
    sortArchives(input)
    expect(input.map((f) => f.name)).toEqual(['a', 'b'])
  })
})

describe('path resolution', () => {
  it('honours XDG overrides so tests and users can relocate the log', () => {
    const previous = process.env['XDG_DATA_HOME']
    process.env['XDG_DATA_HOME'] = '/tmp/xdg-data'
    try {
      expect(resolveLogDirectory()).toBe('/tmp/xdg-data/opencode/log')
      expect(resolveActiveLogPath()).toBe('/tmp/xdg-data/opencode/log/opencode.log')
    } finally {
      if (previous === undefined) delete process.env['XDG_DATA_HOME']
      else process.env['XDG_DATA_HOME'] = previous
    }
  })
})
