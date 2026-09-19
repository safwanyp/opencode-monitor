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
| Log file | `~/.local/share/opencode/log/opencode.log` — 39 MB / ~145k lines, live |
| Log format | **logfmt**, not JSON. The live file is 100% logfmt (verified). |
| Archives | `~/.local/share/opencode/log/<ISO-timestamp>.log` (11 present) — **legacy console format, not logfmt.** Inventory only; never parsed. See §2.1. |
| Levels | 141,854 INFO · 3,214 WARN · 42 ERROR |
| Roles | 102,048 `server` · 4,393 `cli` |
| Noise | 5 messages ≈ 86% of volume (`spawning process` 51.7k, `watcher subscribe` 35.2k, `event` 27.5k, `watcher stopped` 5.4k, `watcher started` 5.4k) |
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

### 2.1 Rotated archives are a different format

Verified 2026-09-19. All 11 archives under `~/.local/share/opencode/log/` are a **legacy
console format**, not logfmt:

```
WARN  2026-06-28T19:19:42 +1145ms service=config dir=/Users/safwanyp/.config/opencode error=Cause([Fail(NpmInstallFailedError ...
```

They span 7 Jun – 30 Jun, are 1.5 KB – 5.4 MB, total ~2,800 lines, and contain **zero** logfmt
lines. The grammar differs in ways that matter: the human-readable message is unquoted free text
at the end of the line, and `error=Cause([...])` contains unquoted spaces and parentheses, so it
is not parseable as logfmt even after stripping the prefix.

**Consequence:** archives are inventory only. Explorer A parses the live file and pages backwards
*inside* it; it never parses an archive. Rotation detection is still required, because the live
file rotates and a future archive may well be logfmt — so the tailer must not assume either format
for a file it has not seen.

```sh
# evidence: every archive reports 0; the live file reports every line
for f in ~/.local/share/opencode/log/*.log; do
  printf '%8s  %s\n' "$(grep -c '^timestamp=' "$f")" "$(basename "$f")"
done
```

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
- **`HOST=127.0.0.1`** — **required override.** Nitro defaults to a wildcard address, which would
  violate the local-only invariant.
- **The built server does not read `.env`.** Nitro's node-server takes `HOST`/`PORT` from the
  process environment only. Running `node .output/server/index.mjs` directly therefore binds a
  wildcard address on port 3000 — verified, not assumed. Start it with `pnpm start`, which passes
  `--env-file-if-exists=.env`.
- **A startup guard refuses to bind anything but loopback.** `server/plugins/bind-guard.ts` exits
  with an actionable message rather than letting a misconfiguration expose the app to the network.
  It is skipped in dev, where the bind address comes from `devServer.host`.
- **`PORT`** — choose something distinct from OpenCode's own port (e.g. `4321`). Nuxt silently
  falls back to the next free port if it is taken, so check which port is actually in use.
- **Background readers as module-level singletons** in `server/plugins/readers.ts`, guarded on
  `globalThis`. Nitro plugins can re-run on dev reload; without the guard you spawn duplicate
  watchers and duplicate upstream connections, which presents as mystery duplicate rows.
- **SSE** via `ReadableStream` plus headers: `Content-Type: text/event-stream`,
  `Cache-Control: no-cache`, `Connection: keep-alive`.
- **Styles:** scoped SFC `<style scoped>` + one global stylesheet. CSS Modules work but are not
  idiomatic here.

Build and run:

```sh
pnpm build
pnpm start          # loads .env, so HOST=127.0.0.1 and PORT=4321 apply
```

Running `node .output/server/index.mjs` by hand is not equivalent — it skips the env file and the
startup guard will refuse it.

**Dev caveat:** HMR restarts drop in-memory buffers and the upstream connection. Expected; not a
design flaw. In practice a server-file edit restarts the whole Nitro worker, so the reader
re-primes its 2 MB window. This is dev-only: a built server has no watcher, so the reader starts
exactly once and the buffer is never rebuilt.

---

## 6. Explorer A — Service Log

**Source:** file only. Works when the service is down.

### Ingestion

- `fs.watch` + byte offset; never read the whole file
- Start at `size − ~2 MB`; page backwards in chunks for "load older"
- Handle truncation (size < offset → reset to 0), and detect a newly rotated live file. Rotated
  archives are never parsed (§2.1).
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

Message facets auto-derived with counts; the five heartbeat messages muted by default
(`spawning process`, `watcher subscribe`, `event`, `watcher stopped`, `watcher started`). Without
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
| `GET /api/logs/files` | A — legacy archive inventory, flagged non-parseable | `server/api/logs/files.get.ts` |
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
| Noise | Mute-by-default heartbeat messages (5) |
| Archives | Inventory only — legacy console format, never parsed (§2.1) |

---

## 13. Known risks / unverified assumptions

- **Rotation policy unverified** — archives are timestamped, but the trigger (size or time) is
  not confirmed. The tailer must tolerate either. Every archive to date is legacy console format
  (§2.1), so the format of a future archive is unknown: never assume a rotated file is logfmt.
- **`fs.watch` reliability** on macOS under rapid writes — **mitigated**. A 250 ms poll runs alongside
  the watch as a safety net, and the interval is what bounds worst-case latency when the watch drops
  or coalesces an event. Measured: 12.8 ms median detection with the watch firing, 15.4 ms worst of
  40 samples; 317 ms end-to-end from bytes landing on disk to an SSE client. Note that a log line's
  own `timestamp` typically trails the disk write by ~680 ms, because OpenCode buffers writes — so
  latency measured against that field overstates ours by that much.
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
