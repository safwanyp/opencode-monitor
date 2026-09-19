# OpenCode Log Monitor

A local, read-only monitoring tool for OpenCode's service logs. Two explorers over two genuinely
different data sources:

- **Explorer A — Service Log**: tails `~/.local/share/opencode/log/opencode.log` (logfmt), with
  span grouping, a problems lane, and noise filtering.
- **Explorer B — Sessions**: session-first view of the OpenCode API, with message history and a
  live event stream.

Nothing in this app writes to OpenCode. It is a viewer.

## Status

**Design frozen. Implementation not started.**

## Documents

| Document | Contents |
|---|---|
| [`docs/design.md`](docs/design.md) | The frozen design: verified environment facts, architecture, project layout, API surface, decisions, risks |
| [`docs/build-plan.md`](docs/build-plan.md) | Phased implementation plan with per-phase verification and exit criteria |

Read `docs/design.md` first. It records what was empirically verified against a running OpenCode
instance (v2.0.8), including several findings that changed the design.

## The three findings that shaped this

1. **The file log and the live API are not the same data.** They share zero event types. The file
   records an internal config/catalog bus (`catalog.updated`, `command.updated`, …); the API emits
   public session/runtime activity (`server.connected`, `session.tool.success`, …). Hence two
   explorers rather than a union.

2. **The session log endpoint is not replayable.** `/api/experimental/session/{id}/log?after=0`
   returns only `{"type":"log.synced","seq":N}` with no backfill. History comes from
   `GET /api/session/{id}/message` instead. The session-log endpoint was dropped.

3. **The log is dominated by noise.** Four heartbeat messages account for ~85% of volume. Faceting
   and mute-by-default are core features, not polish.

## Stack

Nuxt 4 (Nitro BFF + Vue client), `ssr: false`, `nitro.preset: 'node-server'`, bound to
`127.0.0.1` only. The logfmt parser and record types live in `shared/` so client and server use
one implementation.

## Definition of done

- The logfmt parser round-trips every line of the 39 MB log with **zero parse failures**.
- Explorer A remains **useful with the OpenCode service stopped**.
