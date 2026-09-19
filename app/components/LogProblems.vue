<script setup lang="ts">
import type { LogRow } from '~/composables/useLogStream'
import type { ProblemGrouping } from '~/composables/useLogViews'
import { buildProblemItems, groupProblems } from '~/composables/useLogViews'

const props = defineProps<{
  rows: LogRow[]
  selectedSeq: number | null
}>()

const emit = defineEmits<{ select: [row: LogRow] }>()

/** The list is not virtualised: problem rows wrap their cause, so heights vary.
 *  The cap bounds the DOM instead — problems are a small fraction of records. */
const MAX_GROUPS = 500

const grouping = ref<ProblemGrouping>('newest')
const expanded = ref(new Set<string>())

const GROUPINGS: Array<{ value: ProblemGrouping; label: string }> = [
  { value: 'newest', label: 'Newest first' },
  { value: 'message', label: 'Message' },
  { value: 'cause', label: 'Cause' },
  { value: 'run', label: 'Run' },
]

const allGroups = computed(() => groupProblems(props.rows, grouping.value))
const groups = computed(() => allGroups.value.slice(0, MAX_GROUPS))
const hidden = computed(() => Math.max(0, allGroups.value.length - MAX_GROUPS))
const items = computed(() => buildProblemItems(groups.value, expanded.value))

const counts = computed(() => {
  let errors = 0
  let warnings = 0
  for (const row of props.rows) {
    if (row.record.level === 'ERROR') errors++
    else if (row.record.level === 'WARN') warnings++
  }
  return { errors, warnings }
})

const topCause = computed(() => {
  const tally = new Map<string, number>()
  for (const group of allGroups.value) {
    const cause = group.cause ?? group.message
    tally.set(cause, (tally.get(cause) ?? 0) + group.count)
  }
  const ranked = [...tally.entries()].sort((a, b) => b[1] - a[1])
  return ranked[0]?.[0] ?? null
})

function toggle(key: string) {
  const next = new Set(expanded.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  expanded.value = next
}

function timeOf(ts: string) {
  const at = Date.parse(ts)
  if (!Number.isFinite(at)) return ts
  const d = new Date(at)
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`
}

const tone = (level: string) => level.toLowerCase()
</script>

<template>
  <div class="wrap">
    <div class="summary">
      <div class="stat">
        <span class="stat-value mono is-error">{{ counts.errors.toLocaleString('en-US') }}</span>
        <span class="stat-label">Errors</span>
      </div>
      <span class="vrule" />
      <div class="stat">
        <span class="stat-value mono is-warn">{{ counts.warnings.toLocaleString('en-US') }}</span>
        <span class="stat-label">Warnings</span>
      </div>
      <span class="vrule" />
      <div class="stat">
        <span class="stat-value mono">{{ groups.length.toLocaleString('en-US') }}</span>
        <span class="stat-label">{{ grouping === 'newest' ? 'Occurrences' : 'Groups' }}</span>
      </div>
      <span class="vrule" />

      <div class="top-cause">
        <span class="stat-label">Most frequent</span>
        <span class="cause-text mono">{{ topCause ?? 'No problems in range' }}</span>
      </div>

      <div class="grouping" role="group" aria-label="Group problems by">
        <button
          v-for="option in GROUPINGS"
          :key="option.value"
          type="button"
          class="segment"
          :class="{ 'is-active': grouping === option.value }"
          @click="grouping = option.value"
        >
          {{ option.label }}
        </button>
      </div>
    </div>

    <div class="scroller">
      <p v-if="items.length === 0" class="empty">
        No warnings or errors in the retained window.
      </p>

      <template v-for="item in items" :key="item.key">
        <div
          v-if="item.kind === 'group'"
          class="problem"
          :class="`tone-${tone(item.group.level)}`"
          :style="{ backgroundColor: expanded.has(item.group.key) ? 'var(--color-surface)' : undefined }"
        >
          <span class="rail" />
          <button type="button" class="problem-head" @click="toggle(item.group.key)">
            <span class="level">{{ item.group.level }}</span>
            <span class="message">{{ item.group.message || '(no message)' }}</span>
            <span v-if="item.group.count > 1" class="count mono">{{ item.group.count }}x</span>
            <span class="spacer" />
            <span class="when mono">last {{ timeOf(item.group.lastTs) }}</span>
            <span class="meta mono">{{ item.group.run ?? '' }}<template v-if="item.group.span !== undefined"> · #{{ item.group.span }}</template></span>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none"
              :stroke="expanded.has(item.group.key) ? 'var(--color-accent)' : 'var(--color-text-faint)'"
              stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <path :d="expanded.has(item.group.key) ? 'M3.5 6 8 10.5 12.5 6' : 'M6 3.5 10.5 8 6 12.5'" />
            </svg>
          </button>

          <!-- The cause is rendered in full: it is the reason the row is here. -->
          <p v-if="item.group.cause" class="cause mono">{{ item.group.cause }}</p>
        </div>

        <button
          v-else
          type="button"
          class="line"
          :class="{ 'is-selected': item.row?.seq === selectedSeq }"
          @click="item.row && emit('select', item.row)"
        >
          <span class="line-time mono">{{ item.row ? timeOf(item.row.record.ts) : '' }}</span>
          <span class="level-dot" :class="`tone-${tone(item.row?.record.level ?? 'WARN')}`" />
          <span class="line-message mono">{{ item.row?.record.message }}</span>
        </button>
      </template>

      <p v-if="hidden > 0" class="more">
        {{ hidden.toLocaleString('en-US') }} more groups not shown. Narrow the
        filters, or group by message to see them collapsed.
      </p>
    </div>
  </div>
</template>

<style scoped>
.wrap {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.summary {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 20px;
  flex-shrink: 0;
  min-height: 78px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-border);
}

.stat {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex-shrink: 0;
}

.stat-value {
  font-size: var(--text-xl);
  font-weight: var(--font-weight-bold);
  letter-spacing: -0.03em;
  line-height: 24px;
  color: var(--color-text);
}

.stat-value.is-error {
  color: var(--color-error);
}

.stat-value.is-warn {
  color: var(--color-warn);
}

.stat-label {
  font-size: var(--text-2xs);
  font-weight: var(--font-weight-semibold);
  letter-spacing: var(--tracking-caps);
  color: var(--color-text-muted);
}

.vrule {
  width: 1px;
  height: 34px;
  flex-shrink: 0;
  background-color: var(--color-border);
}

.top-cause {
  display: flex;
  flex-direction: column;
  gap: 5px;
  flex: 1;
  min-width: 0;
}

.cause-text {
  font-size: 11.5px;
  line-height: 16px;
  color: var(--color-text-secondary);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.grouping {
  display: flex;
  flex-direction: row;
  align-items: stretch;
  gap: 2px;
  padding: 2px;
  flex-shrink: 0;
  background-color: var(--color-raised);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}

.segment {
  display: flex;
  align-items: center;
  height: 24px;
  padding: 0 10px;
  border-radius: var(--radius-xs);
  font-size: 11px;
  line-height: 16px;
  color: var(--color-text-muted);
  white-space: nowrap;
}

.segment.is-active {
  background-color: var(--color-overlay);
  color: var(--color-text);
}

.scroller {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-bottom: 24px;
}

.empty,
.more {
  padding: 16px;
  font-size: 12px;
  line-height: 18px;
  color: var(--color-text-muted);
}

.problem {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 11px 16px 12px 20px;
  border-bottom: 1px solid var(--color-divider);
}

.rail {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 2px;
}

.tone-warn .rail {
  background-color: var(--color-warn);
}

.tone-error .rail {
  background-color: var(--color-error);
}

.problem-head {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 10px;
  width: 100%;
  text-align: left;
}

.level {
  width: 44px;
  flex-shrink: 0;
  font-size: 10px;
  font-weight: var(--font-weight-semibold);
  letter-spacing: 0.05em;
}

.tone-warn .level {
  color: var(--color-warn);
}

.tone-error .level {
  color: var(--color-error);
}

.message {
  flex-shrink: 0;
  max-width: 46%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 13px;
  font-weight: var(--font-weight-medium);
  line-height: 17px;
  color: var(--color-text);
}

.count {
  flex-shrink: 0;
  font-size: 10px;
  line-height: 15px;
  padding: 1px 6px;
  border-radius: var(--radius-xs);
}

.tone-warn .count {
  background-color: var(--color-warn-bg);
  color: var(--color-warn);
}

.tone-error .count {
  background-color: var(--color-error-bg);
  color: var(--color-error);
}

.spacer {
  margin-left: auto;
}

.when {
  flex-shrink: 0;
  font-size: 11px;
  line-height: 16px;
  color: var(--color-text-muted);
}

.meta {
  flex-shrink: 0;
  font-size: 10.5px;
  line-height: 16px;
  color: var(--color-text-muted);
}

.cause {
  padding-left: 54px;
  font-size: 11px;
  line-height: 17px;
  color: var(--color-text-muted);
  word-break: break-word;
  white-space: pre-wrap;
}

.line {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 9px;
  width: 100%;
  height: 28px;
  padding: 0 16px 0 74px;
  text-align: left;
  background-color: var(--color-surface);
  border-bottom: 1px solid var(--color-divider);
}

.line.is-selected {
  background-color: var(--color-raised);
}

.line-time {
  flex-shrink: 0;
  font-size: 11px;
  line-height: 16px;
  color: var(--color-text-muted);
}

.level-dot {
  width: 5px;
  height: 5px;
  flex-shrink: 0;
  border-radius: var(--radius-full);
  background-color: var(--color-text-muted);
}

.level-dot.tone-warn {
  background-color: var(--color-warn);
}

.level-dot.tone-error {
  background-color: var(--color-error);
}

.line-message {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 11.5px;
  line-height: 16px;
  color: var(--color-text-secondary);
}
</style>
