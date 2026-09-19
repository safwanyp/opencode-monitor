#!/usr/bin/env node
/**
 * Full-file verification harness for the logfmt parser.
 *
 * This is the definition of done for Phase 1: every line of the live log and
 * of at least one rotated archive must parse with zero failures. It runs
 * standalone (plain `node`, no Nuxt, no build step) so it can be run from a
 * clean checkout against any file.
 *
 *   node scripts/verify-logfmt.ts ~/.local/share/opencode/log/opencode.log
 *   node scripts/verify-logfmt.ts --top=8 <file> [more files...]
 *
 * Exit codes: 0 all good · 1 any failure · 2 bad usage or unreadable file.
 */

import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { basename } from 'node:path'
import { createInterface } from 'node:readline'

import {
  LogfmtParseError,
  parseLogfmt,
  toLogRecord,
} from '../shared/utils/logfmt.ts'

interface Failure {
  /** 1-based line number in the file. */
  line: number
  reason: string
  index: number
  text: string
}

interface FileReport {
  path: string
  bytes: number
  lines: number
  parsed: number
  failed: number
  /** Parsed cleanly, but carries no `timestamp` and so cannot be a record. */
  unmappable: number
  levels: Map<string, number>
  roles: Map<string, number>
  messages: Map<string, number>
  failures: Failure[]
  ms: number
}

const DEFAULT_MAX_FAILURES = 20
const DEFAULT_TOP = 5

function bump(counter: Map<string, number>, key: string): void {
  counter.set(key, (counter.get(key) ?? 0) + 1)
}

async function verify(
  path: string,
  maxFailures: number,
): Promise<FileReport> {
  const info = await stat(path)
  if (!info.isFile()) throw new Error(`not a file: ${path}`)

  const report: FileReport = {
    path,
    bytes: info.size,
    lines: 0,
    parsed: 0,
    failed: 0,
    unmappable: 0,
    levels: new Map(),
    roles: new Map(),
    messages: new Map(),
    failures: [],
    ms: 0,
  }

  const started = process.hrtime.bigint()
  const stream = createReadStream(path, { encoding: 'utf8' })
  const lines = createInterface({ input: stream, crlfDelay: Infinity })

  let lineNumber = 0

  for await (const line of lines) {
    lineNumber++
    report.lines++

    let fields: Record<string, string>

    try {
      fields = parseLogfmt(line)
    } catch (error) {
      report.failed++
      if (error instanceof LogfmtParseError) {
        if (report.failures.length < maxFailures) {
          report.failures.push({
            line: lineNumber,
            reason: error.message.replace(/ at index \d+$/, ''),
            index: error.index,
            text: line,
          })
        }
      } else {
        throw error
      }
      continue
    }

    report.parsed++

    const record = toLogRecord(fields)

    if (!record.ts) {
      report.unmappable++
      if (report.failures.length < maxFailures) {
        report.failures.push({
          line: lineNumber,
          reason: 'no timestamp field',
          index: 0,
          text: line,
        })
      }
    }

    bump(report.levels, record.level)
    if (record.role) bump(report.roles, record.role)
    if (record.message) bump(report.messages, record.message)
  }

  report.ms = Number(process.hrtime.bigint() - started) / 1e6
  return report
}

function sortedEntries(counter: Map<string, number>): Array<[string, number]> {
  return [...counter.entries()].sort((a, b) => b[1] - a[1])
}

function num(value: number): string {
  return value.toLocaleString('en-US')
}

function printReport(report: FileReport, top: number): void {
  const mb = (report.bytes / 1e6).toFixed(1)
  const rate = Math.round(report.lines / Math.max(report.ms / 1000, 0.001))

  console.log(`\n${basename(report.path)}  ·  ${mb} MB`)
  console.log(`  lines       ${num(report.lines).padStart(10)}`)
  console.log(`  parsed      ${num(report.parsed).padStart(10)}`)
  console.log(
    `  failed      ${num(report.failed).padStart(10)}${report.failed === 0 ? '   ok' : '   <-- FAIL'}`,
  )
  console.log(
    `  no ts       ${num(report.unmappable).padStart(10)}${report.unmappable === 0 ? '   ok' : '   <-- FAIL'}`,
  )
  console.log(`  ${(report.ms / 1000).toFixed(2)}s  (${num(rate)} lines/s)`)

  const levels = sortedEntries(report.levels)
  if (levels.length) {
    console.log(
      `  levels      ${levels.map(([k, v]) => `${k} ${num(v)}`).join(' · ')}`,
    )
  }

  const roles = sortedEntries(report.roles)
  if (roles.length) {
    console.log(
      `  roles       ${roles.map(([k, v]) => `${k} ${num(v)}`).join(' · ')}`,
    )
  }

  const messages = sortedEntries(report.messages).slice(0, top)
  if (messages.length) {
    const heartbeat = messages.reduce((total, [, count]) => total + count, 0)
    const share = ((heartbeat / Math.max(report.parsed, 1)) * 100).toFixed(0)
    console.log(`  top messages (${share}% of parsed volume in the top ${messages.length}):`)
    for (const [message, count] of messages) {
      console.log(`    ${num(count).padStart(9)}  ${message}`)
    }
  }

  if (report.failures.length) {
    console.log(`\n  first failures:`)
    for (const failure of report.failures) {
      console.log(`\n  line ${failure.line}: ${failure.reason}`)
      console.log(`    ${failure.text}`)
      const pad = '    ' + ' '.repeat(Math.max(failure.index, 0))
      console.log(`${pad}^`)
    }
  }
}

interface Options {
  files: string[]
  maxFailures: number
  top: number
}

function parseArgs(argv: string[]): Options {
  const files: string[] = []
  let maxFailures = DEFAULT_MAX_FAILURES
  let top = DEFAULT_TOP
  let endOfOptions = false

  for (const arg of argv) {
    // A bare `--` ends option parsing, per POSIX. npm strips it, pnpm forwards
    // it, so accepting it is what makes the same invocation work under both.
    if (!endOfOptions && arg === '--') {
      endOfOptions = true
      continue
    }

    if (endOfOptions) {
      files.push(arg)
    } else if (arg.startsWith('--max-failures=')) {
      maxFailures = Number(arg.slice('--max-failures='.length)) || DEFAULT_MAX_FAILURES
    } else if (arg.startsWith('--top=')) {
      top = Number(arg.slice('--top='.length)) || DEFAULT_TOP
    } else if (arg === '--help' || arg === '-h') {
      files.length = 0
      break
    } else if (arg.startsWith('-')) {
      throw new Error(`unknown option: ${arg}`)
    } else {
      files.push(arg)
    }
  }

  return { files, maxFailures, top }
}

function usage(): void {
  console.log(
    'usage: node scripts/verify-logfmt.ts <file> [more files...] [--max-failures=N] [--top=N]',
  )
}

async function main(): Promise<number> {
  let options: Options

  try {
    options = parseArgs(process.argv.slice(2))
  } catch (error) {
    console.error((error as Error).message)
    usage()
    return 2
  }

  if (options.files.length === 0) {
    usage()
    return 2
  }

  let totalLines = 0
  let totalFailed = 0
  let totalUnmappable = 0

  for (const file of options.files) {
    let report: FileReport
    try {
      report = await verify(file, options.maxFailures)
    } catch (error) {
      console.error(`\ncannot read ${file}: ${(error as Error).message}`)
      return 2
    }

    printReport(report, options.top)
    totalLines += report.lines
    totalFailed += report.failed
    totalUnmappable += report.unmappable
  }

  const clean = totalFailed === 0 && totalUnmappable === 0
  console.log(
    `\ntotal: ${num(totalLines)} lines · ${num(totalFailed)} parse failures · ${num(totalUnmappable)} without timestamp`,
  )
  console.log(clean ? 'PASS\n' : 'FAIL\n')

  return clean ? 0 : 1
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
