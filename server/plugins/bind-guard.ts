/**
 * Refuses to start on anything but loopback.
 *
 * "Local only, never 0.0.0.0" is a hard invariant of this app: it renders
 * OpenCode logs, session transcripts and tool output. Nitro's node-server
 * defaults to a wildcard address and only reads HOST from the process
 * environment — it does not read `.env` — so starting the built server without
 * the env file silently exposes it on the network.
 *
 * Failing loudly is the point. A misconfiguration that is merely logged is a
 * misconfiguration that ships.
 */

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost', 'ip6-localhost'])

function effectiveHost(): string {
  return process.env['NITRO_HOST'] ?? process.env['HOST'] ?? ''
}

export default defineNitroPlugin(() => {
  // In dev the bind address comes from `devServer.host` in nuxt.config, which
  // is already loopback, and HOST may legitimately be unset here.
  if (import.meta.dev) return

  const host = effectiveHost()
  if (LOOPBACK_HOSTS.has(host)) return

  console.error(
    [
      '',
      '  Refusing to start: this would bind a non-loopback address.',
      '',
      `  Effective host: ${host === '' ? '(unset — Nitro falls back to a wildcard)' : host}`,
      '',
      '  OpenCode Monitor is local-only by design. It renders logs, prompts and',
      '  tool output, so a routable address would expose all of that to the network.',
      '',
      '  Start it through the script that loads .env, which sets',
      '  HOST=127.0.0.1 and PORT=4321:',
      '',
      '      pnpm start',
      '',
      '  Copy .env.example to .env if it is missing.',
      '',
    ].join('\n'),
  )

  process.exit(1)
})
