<script setup lang="ts">
import type { LogLevel } from '#shared/types/records'
import type { LogFacetsResponse } from '#shared/types/logs'

import type { RoleFilter } from '~/composables/useLogFilters'

const props = defineProps<{
  facets: LogFacetsResponse | null
  levels: LogLevel[]
  role: RoleFilter
  run: string
  muted: string[]
  filteredOut: number
  activeFilterCount: number
}>()

const emit = defineEmits<{
  'toggle-level': [level: LogLevel]
  'set-role': [role: RoleFilter]
  'set-run': [run: string]
  'toggle-mute': [message: string]
  'unmute-all': []
  reset: []
}>()

const ALL_LEVELS: LogLevel[] = ['INFO', 'WARN', 'ERROR', 'DEBUG']

const levelTone: Record<LogLevel, string> = {
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error',
  DEBUG: 'debug',
}

const levelCounts = computed(() => {
  const map = new Map<string, number>()
  for (const entry of props.facets?.level ?? []) map.set(entry.value, entry.count)
  return map
})

/** The buffer is the real window, so its size is the honest denominator. */
const total = computed(() => props.facets?.total ?? 0)

const mutedSet = computed(() => new Set(props.muted))
const mutedCount = computed(() => props.muted.length)

const runs = computed(() => props.facets?.run ?? [])
const messages = computed(() => props.facets?.message ?? [])
</script>

<template>
  <aside class="panel">
    <div class="panel-head">
      <span class="panel-title">Filters</span>
      <button
        type="button"
        class="reset"
        :disabled="activeFilterCount === 0"
        @click="emit('reset')"
      >
        Reset{{ activeFilterCount ? ` (${activeFilterCount})` : '' }}
      </button>
    </div>

    <section class="group">
      <h2 class="group-title">Levels</h2>
      <button
        v-for="level in ALL_LEVELS"
        :key="level"
        type="button"
        class="facet-row"
        :class="{ 'is-off': !levels.includes(level) }"
        @click="emit('toggle-level', level)"
      >
        <span class="checkbox" :class="{ 'is-checked': levels.includes(level) }">
          <svg
            v-if="levels.includes(level)"
            width="9"
            height="9"
            viewBox="0 0 12 12"
            fill="none"
            stroke="#08110F"
            stroke-width="2.1"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M2.4 6.3 4.8 8.7 9.7 3.5" />
          </svg>
        </span>
        <span class="level-dot" :class="`tone-${levelTone[level]}`" />
        <span class="facet-label">{{ level }}</span>
        <span class="facet-count mono">{{
          (levelCounts.get(level) ?? 0).toLocaleString('en-US')
        }}</span>
      </button>
    </section>

    <section class="group">
      <h2 class="group-title">Role</h2>
      <div class="segmented">
        <button
          v-for="option in ['any', 'server', 'cli'] as RoleFilter[]"
          :key="option"
          type="button"
          class="segment"
          :class="{ 'is-active': role === option }"
          @click="emit('set-role', option)"
        >
          {{ option }}
        </button>
      </div>
    </section>

    <section v-if="runs.length" class="group">
      <h2 class="group-title">Run</h2>
      <!-- The design had a single compact select here rather than a list: with
           one run per session the list runs to twenty rows of count 1, which
           pushes the message controls off the panel. -->
      <label class="run-select">
        <select
          class="select-native"
          :value="run"
          @change="emit('set-run', ($event.target as HTMLSelectElement).value)"
        >
          <option value="any">All runs ({{ runs.length }})</option>
          <option v-for="entry in runs" :key="entry.value" :value="entry.value">
            {{ entry.value }} — {{ entry.count.toLocaleString('en-US') }}
          </option>
        </select>
        <span class="run-label mono">{{
          run === 'any' ? 'All runs' : run
        }}</span>
        <span class="run-count mono">{{
          (
            run === 'any'
              ? runs.length
              : (runs.find((r) => r.value === run)?.count ?? 0)
          ).toLocaleString('en-US')
        }}</span>
        <svg
          width="10"
          height="10"
          viewBox="0 0 16 16"
          fill="none"
          stroke="var(--color-text-faint)"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M4 6.5 8 10.5l4-4" />
        </svg>
      </label>
    </section>

    <section class="group">
      <div class="group-head">
        <h2 class="group-title">Messages</h2>
        <button
          v-if="muted.length"
          type="button"
          class="unmute"
          @click="emit('unmute-all')"
        >
          Unmute all ({{ muted.length }})
        </button>
      </div>

      <p v-if="muted.length" class="hint">
        Muted messages are hidden, never dropped — counts below include them.
      </p>

      <button
        v-for="entry in messages"
        :key="entry.value"
        type="button"
        class="facet-row message-row"
        :class="{ 'is-muted': mutedSet.has(entry.value) }"
        :title="
          mutedSet.has(entry.value)
            ? `Unmute “${entry.value}”`
            : `Mute “${entry.value}”`
        "
        @click="emit('toggle-mute', entry.value)"
      >
        <span class="mute-icon">
          <svg
            v-if="mutedSet.has(entry.value)"
            width="12"
            height="12"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M2 2l12 12" />
            <path d="M6.2 6.3A5.9 5.9 0 0 0 1.6 8s2.4 4 6.4 4a6.6 6.6 0 0 0 2.6-.5" />
            <path d="M9.4 4.4A6.3 6.3 0 0 1 14.4 8a11 11 0 0 1-1.9 2.2" />
          </svg>
          <svg
            v-else
            width="12"
            height="12"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M1.6 8s2.4-4 6.4-4 6.4 4 6.4 4-2.4 4-6.4 4S1.6 8 1.6 8z" />
            <circle cx="8" cy="8" r="1.8" />
          </svg>
        </span>
        <span class="facet-label">{{ entry.value }}</span>
        <span class="facet-count mono">{{
          entry.count.toLocaleString('en-US')
        }}</span>
      </button>
    </section>

    <div class="footer">
      <span class="mono">{{ total.toLocaleString('en-US') }} in buffer</span>
      <span v-if="filteredOut > 0" class="mono"
        >{{ filteredOut.toLocaleString('en-US') }} filtered out</span
      >
    </div>
  </aside>
</template>

<style scoped>
.panel {
  display: flex;
  flex-direction: column;
  width: 236px;
  flex-shrink: 0;
  padding: 14px 12px 12px;
  background-color: var(--color-surface);
  border-right: 1px solid var(--color-border);
  overflow-y: auto;
}

.panel-head {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}

.panel-title {
  font-size: 12px;
  font-weight: var(--font-weight-semibold);
  letter-spacing: -0.005em;
  color: var(--color-text);
}

.reset {
  font-size: 11px;
  line-height: 16px;
  color: var(--color-text-muted);
}

.reset:not(:disabled):hover {
  color: var(--color-accent);
}

.reset:disabled {
  color: var(--color-text-faint);
  cursor: default;
}

.group {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  margin-top: 18px;
  gap: 1px;
}

.group-head {
  display: flex;
  flex-direction: row;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.group-title {
  font-size: 10px;
  font-weight: var(--font-weight-semibold);
  letter-spacing: var(--tracking-caps);
  color: var(--color-text-muted);
  margin-bottom: 6px;
}

.unmute {
  font-size: 10px;
  font-weight: var(--font-weight-medium);
  letter-spacing: var(--tracking-caps);
  color: var(--color-accent);
}

.hint {
  font-size: 10.5px;
  line-height: 15px;
  color: var(--color-text-muted);
  margin-bottom: 4px;
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

.facet-row:hover .facet-label {
  color: var(--color-text);
}

.facet-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 12.5px;
  line-height: 16px;
  color: var(--color-text-secondary);
}

.facet-count {
  font-size: 10.5px;
  line-height: 16px;
  color: var(--color-text-muted);
}

.is-off .facet-label {
  color: var(--color-text-muted);
}

.is-off .facet-count {
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

.level-dot {
  width: 6px;
  height: 6px;
  flex-shrink: 0;
  border-radius: var(--radius-full);
  background-color: var(--color-text-faint);
}

.tone-info {
  background-color: var(--color-text-muted);
}
.tone-warn {
  background-color: var(--color-warn);
}
.tone-error {
  background-color: var(--color-error);
}
.tone-debug {
  background-color: var(--color-text-faint);
}

.segmented {
  display: flex;
  flex-direction: row;
  align-items: stretch;
  gap: 2px;
  padding: 2px;
  background-color: var(--color-raised);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}

.run-select {
  position: relative;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  height: 30px;
  padding: 0 9px 0 10px;
  background-color: var(--color-raised);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  cursor: pointer;
}

/* Native control kept for behaviour and accessibility, hidden so the label can
   carry the design's typography. */
.select-native {
  position: absolute;
  inset: 0;
  width: 100%;
  opacity: 0;
  cursor: pointer;
}

.run-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 11px;
  line-height: 16px;
  color: var(--color-text-secondary);
}

.run-count {
  flex-shrink: 0;
  font-size: 10px;
  line-height: 15px;
  padding: 1px 5px;
  color: var(--color-text-muted);
  background-color: var(--color-overlay);
  border-radius: var(--radius-xs);
}

.segment {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  height: 24px;
  border-radius: var(--radius-xs);
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 16px;
  color: var(--color-text-muted);
}

.segment.is-active {
  background-color: var(--color-overlay);
  color: var(--color-text);
}

.message-row {
  gap: 8px;
}

.mute-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 12px;
  flex-shrink: 0;
  color: var(--color-text-muted);
}

.is-muted .facet-label {
  color: var(--color-text-muted);
}

.is-muted .mute-icon {
  color: var(--color-text-faint);
}

.footer {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-top: auto;
  padding-top: 16px;
  font-family: var(--font-mono);
  font-size: 10px;
  line-height: 15px;
  color: var(--color-text-muted);
}
</style>
