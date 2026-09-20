# OpenCode Monitor

A local, read-only window into OpenCode: what its service is doing, and what your sessions cost.

Two different views that I needed:

- **Service Log** — tails OpenCode's logfmt service log, with span grouping, a problems lane, and some filters.
- **Sessions** — sessions from the OpenCode API, nested by the subagent that spawned them, with transcripts, live activity, and a running total of what each one spent.

Nothing in this app writes to OpenCode. It is simply a presentation layer on top of what OpenCode already exposes.

## Running

```bash
pnpm install
cp .env.example .env      # HOST=127.0.0.1, PORT=4321
pnpm build
pnpm start                # http://127.0.0.1:4321
```

## Service Log — `/logs`

Three views over one file:

- **Stream** — every line, following the file live.
- **Spans** — collapses the lines sharing an `http.span` into a single request row, expandable into its related lines.
- **Problems** — the WARN and ERROR lanes, with `cause=` rendered in full.

## Sessions — `/sessions`

The session list keeps subagents under the session that spawned them. Cost and token columns show the subtree total on a parent row.

- **Context** filters to the configuration stack that governs a session, and shows that stack: the
  global config, then every ancestor config in merge order, with the keys each contributes. Rows
  whose recorded model differs from the one their context declares are flagged.
- **Directory** narrows to a project; every column sorts; the tree keeps siblings together.
- Selecting a session opens its transcript alongside a live event tail.

Transcripts contain prompts, reasoning and tool output, which are redacted by default.

## Where it reads from

| What | Where |
|---|---|
| Service log | `opencode.log` in `$XDG_DATA_HOME/opencode/log` — `~/.local/share` by default |
| Service password | `service.json` in `$XDG_CONFIG_HOME/opencode` — `~/.config` by default |
| Service port | `opencode service status`, falling back to the listening process |

## How it is put together

Nuxt 4 with `ssr: false` and the `node-server` preset. Two long-lived readers
on the server (a file tailer and an upstream event consumer) hold bounded ring buffers and are
`globalThis`-guarded so a dev reload cannot duplicate them. The logfmt parser and the record types
live in `shared/`, so the client and the server parse with one implementation rather than two.

Live views ride SSEs from `/api/logs/stream` and `/api/events/stream`; the session totals and the config contexts are derived server-side.
