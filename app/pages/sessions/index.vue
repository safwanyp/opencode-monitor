<script setup lang="ts">
import type { SessionSummary } from '#shared/types/events'
import {
  billableTokens,
  formatCost,
  formatCount,
  formatRelative,
  formatTokens,
} from '#shared/utils/format'

const { sessions, error, loading, reload } = useSessions()
const { key: sortKey, direction: sortDirection, toggle: toggleSort } = useSessionSort()
const { liveSessions, connection } = useEventStream()

/** Restarts the relative-time column so "12s" does not freeze at "12s". */
const now = ref(Date.now())
let ticker: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  ticker = setInterval(() => (now.value = Date.now()), 5_000)
})
onBeforeUnmount(() => {
  if (ticker) clearInterval(ticker)
})

const search = ref('')
const liveOnly = ref(false)
const outcomes = ref<string[]>([])

const allOutcomes = computed(() => {
  const counts = new Map<string, number>()
  for (const session of sessions.value) {
    const key = session.outcome ?? 'unknown'
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])
})

const sorted = computed(() =>
  sortSessions(sessions.value, sortKey.value, sortDirection.value),
)

const visible = computed(() => {
  const query = search.value.trim().toLowerCase()
  const outcomeSet = new Set(outcomes.value)

  return sorted.value.filter((session) => {
    if (liveOnly.value && !liveSessions.value.has(session.id)) return false
    if (outcomeSet.size > 0 && !outcomeSet.has(session.outcome ?? 'unknown')) return false
    if (query !== '') {
      const haystack = [
        session.title,
        session.directory ?? '',
        session.model?.id ?? '',
        session.agent ?? '',
        session.id,
      ]
        .join(' ')
        .toLowerCase()
      if (!haystack.includes(query)) return false
    }
    return true
  })
})

const totals = computed(() => {
  let cost = 0
  let tokens = 0
  for (const session of sessions.value) {
    cost += session.cost ?? 0
    tokens += billableTokens(session.tokens) ?? 0
  }
  return { cost, tokens }
})

const activeNow = computed(() => liveSessions.value.size)

function toggleOutcome(value: string) {
  outcomes.value = outcomes.value.includes(value)
    ? outcomes.value.filter((o) => o !== value)
    : [...outcomes.value, value]
}

function isLive(session: SessionSummary) {
  return liveSessions.value.has(session.id)
}

const COLUMNS: Array<{ key: SessionSortKey; label: string; cls: string; right?: boolean }> = [
  { key: 'title', label: 'Title', cls: 'title' },
  { key: 'directory', label: 'Directory', cls: 'dir' },
  { key: 'model', label: 'Model', cls: 'model' },
  { key: 'agent', label: 'Agent', cls: 'agent' },
  { key: 'cost', label: 'Cost', cls: 'cost', right: true },
  { key: 'tokens', label: 'Tokens', cls: 'tokens', right: true },
  { key: 'outcome', label: 'Outcome', cls: 'outcome' },
  { key: 'updated', label: 'Updated', cls: 'updated', right: true },
]

const OUTCOME_TONE: Record<string, string> = {
  succeeded: 'ok',
  failed: 'error',
  interrupted: 'warn',
}
</script>

<template>
  <div class="explorer">
    <div class="toolbar">
      <div class="search">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none"
          stroke="var(--color-text-muted)" stroke-width="1.6" stroke-linecap="round">
          <circle cx="7.2" cy="7.2" r="4.7" /><path d="M10.7 10.7 14 14" />
        </svg>
        <input
          v-model="search"
          class="search-input"
          type="text"
          placeholder="Filter by title, directory or model"
          spellcheck="false"
        />
      </div>

      <span class="count mono">
        {{ visible.length.toLocaleString('en-US') }} of
        {{ sessions.length.toLocaleString('en-US') }}
      </span>

      <span class="spacer" />

      <button
        type="button"
        class="chip"
        :class="{ 'is-on': liveOnly }"
        @click="liveOnly = !liveOnly"
      >
        <span class="live-dot" :class="{ 'is-on': connection === 'live' }" />
        Live only
      </button>

      <button type="button" class="chip" @click="reload()">Refresh</button>
    </div>

    <div class="body">
      <aside class="panel">
        <div class="panel-head">
          <span class="panel-title">Filters</span>
          <button
            type="button"
            class="reset"
            :disabled="outcomes.length === 0 && !liveOnly && search === ''"
            @click="outcomes = []; liveOnly = false; search = ''"
          >
            Reset
          </button>
        </div>

        <section class="group">
          <h2 class="group-title">Outcome</h2>
          <button
            v-for="[value, count] in allOutcomes"
            :key="value"
            type="button"
            class="facet-row"
            :class="{ 'is-off': outcomes.length > 0 && !outcomes.includes(value) }"
            @click="toggleOutcome(value)"
          >
            <span class="checkbox" :class="{ 'is-checked': outcomes.includes(value) }">
              <svg v-if="outcomes.includes(value)" width="9" height="9" viewBox="0 0 12 12"
                fill="none" stroke="#08110F" stroke-width="2.1" stroke-linecap="round"
                stroke-linejoin="round"><path d="M2.4 6.3 4.8 8.7 9.7 3.5" /></svg>
            </span>
            <span class="facet-label">{{ value }}</span>
            <span class="facet-count mono">{{ formatCount(count) }}</span>
          </button>
        </section>

        <p class="note">
          Live badges come from the event stream, filtered on the session id.
          Sessions below are polled, so the list can lag a live event by seconds.
        </p>
      </aside>

      <main class="main">
        <div class="summary">
          <div class="stat">
            <span class="stat-value mono" :class="{ 'is-live': activeNow > 0 }">{{
              formatCount(activeNow)
            }}</span>
            <span class="stat-label">Active now</span>
          </div>
          <span class="vrule" />
          <div class="stat">
            <span class="stat-value mono">{{ formatCount(sessions.length) }}</span>
            <span class="stat-label">Sessions</span>
          </div>
          <span class="vrule" />
          <div class="stat">
            <span class="stat-value mono">{{ formatCost(totals.cost) }}</span>
            <span class="stat-label">Total cost</span>
          </div>
          <span class="vrule" />
          <div class="stat">
            <span class="stat-value mono">{{ formatTokens(totals.tokens) }}</span>
            <span class="stat-label">Tokens</span>
          </div>
        </div>

        <div class="columns">
          <span class="col marker" aria-hidden="true" />
          <span
            v-for="column in COLUMNS"
            :key="column.key"
            class="col"
            :class="[column.cls, { right: column.right }]"
          >
            <button
              type="button"
              class="sort"
              :class="{ 'is-active': sortKey === column.key }"
              :aria-sort="
                sortKey === column.key
                  ? sortDirection === 'asc'
                    ? 'ascending'
                    : 'descending'
                  : 'none'
              "
              :title="`Sort by ${column.label.toLowerCase()}`"
              @click="toggleSort(column.key)"
            >
              <span>{{ column.label }}</span>
              <svg
                v-if="sortKey === column.key"
                width="10"
                height="10"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path :d="sortDirection === 'asc' ? 'M8 12.5 8 3.5M4 7 8 3l4 4' : 'M8 3.5 8 12.5M4 9l4 4 4-4'" />
              </svg>
            </button>
          </span>
        </div>

        <div class="list">
          <p v-if="loading" class="message">Loading sessions…</p>

          <div v-else-if="error" class="message">
            <p class="message-title">Explorer B cannot reach the service</p>
            <p class="message-body">
              {{ error }} — Explorer A keeps working, because it reads the file log.
            </p>
          </div>

          <p v-else-if="visible.length === 0" class="message">
            <template v-if="sessions.length === 0">No sessions yet.</template>
            <template v-else>No sessions match these filters.</template>
          </p>

          <NuxtLink
            v-for="session in visible"
            v-else
            :key="session.id"
            :to="`/sessions/${session.id}`"
            class="row"
          >
            <span class="cell marker">
              <span v-if="isLive(session)" class="live-dot is-on" />
            </span>
            <span class="cell title">{{ session.title }}</span>
            <span class="cell dir mono">{{ session.directory ?? '—' }}</span>
            <span class="cell model mono">{{ session.model?.id ?? '—' }}</span>
            <span class="cell agent">{{ session.agent ?? '—' }}</span>
            <span class="cell cost mono">{{ formatCost(session.cost) }}</span>
            <span class="cell tokens mono">{{
              formatTokens(billableTokens(session.tokens))
            }}</span>
            <span class="cell outcome">
              <span
                class="outcome-chip"
                :class="`tone-${OUTCOME_TONE[session.outcome ?? ''] ?? 'neutral'}`"
              >
                {{ session.outcome ?? 'unknown' }}
              </span>
            </span>
            <span class="cell updated mono">{{ formatRelative(session.updated, now) }}</span>
          </NuxtLink>
        </div>
      </main>
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

.toolbar {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 12px;
  height: var(--toolbar-height);
  flex-shrink: 0;
  padding: 0 16px;
  border-bottom: 1px solid var(--color-border);
}

.search {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 9px;
  height: 30px;
  padding: 0 10px;
  background-color: var(--color-raised);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  flex: 1;
  min-width: 0;
  max-width: 460px;
}

.search-input {
  flex: 1;
  min-width: 0;
  font-size: 12.5px;
  color: var(--color-text);
}

.search-input::placeholder {
  color: var(--color-text-muted);
}

.count {
  font-size: 10.5px;
  color: var(--color-text-muted);
  white-space: nowrap;
}

.spacer {
  margin-left: auto;
}

.chip {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 7px;
  height: 30px;
  padding: 0 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-size: 12px;
  color: var(--color-text-secondary);
  white-space: nowrap;
}

.chip.is-on {
  background-color: var(--color-accent-bg);
  border-color: var(--color-accent-dim);
  color: var(--color-accent);
}

.live-dot {
  width: 6px;
  height: 6px;
  border-radius: var(--radius-full);
  background-color: var(--color-text-faint);
}

.live-dot.is-on {
  background-color: var(--color-accent);
}

.body {
  display: flex;
  flex-direction: row;
  align-items: stretch;
  flex: 1;
  min-height: 0;
}

.panel {
  display: flex;
  flex-direction: column;
  width: 236px;
  flex-shrink: 0;
  padding: 14px 12px;
  background-color: var(--color-surface);
  border-right: 1px solid var(--color-border);
  overflow-y: auto;
}

.panel-head {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}

.panel-title {
  font-size: 12px;
  font-weight: var(--font-weight-semibold);
  color: var(--color-text);
}

.reset {
  font-size: 11px;
  color: var(--color-text-muted);
}

.reset:not(:disabled):hover {
  color: var(--color-accent);
}

.reset:disabled {
  color: var(--color-text-faint);
}

.group {
  display: flex;
  flex-direction: column;
  gap: 1px;
  margin-top: 18px;
}

.group-title {
  font-size: 10px;
  font-weight: var(--font-weight-semibold);
  letter-spacing: var(--tracking-caps);
  color: var(--color-text-muted);
  margin-bottom: 6px;
}

.facet-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 9px;
  height: 26px;
  width: 100%;
  text-align: left;
}

.facet-label {
  flex: 1;
  min-width: 0;
  font-size: 12.5px;
  color: var(--color-text-secondary);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.facet-count {
  font-size: 10.5px;
  color: var(--color-text-muted);
}

.is-off .facet-label {
  color: var(--color-text-muted);
}

.checkbox {
  width: 13px;
  height: 13px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1.5px solid var(--color-border-strong);
  border-radius: var(--radius-xs);
  box-sizing: border-box;
}

.checkbox.is-checked {
  background-color: var(--color-accent);
  border-color: var(--color-accent);
}

.note {
  margin-top: auto;
  padding-top: 16px;
  font-size: 10.5px;
  line-height: 15px;
  color: var(--color-text-muted);
}

.main {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.summary {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 20px;
  height: 78px;
  flex-shrink: 0;
  padding: 0 16px;
  border-bottom: 1px solid var(--color-border);
}

.stat {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex-shrink: 0;
}

.stat-value {
  font-size: var(--text-2xl);
  font-weight: var(--font-weight-bold);
  letter-spacing: -0.03em;
  line-height: 28px;
  color: var(--color-text);
}

.stat-value.is-live {
  color: var(--color-accent);
}

.stat-label {
  font-size: var(--text-2xs);
  font-weight: var(--font-weight-semibold);
  letter-spacing: var(--tracking-caps);
  color: var(--color-text-muted);
}

.vrule {
  width: 1px;
  height: 38px;
  flex-shrink: 0;
  background-color: var(--color-border);
}

.columns,
.row {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 12px;
  padding: 0 16px;
}

.columns {
  height: 30px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--color-border);
}

.col {
  flex-shrink: 0;
  font-size: var(--text-2xs);
  font-weight: var(--font-weight-semibold);
  letter-spacing: var(--tracking-caps);
  color: var(--color-text-muted);
}

/* The lane widths stay on the cell, so the button inside cannot shift them. */
.sort {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 5px;
  width: 100%;
  height: 30px;
  font: inherit;
  letter-spacing: inherit;
  color: inherit;
  text-align: inherit;
}

.col.right .sort {
  justify-content: flex-end;
}

.sort:hover {
  color: var(--color-text-secondary);
}

.sort.is-active {
  color: var(--color-text);
}

.marker {
  width: 10px;
}
.title {
  flex: 1;
  min-width: 160px;
}
.dir {
  width: 178px;
}
.model {
  width: 120px;
}
.agent {
  width: 76px;
}
.cost {
  width: 72px;
  text-align: right;
}
.tokens {
  width: 72px;
  text-align: right;
}
.outcome {
  width: 96px;
}
.updated {
  width: 64px;
  text-align: right;
}

.list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.row {
  height: 40px;
  border-bottom: 1px solid var(--color-divider);
}

.row:hover {
  background-color: var(--color-surface);
}

.cell {
  flex-shrink: 0;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.row .cell.title {
  font-size: 13px;
  font-weight: var(--font-weight-medium);
  color: var(--color-text);
}

.row .cell.dir,
.row .cell.model {
  font-size: 10.5px;
  color: var(--color-text-muted);
}

.row .cell.agent {
  font-size: 11px;
  color: var(--color-text-muted);
}

.row .cell.cost {
  font-size: 11px;
  color: var(--color-text-secondary);
}

.row .cell.tokens {
  font-size: 11px;
  color: var(--color-text-muted);
}

.row .cell.updated {
  font-size: 10.5px;
  color: var(--color-text-muted);
}

.outcome-chip {
  display: inline-flex;
  align-items: center;
  height: 19px;
  padding: 0 7px;
  border-radius: var(--radius-xs);
  font-size: 10px;
  font-weight: var(--font-weight-semibold);
  letter-spacing: 0.05em;
  background-color: var(--color-raised);
  color: var(--color-text-muted);
}

.outcome-chip.tone-ok {
  background-color: var(--color-accent-bg);
  color: var(--color-accent);
}

.outcome-chip.tone-error {
  background-color: var(--color-error-bg);
  color: var(--color-error);
}

.outcome-chip.tone-warn {
  background-color: var(--color-warn-bg);
  color: var(--color-warn);
}

.message {
  padding: 24px 16px;
  font-size: 12.5px;
  line-height: 19px;
  color: var(--color-text-muted);
}

.message-title {
  font-size: 13px;
  font-weight: var(--font-weight-medium);
  color: var(--color-text-secondary);
}

.message-body {
  margin-top: 6px;
}
</style>
