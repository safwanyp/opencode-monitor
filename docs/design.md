# OpenCode Log Monitor — Design

Status: **frozen**. Decisions below are settled; implementation has not started.

One read-only local app. Two log explorers. One Nuxt process (Nitro BFF + Vue client).

---

## 1. Purpose and invariants

**Purpose:** observe what the OpenCode service is doing, locally, without touching it.

Hard constraints (invariant — do not relax these):

- **Read-only, permanently.** No prompts, interrupts, permission replies, or config/session
  mutations. No mutating HTTP calls to OpenCode at all.
- **Local only.** Binds `127.0.0.1`. Never `0.0.0.0`.
- **Single process.** Nitro serves both the API and the built Vue client.

**Non-goals:** editing config, driving sessions, analytics, alerting, persistence beyond
bounded in-memory buffers.

---

## 2. Verified environment facts

Confirmed against a running OpenCode instance (v2.0.8 on macOS), not assumed. Re-verify with
the commands noted if behavior seems off.

| Fact | Value |
|---|---|
| Log file | `~/.local/share/opencode/log/opencode.log` — 39 MB / ~144k lines, live |
| Log format | **logfmt**, not JSON |
| Archives | `~/.local/share/opencode/log/<ISO-timestamp>.log` (10 present) |
| Levels | 140,420 INFO · 3,212 WARN · 43 ERROR |
| Roles | 100,709 `server` · 4,362 `cli` |
| Noise | 4 messages ≈ 85% of volume (`spawning process` 50k, `watcher subscribe` 35k, `event` 27k, `watcher started` 5k) |
| Correlation key | `http.span` — 13,122 distinct values |
| Process grouping | `run` (e.g. `0cc8cfa0`, `556d837a`) |
| Auth | `Authorization: Basic opencode:<password>` → 200; unauth → 401 |
| Password | `~/.config/opencode/service.json` (mode 0600, field `password`) |
| Port | `opencode service status` → `http://0.0.0.0:49374`; connect via `127.0.0.1` |
| Live stream | `GET /api/event` (SSE) — `data:` lines plus `: heartbeat` comments |
| File event types | only `catalog.updated`, `command.updated`, `provider.updated`, `model.updated`, `agent.updated` |
| API event types | `server.connected`, `session.tool.success`, `shell.exited`, `shell.deleted`, `text` |
| **Overlap** | **none — zero shared event types** |
| Session history | `GET /api/session/{id}/message` (non-experimental) — full transcript |
| Session list | `GET /api/session` — cost, tokens, model, agent, directory, outcome |
| **Not replayable** | session `/log?after=0` → only `{"type":"log.synced","seq":N}`; **no backfill** |
| Seq | `durable.seq` orders the live stream; **resume only, not history** |

### Sample lines

Logfmt (note quoting and escaping — this is the parser's main correctness surface):

```
timestamp=2026-09-19T10:19:37.203Z level=INFO run=0cc8cfa0 message="watcher started" path=/Users/... type=file backend=node ignores=0 http.span=105663 role=server
```

```
message="spawning process" command=/bin/zsh args="[\"-c\",\"cd ~/.config/opencode/plugins/safwan-magic && npm run check 2>&1\"]" cwd=/Users/safwanyp http.span=108213 role=server
```

```
level=ERROR run=556d837a message="Failed to fetch models.dev" cause="Cause([Fail(HttpClientError: Transport error (GET https://models.opencode.ai/api.json))])" http.span=59500628 role=server
```

Live API event (note `durable.seq` and `location`):

```json
{"id":"evt_0b936cd11001sXoEaZEbLddIJB","created":1789813771537,"type":"session.tool.success",
 "location":{"directory":"/Users/safwanyp"},
 "data":{"sessionID":"ses_f46d03e9effeJwbOSklDrn79t8","content":[{"type":"text","text":"..."}],
         "metadata":{"status":"completed","exit":0}},
 "durable":{"aggregateID":"ses_f46d03e9effeJwbOSklDrn79t8","seq":220,"version":2}}
```

### Verification commands

```sh
# log location, size, format
ls -la ~/.local/share/opencode/log/
tail -n 20 ~/.local/share/opencode/log/opencode.log

# facets
grep -aoE 'level=[A-Z]+' opencode.log | sort | uniq -c | sort -rn
grep -aoE 'role=[a-z]+'  opencode.log | sort | uniq -c | sort -rn

# service discovery + auth
opencode service status
PW=$(python3 -c "import json;print(json.load(open('$HOME/.config/opencode/service.json'))['password'])")
URL=$(opencode api get /api/info | python3 -c "import sys,json;print(json.load(sys.stdin)['urls'][0])")
curl -sS -N --max-time 5 -u "opencode:$PW" "$URL/api/event"
```

---

## 3. Architecture

```
┌── Explorer A: Service Log ──┐   ┌── Explorer B: Sessions ──┐
│  opencode.log  (logfmt)     │   │  GET /api/session        │
│  + rotated archives         │   │  GET /api/session/{id}/  │
│  fs.watch + byte offset     │   │        message           │
│  logfmt parser (shared/)    │   │  GET /api/event  (SSE)   │
└─────────────────────────────┘   └──────────────────────────┘
              │  ring buffers                  │  durable.seq
              └──────────┬────────────────────┘
                 Nitro BFF (server/plugins readers,
                 SSE fan-out, redaction)
                         │
                 Vue client (app/) — ssr: false
```

**Why two explorers, not a union.** The two sources share zero event types. Explorer A is an
internal config/catalog bus; Explorer B is public session/runtime activity. A union would be a
fiction. Two explorers make provenance structural rather than a per-row badge.

---

## 4. Project layout (Nuxt 4)

Nuxt 4 default `srcDir` is `app/`; `server/`, `shared/`, `public/` and `nuxt.config.ts` stay at
the project root. `~`/`@` → `app/`; `~~`/`@@` → root; `#shared` → `shared/`.

```
opencode-monitor/
├── nuxt.config.ts
├── .env                          # HOST, PORT (optional overrides)
├── app/                          # srcDir — Vue client
│   ├── app.vue
│   ├── pages/
│   │   ├── index.vue             # Explorer A — Service Log
│   │   └── sessions/
│   │       ├── index.vue         # Explorer B — session list
│   │       └── [id].vue          # transcript + live tail
│   ├── components/               # virtualized list, facet panel, detail drawer, shell
│   ├── composables/              # useLogStream, useEventStream, useRedaction
│   └── assets/css/main.css       # one global stylesheet
├── server/
│   ├── api/
│   │   ├── logs/records.get.ts
│   │   ├── logs/stream.get.ts
│   │   ├── logs/files.get.ts
│   │   ├── events/sessions.get.ts
│   │   ├── events/stream.get.ts
│   │   ├── events/session/[id].get.ts
│   │   └── health.get.ts
│   ├── plugins/
│   │   └── readers.ts            # file tailer + upstream SSE consumer (singletons)
│   └── utils/                    # ring buffer, service discovery, redaction
└── shared/
    ├── utils/logfmt.ts           # parser — used by BOTH client and server
    └── types/records.ts          # LogRecord, EventRecord
```

`shared/` is the reason Nuxt was chosen: the logfmt parser and record types are written once and
consumed by both sides. `shared/` may not import Vue or Nitro code.

---

## 5. Nuxt configuration (essentials)

- **`ssr: false`** — local dashboard driven by a live feed; the virtualized list is client-only
  regardless. Removes hydration surface. Nitro still runs as the BFF in SPA mode.
- **`nitro.preset: 'node-server'`** — the app is inherently stateful (ring buffers, `fs.watch`,
  an upstream SSE connection). Explicitly non-deployable to serverless/edge.
- **`HOST=127.0.0.1`** — **required override.** Nitro defaults to `0.0.0.0`, which would violate
  the local-only invariant.
- **`PORT`** — choose something distinct from OpenCode's own port (e.g. `4321`).
- **Background readers as module-level singletons** in `server/plugins/readers.ts`, guarded on
  `globalThis`. Nitro plugins can re-run on dev reload; without the guard you spawn duplicate
  watchers and duplicate upstream connections, which presents as mystery duplicate rows.
- **SSE** via `ReadableStream` plus headers: `Content-Type: text/event-stream`,
  `Cache-Control: no-cache`, `Connection: keep-alive`.
- **Styles:** scoped SFC `<style scoped>` + one global stylesheet. CSS Modules work but are not
  idiomatic here.

Build and run:

```sh
nuxt build
node .output/server/index.mjs
```

**Dev caveat:** HMR restarts drop in-memory buffers and the upstream connection. Expected; not a
design flaw.

---

## 6. Explorer A — Service Log

**Source:** file only. Works when the service is down.

### Ingestion

- `fs.watch` + byte offset; never read the whole file
- Start at `size − ~2 MB`; page backwards in chunks for "load older"
- Handle truncation (size < offset → reset to 0) and newly rotated files
- Never parse a trailing line that does not end in `\n`
- Parser must respect quotes and backslash escapes. Required test cases:
  - `args="[\"-c\",\"...\"]"`
  - `cause="Cause([Fail(TimeoutError)])"`
  - `errors="[{\"type\":\"TypeError\",\"code\":\"ConnectionRefused\"}]"`
  - values containing spaces, `=`, and parentheses

### Views

1. **Stream** — virtualized list; time · level chip · role chip · message · key summary
2. **Spans** — collapse by `http.span` into one request row, expandable to constituent lines
3. **Problems** — WARN + ERROR lane; `cause=` rendered in full

### Filters

`level`, `role`, `run`, `message`, `http.span`, free-text, time range.

### Noise control (core, not polish)

Message facets auto-derived with counts; the four heartbeat messages muted by default. Without
this the app is unusable ~10 seconds after launch.

---

## 7. Explorer B — Sessions

**Source:** API. Session-first, with a live label.

**Flow:** session list → select session → message transcript (history) + live event tail.

**Live label** driven by `/api/event`, filtered on `data.sessionID` / `durable.aggregateID`.
Active sessions get a live badge in the list.

**Ordering:** track `durable.seq`; reconnect resumes from the last seq rather than restarting.

**Type facet is data-driven** — only 5 API types observed so far; do not assume a closed set.

**Sensitivity:** this explorer renders prompts, reasoning, and tool output. It is the
higher-sensitivity surface and drives the redaction default in §9.

**Explicitly dropped:** `/api/experimental/session/{id}/log`. It emits only `log.synced`, so it
earns no place. Live = `/api/event`; history = `/message`.

---

## 8. Server API

| Route | Explorer | Nuxt file |
|---|---|---|
| `GET /api/logs/records` | A — backfill from ring buffer | `server/api/logs/records.get.ts` |
| `GET /api/logs/stream` | A — live SSE | `server/api/logs/stream.get.ts` |
| `GET /api/logs/files` | A — rotated file list | `server/api/logs/files.get.ts` |
| `GET /api/events/sessions` | B — session list | `server/api/events/sessions.get.ts` |
| `GET /api/events/session/[id]` | B — transcript | `server/api/events/session/[id].get.ts` |
| `GET /api/events/stream` | B — live SSE | `server/api/events/stream.get.ts` |
| `GET /api/health` | both — file following/paused, API connected/disconnected | `server/api/health.get.ts` |

---

## 9. Redaction

- **Explorer A: off by default** — service logs are operational.
- **Explorer B: on by default** — transcripts contain prompts, reasoning, tool output.
- **Redacted when on:** `args=`, `cause=`, `content[].text`, and credential-ish keys
  (`credentialID`, `token`, `password`, `authorization`).
- Toggle is always visible; state is explicit, never silent.

---

## 10. Normalized records

Defined in `shared/types/records.ts`.

```ts
// Explorer A
interface LogRecord {
  id: string
  ts: string
  level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG'
  role?: 'server' | 'cli'
  run?: string
  span?: number
  message: string
  fields: Record<string, string>
}

// Explorer B
interface EventRecord {
  id: string
  ts: number
  type: string
  sessionID?: string
  directory?: string
  seq?: number
  data: unknown
  durable?: unknown
}
```

---

## 11. Shared shell

App frame · time range · follow/pause · search · detail drawer (pretty-printed JSON, raw fields,
redaction toggle) · per-source health indicator.

---

## 12. Decision log

| Decision | Choice |
|---|---|
| Sources | Two explorers, **not** a union |
| Scope | Read-only monitoring; nothing more |
| Explorer B shape | Session-first with live label |
| Stack | Nuxt 4 — Nitro BFF + Vue, `ssr: false`, `nitro.preset: 'node-server'` |
| Host binding | `127.0.0.1` (override Nitro's `0.0.0.0` default) |
| Shared code | `shared/` — logfmt parser + record types |
| Styles | Scoped SFC + one global stylesheet |
| Session-log endpoint | Dropped (emits only `log.synced`) |
| Redaction | On for B, off for A |
| Live transport | `fetch` + `ReadableStream` (not `EventSource` — auth header required) |
| Noise | Mute-by-default heartbeat messages |

---

## 13. Known risks / unverified assumptions

- **Rotation policy unverified** — archives are timestamped, but the trigger (size or time) is
  not confirmed. The tailer must tolerate either.
- **`fs.watch` reliability** on macOS under rapid writes — may need a polling fallback.
- **Event type catalog is partial** — only 5 API types observed; the UI must not assume a closed
  set.
- **Some session endpoints are `/experimental`** — treat those as optional; prefer
  non-experimental routes where they exist.
- **Service restart changes the port** — discovery must re-resolve, and Explorer B must
  reconnect.
- **Nitro dev-reload duplication** — mitigated by the `globalThis` singleton guard.
- **Larger dependency surface** than Hono + Vite — accepted cost, traded for `shared/` and
  single-process ergonomics.

---

## 14. Out of scope

Any write action · remote access · multi-user · persistent storage beyond the ring buffer ·
alerting.

---

## 15. Definition of done

- The logfmt parser round-trips **every line** of the 39 MB log with **zero parse failures**.
- Explorer A remains **useful with the OpenCode service stopped**.
