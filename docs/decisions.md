# Decisions

Quick index of settled decisions. Rationale and evidence live in `docs/design.md`.

| # | Decision | Choice | Rationale |
|---|---|---|---|
| 1 | Sources | **Two explorers, not a union** | The file log and live API share zero event types — they are different data, not two views of one |
| 2 | Scope | **Read-only monitoring** | Explicit user constraint; nothing more |
| 3 | Explorer B shape | **Session-first with a live label** | Readable and useful; a global firehose is hard to follow |
| 4 | Stack | **Nuxt 4 — Nitro BFF + Vue** | One process instead of a separate Node app and Vue app; `shared/` avoids duplicated parser and types |
| 5 | Rendering | `ssr: false` | Local live-feed dashboard; the list is client-only anyway; less hydration surface |
| 6 | Nitro preset | `node-server` | App is inherently stateful (ring buffers, `fs.watch`, upstream SSE) |
| 7 | Host binding | `127.0.0.1` | Local-only invariant; Nitro defaults to `0.0.0.0` and must be overridden |
| 8 | Shared code | `shared/utils/logfmt.ts`, `shared/types/records.ts` | Write once, use in client and server |
| 9 | Styles | Scoped SFC + one global stylesheet | Idiomatic Nuxt; CSS Modules are supported but not idiomatic |
| 10 | Session-log endpoint | **Dropped** | `/api/experimental/session/{id}/log` emits only `log.synced`; no backfill |
| 11 | History source | `GET /api/session/{id}/message` | Non-experimental, full transcript |
| 12 | Live transport | `fetch` + `ReadableStream` | `EventSource` cannot send the required auth header |
| 13 | Auth | Basic `opencode:<password>` | Password in `~/.config/opencode/service.json`; unauth returns 401 |
| 14 | Redaction | On for B, off for A | B renders prompts, reasoning, and tool output; A is operational |
| 15 | Noise | Mute-by-default heartbeat messages | 5 messages ≈ 86% of volume |
| 16 | Correlation | Group by `http.span` | 13,122 distinct spans available; collapses request storms |
| 17 | Reader lifecycle | `globalThis`-guarded singletons | Nitro plugins can re-run on dev reload; unguarded readers duplicate rows |
| 18 | Rotated archives | **Inventory only, never parsed** | All 11 archives are a legacy console format, not logfmt (design §2.1); the live file carries the history |
| 19 | Context identity | **The resolved stack, not a config file** | What governs a session is a merge of global + ancestor configs; naming one file would hide the others |
| 20 | Discovery scope | **Only directories observed sessions ran in** | Bounds the walk to ~940 `stat()` calls for 521 sessions, and keeps a config no session used out of the picker |
| 21 | Precedence | **Every `.opencode` config outranks every direct one** | Nearest-ancestor alone is right until a `.opencode/` appears, then silently wrong |
| 22 | Declaration vs definition | **Declaration replaces the definition wholesale** | Verified live: a config declaring no variant produced `#default` sessions though the definition said `#medium` |
| 23 | Mismatch wording | **"Did not use the declared model"** | Drift over time and a per-invocation override are indistinguishable in the data; "misconfigured" would assert more than is known |
| 24 | Unscored agents | **Never guessed** | `build` has no definition and no declaration, so scoring it would manufacture mismatches |
| 25 | Model resolution | **Server-side, one implementation** | The client receives `agent → provider/model#variant` and looks it up, so it cannot disagree with the server |
| 26 | Context switcher | **A filter, not a mode** | It narrows the same session list; sessions are the only surface it governs for now |

## Rejected alternatives

| Alternative | Why rejected |
|---|---|
| Union of file + API into one stream | Sources are disjoint in content; a union would be a fiction and would need per-row provenance badges |
| File tail only | Discards the rich, structured session/activity data |
| Live API only | Loses the deep file history and fails when the service is down |
| Hono + Vite | Two apps to run and build; no `shared/` equivalent for the parser and types |
| SPA with no server | Cannot tail a file, hold state, or hold upstream credentials |
| Desktop shell (Electron/Tauri) | Buys nothing for a local web UI |
| `/api/experimental/session/{id}/log` | Not replayable; emits only `log.synced` |
| Parsing the legacy console archives | A second grammar to maintain for ~2,800 stale lines; the live file already carries 145k lines of history |
| Selecting a context by config file | A session can be governed by several files at once; the file is an implementation detail of the stack |
| Scanning the whole filesystem for configs | Finds configs no session ever used, and pays for them |
| Re-parsing configs in the client | Two implementations of the precedence rules that can disagree; the server resolves once |
| Hiding the mismatch detail behind a filter only | The flags are all on subagents; with parents collapsed and no rollup the feature was invisible |
