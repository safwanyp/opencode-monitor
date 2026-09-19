# Build Plan

Companion to `docs/design.md` (frozen). Read the design first — this file assumes it.

Phases are ordered so that each one is independently verifiable. Do not start a phase until the
previous phase's **exit criteria** pass. Phase 1 is deliberately first and standalone: it is the
single highest-risk component and the definition of done depends on it.

---

## Conventions

- Read-only toward OpenCode. Never call a mutating OpenCode endpoint.
- Bind `127.0.0.1` only.
- All shared shapes live in `shared/`; never duplicate a record type across client and server.
- Background readers are `globalThis`-guarded singletons.
- Every phase ends with a verification command that can be run from a clean checkout.

---

## Phase 0 — Scaffold

**Goal:** a running Nuxt app with the correct config and an empty two-explorer shell.

**Tasks**
1. Initialize Nuxt 4 project in the repo root.
2. `nuxt.config.ts`:
   - `ssr: false`
   - `nitro.preset: 'node-server'`
   - dev/prod host `127.0.0.1`, port `4321`
   - `typescript.strict: true`
3. Create `app/assets/css/main.css` and wire it as the single global stylesheet.
4. App shell: header with two nav entries (Service Log, Sessions), a status area for
   per-source health, and a `<NuxtPage />` outlet.
5. Stub routes: `app/pages/index.vue`, `app/pages/sessions/index.vue`,
   `app/pages/sessions/[id].vue`.
6. Add a `.env` with `HOST=127.0.0.1` and `PORT=4321` (documented, not committed secrets).

**Verification**
```sh
npm run dev
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4321/          # expect 200
lsof -nP -iTCP:4321 -sTCP:LISTEN | grep -q '127.0.0.1:4321'                # expect bind on loopback only
```

**Exit criteria:** dev server runs; all three routes render; the process is bound to
`127.0.0.1` and **not** `0.0.0.0`.

---

## Phase 1 — logfmt parser (highest risk, standalone)

**Goal:** a parser in `shared/utils/logfmt.ts` that handles the real file with zero failures.

**Tasks**
1. Implement `parseLogfmt(line: string): Record<string, string>`.
   - Keys: `[A-Za-z0-9_.-]+`
   - Values: bare token, or double-quoted with backslash escapes (`\"`, `\\`, `\n`)
   - Tolerate dotted keys (`http.span`, `event.type`, `status.status`)
   - Preserve values verbatim; do **not** JSON-decode in the hot path
2. Implement `toLogRecord(fields: Record<string, string>): LogRecord` mapping
   `timestamp` → `ts`, `level`, `role`, `run`, `http.span` → `span`, `message`, remainder →
   `fields`.
3. Unit tests with the golden fixtures listed in `docs/design.md` §6.
4. **Full-file verification harness** (the definition of done):
   ```sh
   # parse every line of the live log, report failure count
   node --experimental-strip-types scripts/verify-logfmt.ts ~/.local/share/opencode/log/opencode.log
   ```
   The script must report `lines`, `parsed`, `failed`, and print the first N failures verbatim.

**Verification**
```sh
npm test                                   # unit fixtures pass
node ... scripts/verify-logfmt.ts <log>    # failed === 0
```
Run it against `opencode.log` **and** at least one rotated archive.

**Exit criteria:** `failed === 0` on the 39 MB live log and on a rotated archive. No fixture is
skipped or special-cased.

---

## Phase 2 — File tailer, ring buffer, discovery

**Goal:** the server can follow the log and hold recent records, with no duplicate readers.

**Tasks**
1. `server/utils/discovery.ts`: locate the log directory and list rotated files; resolve the
   OpenCode service URL and password from `~/.config/opencode/service.json` plus
   `opencode service status` (fall back to `lsof` filtered by the opencode pid). Return
   `127.0.0.1`, never the advertised `0.0.0.0`.
2. `server/utils/ring-buffer.ts`: bounded buffer with `after`/`limit` reads.
3. `server/utils/tailer.ts`:
   - start at `size − ~2 MB`
   - `fs.watch` on the directory + byte-offset reads
   - reset on truncation (size < offset)
   - detect newly rotated files
   - never emit a partial trailing line
   - backpressure: cap reads per tick
4. `server/plugins/readers.ts`: instantiate the tailer **once**, guarded on `globalThis`.
5. Emit records into the ring buffer and an in-process event emitter for SSE fan-out.

**Verification**
- Start the app, confirm records appear without duplicates over 60 s of live traffic.
- Trigger dev HMR reload; confirm watcher count does **not** grow (no duplicate rows).
- Append synthetic lines to a temp log file to exercise rotation and truncation paths.

**Exit criteria:** records flow; no duplicates across an HMR reload; truncation and rotation both
handled without throwing.

---

## Phase 3 — Explorer A server API

**Goal:** Explorer A fully served.

**Tasks**
- `server/api/logs/records.get.ts` — `?after=&limit=`
- `server/api/logs/stream.get.ts` — SSE, `ReadableStream` + `text/event-stream` /
  `no-cache` / `keep-alive`; heartbeats
- `server/api/logs/files.get.ts` — rotated file list with sizes and timestamps
- `server/api/health.get.ts` — Explorer A status (following / paused / error)

**Verification**
```sh
curl -sS 'http://127.0.0.1:4321/api/logs/records?limit=5' | head
curl -sS -N --max-time 5 http://127.0.0.1:4321/api/logs/stream | head
curl -sS http://127.0.0.1:4321/api/health
```

**Exit criteria:** backfill returns records; the SSE stream yields new records within ~1 s of
them being written; health reflects a stopped service correctly.

---

## Phase 4 — Explorer A UI

**Goal:** the Service Log explorer is usable and not drowned in noise.

**Tasks**
1. Virtualized stream list (windowed — 144k rows cannot be DOM nodes).
2. Facet panel: `level`, `role`, `run`, `message` with counts, from the ring buffer.
3. **Mute-by-default** the four heartbeat messages; visible and reversible.
4. Filters: level, role, run, message, `http.span`, free-text, time range.
5. Follow/pause control.
6. Detail drawer: pretty-printed JSON for JSON-looking field values, raw fields otherwise.
   Redaction **off** by default for Explorer A, toggle visible.

**Verification**
- With the service stopped, the explorer still renders history and is navigable.
- Default view is not dominated by heartbeat messages.
- Scrolling stays smooth at the largest available buffer size.

**Exit criteria:** Explorer A is genuinely useful with the service stopped and does not require
the user to manually silence noise on first load.

---

## Phase 5 — Spans and Problems views

**Goal:** the two views that make this better than a prettier `tail -f`.

**Tasks**
1. **Spans:** group by `http.span` into one row per request; show method/url/status/duration
   where present; expand to constituent lines.
2. **Problems:** WARN + ERROR lane, newest first; render `cause=` in full; count badges.

**Verification**
- Pick a known `http.span` value from the log and confirm every line with that span is grouped.
- Confirm the Problems lane count matches `grep -c 'level=ERROR'` / `WARN` for the loaded range.

**Exit criteria:** span grouping is correct for a manually verified sample; problem counts match
a ground-truth `grep`.

---

## Phase 6 — Explorer B server

**Goal:** session list, transcript, and a live event stream.

**Tasks**
1. `server/utils/opencode-client.ts`: authenticated fetch against `127.0.0.1:<port>` with Basic
   auth; `fetch` + `ReadableStream` for SSE (not `EventSource` — headers are required).
2. `server/api/events/sessions.get.ts` — proxy `GET /api/session`.
3. `server/api/events/session/[id].get.ts` — proxy `GET /api/session/{id}/message`.
4. `server/plugins/readers.ts` — add the upstream `/api/event` consumer as a **guarded
   singleton**: reconnect with backoff, treat `: heartbeat` as liveness, track `durable.seq`.
5. `server/api/events/stream.get.ts` — fan out to the browser, resuming from the client's last
   seq.
6. `server/api/health.get.ts` — add Explorer B status (connected / disconnected / reconnecting).

**Verification**
```sh
curl -sS http://127.0.0.1:4321/api/events/sessions | head
curl -sS -N --max-time 30 http://127.0.0.1:4321/api/events/stream | head
```
Restart the OpenCode service mid-stream and confirm reconnection plus port re-resolution.

**Exit criteria:** sessions and transcripts load; live events arrive; a service restart is
survived and the stream resumes rather than silently dying.

---

## Phase 7 — Explorer B UI

**Goal:** session-first navigation with a live label.

**Tasks**
1. Session list: title, directory, model, agent, cost, tokens, outcome; **live badge** on
   sessions with recent events.
2. Drill-in: transcript (history) + live event tail.
3. Live label driven by the event stream filtered on `data.sessionID` / `durable.aggregateID`.
4. Track `durable.seq`; resume on reconnect.
5. Detail drawer with redaction **on** by default for this explorer.

**Verification**
- Select an active session and confirm live events append without a manual refresh.
- Disconnect and reconnect the stream; confirm no duplicate events and no gap.
- Confirm redaction hides `content[].text` while the toggle is on.

**Exit criteria:** live label is accurate; reconnect produces no duplicates and no gaps; redaction
defaults to on.

---

## Phase 8 — Polish and final verification

**Tasks**
1. Shared shell consistency: time range, search, follow/pause, detail drawer across both
   explorers.
2. Health panel: both sources, clear states, actionable messages.
3. Confirm read-only by inspection: no non-GET call to OpenCode anywhere in the codebase.
4. Confirm loopback-only binding in the production build.
5. Re-run the full-file parser harness as the final gate.

**Verification**
```sh
grep -rnE 'method:\s*.(POST|PUT|PATCH|DELETE)' server/ | grep -i opencode   # expect no hits
npm run build && node .output/server/index.mjs
lsof -nP -iTCP:4321 -sTCP:LISTEN | grep -q '127.0.0.1:4321'
node ... scripts/verify-logfmt.ts ~/.local/share/opencode/log/opencode.log
```

**Exit criteria:** both definition-of-done conditions hold, read-only is verified by inspection,
and the production build binds loopback only.

---

## Suggested order of attack

Phases 0–4 deliver the core value. Phases 5–8 add the differentiators and the second explorer.
If time is short, Phase 1 and Phase 4 are the two that decide whether the tool is worth using.

---

## Open questions for the implementation session

1. **Virtualization library** — pick one, or hand-roll windowing. Decide at Phase 4.
2. **Rotation trigger** — confirm whether OpenCode rotates on size or time; adjust the tailer if
   needed (design §13 lists this as unverified).
3. **`fs.watch` fallback** — add polling if macOS coalesces events under rapid writes.
4. **Redaction implementation** — key-based at serialization time, or render-time masking.
   Key-based is safer; decide before Phase 7.
5. **Ring buffer sizing** — start at 20k records and measure memory.
