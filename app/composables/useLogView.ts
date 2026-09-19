/**
 * Which Explorer A view is showing.
 *
 * Kept in one composable rather than in the page so the toolbar, the views and
 * the record count all read the same value, and so a view can be linked to.
 */
export type LogView = 'stream' | 'spans' | 'problems'

export function useLogView() {
  return useState<LogView>('log-view', () => 'stream')
}
