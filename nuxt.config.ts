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

  app: {
    head: {
      title: 'OpenCode Monitor',
      htmlAttrs: { lang: 'en' },
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'color-scheme', content: 'dark' },
      ],
    },
  },
})
