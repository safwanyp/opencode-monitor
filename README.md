# OpenCode Monitor

A local, read-only window into OpenCode: what its service is doing, and what your sessions
actually cost.

Two explorers over two genuinely different data sources:

- **Service Log** — tails OpenCode's logfmt service log, with span grouping, a problems lane,
  and the noise control that makes it readable.
- **Sessions** — your sessions from the OpenCode API, nested by the subagent that spawned them,
  with transcripts, live activity, and a running total of what each one spent.

Nothing in this app writes to OpenCode. It is a viewer, permanently.

## Running it

```bash
pnpm install
cp .env.example .env      # HOST=127.0.0.1, PORT=4321
pnpm build
pnpm start                # http://127.0.0.1:4321
```

`/` lands on Sessions; the Service Log is one click away. For development, `pnpm dev` serves the
same port with HMR.

Starting it through `pnpm start` is not just convention. That script loads `.env`, and `HOST` is
what keeps the server on loopback — launch the built server any other way and it refuses to start.
That is deliberate: Nitro defaults to `0.0.0.0`, and this app renders prompts, reasoning and tool
output. See `server/plugins/bind-guard.ts`.

### Checks

| Command | What it proves |
|---|---|
| `pnpm typecheck` | Vue SFCs and server code typecheck together |
| `pnpm test` | The unit suite — parser, tailer, readers, API params, config resolution, UI helpers |
| `pnpm verify:logfmt` | Every line of the live log parses with **zero failures**; takes any other logfmt file as an argument |

`OPENCODE_REAL_CHECK=1 pnpm test contexts-real` additionally runs the config-resolution acceptance
test against the configs actually installed on this machine. It is gated so the default suite stays
hermetic.

## Service Log — `/logs`

Three views over one file, because one view is not enough to answer "what went wrong".

- **Stream** — every line, virtualized, following the file live.
- **Spans** — collapses the lines sharing an `http.span` into a single request row, expandable back
  into its parts.
- **Problems** — the WARN and ERROR lanes, with `cause=` rendered in full.

Facets for level, role, run and message carry whole-buffer counts, not just what is on screen. The
handful of heartbeat messages that dominate the log are muted by default — without that the view is
unreadable seconds after opening.

This explorer reads the file, so it keeps working when the OpenCode service is stopped.

## Sessions — `/sessions`

The session list nests subagents under the session that spawned them, which is the difference
between a wall of near-identical rows and something you can actually scan. Cost and token columns
show the subtree total on a parent row, hinted in the tooltip, so the columns stay additive with the
header.

- **Context** — filters to the configuration stack that governs a session, and shows that stack: the
  global config, then every ancestor config in merge order, with the keys each contributes. Rows
  whose recorded model differs from the one their context declares are flagged. The wording is
  "did not use the declared model" on purpose — drift over time and a one-off override look identical
  in the data, so the app reports the difference rather than judging it.
- **Directory** narrows to a project; every column sorts; the tree keeps siblings together.
- Selecting a session opens its transcript alongside a live event tail.

Transcripts contain prompts, reasoning and tool output, so this explorer redacts by default. The
Service Log does not — it is operational. Either way the toggle is visible and states which mode it
is in.

## Where it reads from

| What | Where |
|---|---|
| Service log | `opencode.log` in `$XDG_DATA_HOME/opencode/log` — `~/.local/share` by default |
| Service password | `service.json` in `$XDG_CONFIG_HOME/opencode` — `~/.config` by default |
| Service port | `opencode service status`, falling back to the listening process |

Two rules hold here. The service advertises `http://0.0.0.0:49374` because that is what it bound, not
a valid destination, so the app always connects over `127.0.0.1` regardless. And the password is read
on the server and stays there: never logged, never returned in a response, never in the client bundle.

Rotated archives sit beside the live file and are listed as inventory but **never parsed** — they are
a legacy console format, not logfmt. The live file carries the whole history anyway.

## Invariants

- **Read-only.** No prompts, interrupts, permission replies, or config and session mutations. No
  mutating HTTP calls to OpenCode at all.
- **Local only.** Binds `127.0.0.1`, enforced at startup.
- **Single process.** Nitro serves both the API and the built client.
- **No persistence** beyond bounded in-memory buffers.

Explicitly out of scope: editing config, driving sessions, analytics, alerting.

## How it is put together

Nuxt 4 with `ssr: false` and the `node-server` preset — one process, one port. Two long-lived readers
on the server (a file tailer and an upstream event consumer) hold bounded ring buffers and are
`globalThis`-guarded so a dev reload cannot duplicate them. The logfmt parser and the record types
live in `shared/`, so the client and the server parse with one implementation rather than two.

Live views ride server-sent events from `/api/logs/stream` and `/api/events/stream`; the session
totals and the config contexts are derived server-side so the client cannot disagree with it.

The theme follows your system by default, and the toggle sits in the top bar. Every colour is a
single `light-dark()` token, so both themes come from one palette definition.

## Documents

| Document | Contents |
|---|---|
| [`docs/design.md`](docs/design.md) | The frozen design: verified environment facts, architecture, API surface, risks |
| [`docs/decisions.md`](docs/decisions.md) | Index of settled decisions, with the reasoning for each |
| [`docs/build-plan.md`](docs/build-plan.md) | The phased plan this was built from, kept as a record |

`docs/design.md` is worth reading for the environment facts it pins down — several of them changed
the design, and they are the parts most likely to be wrong if assumed rather than checked.
