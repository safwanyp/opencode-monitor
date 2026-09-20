export default defineNuxtConfig({
  compatibilityDate: '2026-09-19',
  devtools: { enabled: false },

  // Local dashboard driven by a live feed; the record list is client-only anyway.
  // Removes the whole hydration surface.
  ssr: false,

  // The app is inherently stateful (ring buffers, fs.watch, an upstream SSE
  // connection), so it is explicitly not deployable to serverless/edge.
  nitro: {
    preset: 'node-server',
  },

  // 127.0.0.1 is required. Nitro's default is 0.0.0.0, which would break the
  // local-only invariant. The production server reads HOST/PORT from .env.
  devServer: {
    host: '127.0.0.1',
    port: 4321,
  },

  typescript: {
    strict: true,
  },

  // One global stylesheet holds the design tokens and the reset. Component
  // styling stays in scoped SFC blocks.
  css: ['~/assets/css/main.css'],

  // Sessions are what you open the monitor to look at, so they own the root.
  // Nitro answers `/` with a redirect before the SPA loads, so there is no
  // client-side hop and no flash of the wrong explorer.
  routeRules: {
    '/': { redirect: '/sessions' },
  },

  app: {
    head: {
      title: 'OpenCode Monitor',
      htmlAttrs: { lang: 'en' },
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        // Not `dark`: the app follows the system until the user picks.
        { name: 'color-scheme', content: 'light dark' },
      ],
      script: [
        {
          // Runs before the first paint. An explicit choice must not flash the
          // system theme on the way in.
          //
          // Importing the key from the composable would drag app context into
          // this config's TS program, so it is repeated here and must match
          // THEME_STORAGE_KEY in app/composables/useTheme.ts.
          innerHTML:
            "try{var t=localStorage.getItem('opencode-monitor:theme')" +
            ";if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}",
        },
      ],
    },
  },
})
