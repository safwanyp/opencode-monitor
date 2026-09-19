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
