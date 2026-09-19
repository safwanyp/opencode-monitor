import type { LogRecord } from './records.ts'

/**
 * Inventoried files under the OpenCode log directory.
 *
 * Deliberately not a logfmt record: the live file and its rotated archives are
 * not the same format. Every archive observed so far is a legacy console format
 * with zero logfmt lines (design §2.1), so archives are listed for display and
 * are never parsed.
 */

export interface LogFileInfo {
  name: string
  path: string
  /** Bytes. */
  size: number
  mtimeMs: number
  /** True for the file currently being tailed. */
  active: boolean
}

/**
 * A record plus the cursor that addresses it.
 *
 * The cursor lives in the envelope rather than on `LogRecord` so the record
 * shape stays a pure description of a log line.
 */
export interface LogRecordEnvelope {
  seq: number
  record: LogRecord
}

export interface LogRecordsResponse {
  records: LogRecordEnvelope[]
  /**
   * Lowest seq still retained. A cursor below `oldestSeq - 1` has fallen out of
   * the window and the client must be told rather than served a silent gap.
   */
  oldestSeq: number
  latestSeq: number
  /** Records currently retained. */
  size: number
}

export interface LogFilesResponse {
  active: LogFileInfo | null
  archives: LogFileInfo[]
  /** Always false: archives are a legacy console format, not logfmt. */
  archivesParseable: boolean
  note: string
}
