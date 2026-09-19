<script setup lang="ts">
import type { SessionContent, SessionMessage } from '#shared/types/events'
import {
  billableTokens,
  formatClock,
  formatCost,
  formatCount,
  formatRelative,
  formatTokens,
} from '#shared/utils/format'
import { REDACTED } from '#shared/utils/redaction'

const route = useRoute()
const sessionId = computed(() => String(route.params.id ?? ''))

const { sessions } = useSessions()
const transcript = useTranscript(sessionId)
const { eventsForSession, liveSessions, connection, lastDurableSeq } = useEventStream()

const session = computed(() =>
  sessions.value.find((s) => s.id === sessionId.value),
)

/**
 * Explorer B renders prompts, reasoning and tool output, so redaction defaults
 * on here. Explorer A is operational and defaults off. The toggle is visible in
 * both, and the state is never silent (design §9).
 */
const redaction = ref(true)

const now = ref(Date.now())
let ticker: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  ticker = setInterval(() => (now.value = Date.now()), 5_000)
})
onBeforeUnmount(() => {
  if (ticker) clearInterval(ticker)
})

const liveEvents = computed(() =>
  [...eventsForSession(sessionId.value)].reverse().slice(0, 40),
)

const isLive = computed(() => liveSessions.value.has(sessionId.value))

/** Reasoning is the bulkiest part of a transcript and the least often needed. */
const expandedReasoning = ref(new Set<string>())

function toggleReasoning(id: string) {
  const next = new Set(expandedReasoning.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expandedReasoning.value = next
}

function partsOf(message: SessionMessage, type: string): SessionContent[] {
  return message.content.filter((part) => part.type === type)
}

function textOf(message: SessionMessage): string {
  return partsOf(message, 'text')
    .map((part) => part.text ?? '')
    .join('\n')
    .trim()
}

const ROLE_LABEL: Record<string, string> = {
  user: 'You',
  assistant: 'Assistant',
  idle: 'Idle',
}

function toolState(part: SessionContent): string {
  const state = part['state']
  if (typeof state === 'string') return state
  if (state && typeof state === 'object') {
    const status = (state as Record<string, unknown>)['status']
    if (typeof status === 'string') return status
  }
  return 'unknown'
}
</script>

<template>
  <div class="explorer">
    <div class="session-bar">
      <NuxtLink to="/sessions" class="back">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none"
          stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
          <path d="M10 3.5 5.5 8 10 12.5" />
        </svg>
        <span>Sessions</span>
      </NuxtLink>

      <span class="rule" />

      <div class="heading">
        <span class="heading-title">{{ session?.title ?? sessionId }}</span>
        <span class="heading-id mono">{{ sessionId }}</span>
      </div>

      <div class="bar-right">
        <span
          class="live-pill"
          :class="{ 'is-on': isLive }"
          :title="connection === 'live' ? 'Event stream connected' : `Stream ${connection}`"
        >
          <span class="live-dot" :class="{ 'is-on': isLive }" />
          <span>{{ isLive ? 'LIVE' : connection.toUpperCase() }}</span>
        </span>
        <span class="seq mono" title="durable.seq — the upstream ordering used to resume">seq {{ formatCount(lastDurableSeq) }}</span>

        <button type="button" class="redaction" @click="redaction = !redaction">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none"
            :stroke="redaction ? 'var(--color-accent)' : 'var(--color-text-muted)'"
            stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M8 1.8 3 3.9v4.3c0 3 2.1 5.4 5 6.1 2.9-.7 5-3.1 5-6.1V3.9z" />
          </svg>
          <span>Redaction {{ redaction ? 'on' : 'off' }}</span>
          <span class="switch" :class="{ 'is-on': redaction }"><span class="knob" /></span>
        </button>
      </div>
    </div>

    <div class="body">
      <main class="transcript">
        <div v-if="transcript.loading.value" class="note">Loading transcript…</div>

        <div v-else-if="transcript.error.value" class="note">
          <p class="note-title">Transcript unavailable</p>
          <p>{{ transcript.error.value }}</p>
        </div>

        <template v-else>
          <button
            v-if="transcript.hasOlder.value"
            type="button"
            class="load-older"
            :disabled="transcript.loadingMore.value"
            @click="transcript.loadOlder()"
          >
            {{ transcript.loadingMore.value ? 'Loading…' : 'Load older messages' }}
          </button>

          <article
            v-for="message in transcript.messages.value"
            :key="message.id"
            class="turn"
            :class="`role-${message.type}`"
          >
            <header class="turn-head">
              <span class="role">{{ ROLE_LABEL[message.type] ?? message.type }}</span>
              <span v-if="message.agent" class="role-meta mono">{{ message.agent }}</span>
              <span v-if="message.model?.id" class="role-meta mono">{{ message.model.id }}</span>
              <span class="role-meta mono">{{ formatClock(message.created) }}</span>
            </header>

            <!-- Reasoning collapses: it is the bulkiest part and the least
                 often needed, and it is redacted with everything else. -->
            <div
              v-for="(part, index) in partsOf(message, 'reasoning')"
              :key="`r${index}`"
              class="reasoning"
            >
              <button
                type="button"
                class="reasoning-toggle"
                @click="toggleReasoning(`${message.id}:${index}`)"
              >
                <svg width="9" height="9" viewBox="0 0 16 16" fill="none"
                  stroke="var(--color-text-muted)" stroke-width="2" stroke-linecap="round"
                  stroke-linejoin="round">
                  <path :d="expandedReasoning.has(`${message.id}:${index}`) ? 'M3.5 6 8 10.5 12.5 6' : 'M6 3.5 10.5 8 6 12.5'" />
                </svg>
                <span>Reasoning</span>
                <span class="reasoning-size mono">{{
                  formatCount((part.text ?? '').length)
                }} chars</span>
              </button>
              <pre
                v-if="expandedReasoning.has(`${message.id}:${index}`)"
                class="reasoning-body mono"
              >{{ redaction ? REDACTED : part.text }}</pre>
            </div>

            <template v-for="(part, index) in partsOf(message, 'tool')" :key="`t${index}`">
              <div class="tool-card">
                <div class="tool-head">
                  <span class="tool-name mono">{{ part['name'] ?? 'tool' }}</span>
                  <span class="tool-state mono">{{ toolState(part) }}</span>
                </div>
                <p v-if="redaction" class="masked">
                  <svg width="11" height="11" viewBox="0 0 16 16" fill="none"
                    stroke="var(--color-text-muted)" stroke-width="1.5" stroke-linecap="round"
                    stroke-linejoin="round">
                    <rect x="3" y="7" width="10" height="7" rx="1.6" />
                    <path d="M5.6 7V5.2a2.4 2.4 0 0 1 4.8 0V7" />
                  </svg>
                  <span>tool output hidden by redaction</span>
                </p>
                <pre v-else class="tool-body mono">{{ JSON.stringify(part, null, 2) }}</pre>
              </div>
            </template>

            <div v-if="textOf(message)" class="text" :class="{ 'is-masked': redaction }">
              <template v-if="redaction">
                <div class="mask-lines">
                  <span class="mask" style="width: 72%" />
                  <span class="mask" style="width: 54%" />
                  <span class="mask" style="width: 63%" />
                </div>
                <p class="masked">
                  <span>content[].text hidden by redaction</span>
                </p>
              </template>
              <p v-else class="text-body">{{ textOf(message) }}</p>
            </div>
          </article>

          <div class="tail">
            <span class="live-dot" :class="{ 'is-on': connection === 'live' }" />
            <span class="mono">listening on /api/events/stream</span>
          </div>
        </template>
      </main>

      <aside class="rail">
        <section class="rail-group">
          <h2 class="rail-title">Session</h2>
          <dl class="meta">
            <dt>Model</dt><dd class="mono">{{ session?.model?.id ?? '—' }}</dd>
            <dt>Agent</dt><dd class="mono">{{ session?.agent ?? '—' }}</dd>
            <dt>Directory</dt><dd class="mono">{{ session?.directory ?? '—' }}</dd>
            <dt>Outcome</dt><dd class="mono">{{ session?.outcome ?? '—' }}</dd>
            <dt>Cost</dt><dd class="mono">{{ formatCost(session?.cost) }}</dd>
            <dt>Tokens</dt><dd class="mono">{{ formatTokens(billableTokens(session?.tokens)) }}</dd>
            <dt>Started</dt><dd class="mono">{{ formatRelative(session?.created, now) }} ago</dd>
          </dl>
        </section>

        <section class="rail-group">
          <div class="rail-head">
            <h2 class="rail-title">Live events</h2>
            <span class="rail-count mono">{{ formatCount(liveEvents.length) }}</span>
          </div>
          <p v-if="liveEvents.length === 0" class="rail-empty">
            No events for this session yet. Events arrive from the upstream
            stream, filtered on this session id.
          </p>
          <div v-for="envelope in liveEvents" :key="envelope.seq" class="event">
            <div class="event-head">
              <span class="event-dot" />
              <span class="event-type mono">{{ envelope.event.type }}</span>
              <span class="event-time mono">{{ formatClock(envelope.event.ts) }}</span>
            </div>
            <span class="event-meta mono">
              seq {{ envelope.event.seq ?? '—' }}
              <template v-if="envelope.event.directory"> · {{ envelope.event.directory }}</template>
            </span>
          </div>
        </section>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.explorer {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.session-bar {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 12px;
  height: var(--toolbar-height);
  flex-shrink: 0;
  padding: 0 16px;
  border-bottom: 1px solid var(--color-border);
}

.back {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--color-text-muted);
  flex-shrink: 0;
}

.back:hover {
  color: var(--color-text);
}

.rule {
  width: 1px;
  height: 16px;
  background-color: var(--color-border);
  flex-shrink: 0;
}

.heading {
  display: flex;
  flex-direction: row;
  align-items: baseline;
  gap: 9px;
  min-width: 0;
}

.heading-title {
  font-size: 13.5px;
  font-weight: var(--font-weight-semibold);
  letter-spacing: -0.01em;
  color: var(--color-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.heading-id {
  font-size: 10px;
  color: var(--color-text-faint);
  white-space: nowrap;
}

.bar-right {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 10px;
  margin-left: auto;
  flex-shrink: 0;
}

.live-pill {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 7px;
  height: 26px;
  padding: 0 10px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
  font-size: 10px;
  font-weight: var(--font-weight-semibold);
  letter-spacing: 0.06em;
  color: var(--color-text-muted);
}

.live-pill.is-on {
  background-color: var(--color-accent-bg);
  border-color: var(--color-accent-dim);
  color: var(--color-accent);
}

.live-dot {
  width: 6px;
  height: 6px;
  border-radius: var(--radius-full);
  background-color: var(--color-text-faint);
  flex-shrink: 0;
}

.live-dot.is-on {
  background-color: var(--color-accent);
}

.seq {
  font-size: 10.5px;
  color: var(--color-text-muted);
}

.redaction {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  height: 26px;
  padding: 0 10px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-size: 11.5px;
  color: var(--color-text-secondary);
}

.switch {
  display: flex;
  flex-direction: row;
  align-items: center;
  width: 24px;
  height: 14px;
  padding: 2px;
  background-color: var(--color-raised);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-full);
  box-sizing: border-box;
}

.switch.is-on {
  background-color: var(--color-accent-dim);
  border-color: var(--color-accent-dim);
  justify-content: flex-end;
}

.knob {
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
  background-color: var(--color-text-muted);
}

.switch.is-on .knob {
  background-color: var(--color-accent);
}

.body {
  display: flex;
  flex-direction: row;
  align-items: stretch;
  flex: 1;
  min-height: 0;
}

.transcript {
  display: flex;
  flex-direction: column;
  gap: 18px;
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 20px 24px 0;
}

.note {
  font-size: 12.5px;
  line-height: 19px;
  color: var(--color-text-muted);
}

.note-title {
  font-size: 13px;
  font-weight: var(--font-weight-medium);
  color: var(--color-text-secondary);
  margin-bottom: 6px;
}

.load-older {
  align-self: center;
  height: 28px;
  padding: 0 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-size: 12px;
  color: var(--color-text-secondary);
}

.turn {
  display: flex;
  flex-direction: column;
  gap: 9px;
}

.turn-head {
  display: flex;
  flex-direction: row;
  align-items: baseline;
  gap: 9px;
}

.role {
  font-size: 10px;
  font-weight: var(--font-weight-semibold);
  letter-spacing: var(--tracking-caps);
  color: var(--color-text-muted);
}

.role-meta {
  font-size: 10px;
  color: var(--color-text-faint);
}

.text-body {
  font-size: 13px;
  line-height: 20px;
  color: var(--color-text-secondary);
  white-space: pre-wrap;
}

.mask-lines {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.mask {
  height: 8px;
  border-radius: 2px;
  background-color: var(--color-overlay);
  display: block;
}

.masked {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  font-size: 10.5px;
  line-height: 15px;
  color: var(--color-text-muted);
}

.reasoning-toggle {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 7px;
  height: 22px;
  padding: 0 9px 0 7px;
  background-color: var(--color-raised);
  border-radius: var(--radius-xs);
  font-size: 11px;
  color: var(--color-text-muted);
}

.reasoning-size {
  font-size: 10px;
  color: var(--color-text-faint);
}

.reasoning-body {
  margin-top: 8px;
  padding: 10px 11px;
  background-color: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-size: 11px;
  line-height: 17px;
  color: var(--color-text-muted);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 420px;
  overflow-y: auto;
}

.tool-card {
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding: 11px 12px;
  background-color: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}

.tool-head {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 9px;
}

.tool-name {
  font-size: 11.5px;
  color: var(--color-text-secondary);
}

.tool-state {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: var(--radius-xs);
  background-color: var(--color-raised);
  color: var(--color-text-muted);
}

.tool-body {
  font-size: 11px;
  line-height: 17px;
  color: var(--color-text-muted);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 320px;
  overflow-y: auto;
}

.tail {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 9px;
  margin-top: auto;
  padding: 14px 0;
  font-size: 10.5px;
  color: var(--color-text-muted);
}

.rail {
  display: flex;
  flex-direction: column;
  width: 340px;
  flex-shrink: 0;
  background-color: var(--color-surface);
  border-left: 1px solid var(--color-border);
  overflow-y: auto;
}

.rail-group {
  padding: 14px 16px;
  border-bottom: 1px solid var(--color-divider);
}

.rail-head {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}

.rail-title {
  font-size: 10px;
  font-weight: var(--font-weight-semibold);
  letter-spacing: var(--tracking-caps);
  color: var(--color-text-muted);
  margin-bottom: 8px;
}

.rail-count {
  font-size: 10px;
  color: var(--color-text-faint);
}

.rail-empty {
  font-size: 11px;
  line-height: 16px;
  color: var(--color-text-muted);
}

.meta {
  display: grid;
  grid-template-columns: 88px 1fr;
  gap: 6px 10px;
}

.meta dt {
  font-size: 11px;
  color: var(--color-text-muted);
}

.meta dd {
  font-size: 11px;
  color: var(--color-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.event {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 7px 0;
  border-bottom: 1px solid var(--color-divider);
}

.event-head {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
}

.event-dot {
  width: 5px;
  height: 5px;
  border-radius: var(--radius-full);
  background-color: var(--color-accent);
  flex-shrink: 0;
}

.event-type {
  font-size: 11px;
  color: var(--color-text-secondary);
}

.event-time {
  margin-left: auto;
  font-size: 10px;
  color: var(--color-text-muted);
}

.event-meta {
  padding-left: 13px;
  font-size: 10px;
  color: var(--color-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
