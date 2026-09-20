/**
 * Light/dark, following the operating system until the user chooses.
 *
 * There is no palette to swap here: every colour is a `light-dark()` token, so
 * the browser resolves the system preference on its own before any of this
 * runs. What this adds is the explicit override, and the live OS preference the
 * override is measured against.
 */

export type ThemePreference = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

/** Must match the pre-paint script in `nuxt.config`. */
export const THEME_STORAGE_KEY = 'opencode-monitor:theme'
export const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)'

const WIRED_KEY = '__opencodeMonitorThemeWired'

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark'
}

export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  return preference === 'system' ? (systemPrefersDark ? 'dark' : 'light') : preference
}

function readStoredTheme(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    if (isThemePreference(stored)) return stored
  } catch {
    // Storage disabled. The system default still applies.
  }
  return 'system'
}

function storeTheme(preference: ThemePreference): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference)
  } catch {
    // Not remembering the choice is not a reason to refuse it.
  }
}

export function useTheme() {
  const preference = useState<ThemePreference>('theme-preference', readStoredTheme)
  const systemPrefersDark = useState<boolean>('theme-system-dark', () => false)

  if (import.meta.client) {
    // Guarded on globalThis because a plugin reloading under HMR would
    // otherwise stack a second listener on the same query. Same reasoning as
    // the `globalThis`-guarded readers on the server side.
    const globals = globalThis as Record<string, unknown>
    if (!globals[WIRED_KEY]) {
      globals[WIRED_KEY] = true
      const media = window.matchMedia(DARK_MEDIA_QUERY)
      systemPrefersDark.value = media.matches
      media.addEventListener('change', (event) => {
        systemPrefersDark.value = event.matches
      })
    }
  }

  const resolved = computed<ResolvedTheme>(() =>
    resolveTheme(preference.value, systemPrefersDark.value),
  )

  /**
   * Switch to the other theme.
   *
   * Deliberately two states, not a cycle: the system picks where you start, and
   * after that the click always lands on the theme you are not looking at.
   */
  function toggle(): void {
    preference.value = resolved.value === 'dark' ? 'light' : 'dark'
    storeTheme(preference.value)
  }

  return { preference, resolved, toggle }
}
