/**
 * Records the chosen theme on `<html data-theme>`, which is the only thing the
 * stylesheet needs to pin one.
 *
 * Nothing here is required for the system default: with no attribute the tokens
 * follow `color-scheme: light dark` on their own. That is also why the app
 * cannot flash on a first visit — the first paint is already correct, before
 * this plugin exists.
 */
export default defineNuxtPlugin(() => {
  const { preference } = useTheme()

  watchEffect(() => {
    const root = document.documentElement
    if (preference.value === 'system') root.removeAttribute('data-theme')
    else root.dataset.theme = preference.value
  })
})
