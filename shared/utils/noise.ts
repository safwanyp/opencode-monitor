/**
 * The heartbeat messages.
 *
 * Five messages account for ~86% of the log's volume. Without muting them the
 * stream is unusable about ten seconds after launch, so muting them by default
 * is a core feature rather than polish (design §6).
 *
 * This list is shared so the server and client cannot disagree about what
 * counts as noise. It is a default, never a rule: the UI always shows these
 * messages with their counts and lets the user unmute them.
 */
export const HEARTBEAT_MESSAGES: readonly string[] = [
  'spawning process',
  'watcher subscribe',
  'event',
  'watcher stopped',
  'watcher started',
]

const HEARTBEAT_SET = new Set<string>(HEARTBEAT_MESSAGES)

export function isHeartbeat(message: string): boolean {
  return HEARTBEAT_SET.has(message)
}
