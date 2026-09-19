import type { LogFilesResponse } from '#shared/types/logs'

import { listLogFiles } from '../../utils/discovery'

/**
 * The log directory inventory: the live file plus the rotated archives.
 *
 * Archives are listed so the UI can show they exist, and flagged as
 * unparseable because they are a legacy console format rather than logfmt
 * (design §2.1). Nothing here reads their contents.
 */
export default defineEventHandler(async (): Promise<LogFilesResponse> => {
  const { active, archives } = await listLogFiles()

  return {
    active,
    archives,
    archivesParseable: false,
    note: 'Rotated archives are a legacy console format, not logfmt. They are inventoried but never parsed (design §2.1).',
  }
})
