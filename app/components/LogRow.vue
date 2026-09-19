<script setup lang="ts">
import type { LogRow } from '~/composables/useLogStream'

const props = defineProps<{
  row: LogRow
  selected?: boolean
}>()

const emit = defineEmits<{ select: [row: LogRow] }>()

const LEVEL_TONE: Record<string, string> = {
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error',
  DEBUG: 'debug',
}

const time = computed(() => {
  const at = Date.parse(props.row.record.ts)
  if (!Number.isFinite(at)) return props.row.record.ts
  const d = new Date(at)
  const pad = (n: number, width = 2) => String(n).padStart(width, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
})

/** Up to three field values, as `key=value`, as a quiet preview. */
const preview = computed(() => {
  const entries = Object.entries(props.row.record.fields)
  // When the message is missing the first field is promoted to the primary
  // text, so the preview must not repeat it.
  const rest = props.row.record.message ? entries : entries.slice(1)
  if (rest.length === 0) return ''
  return rest
    .slice(0, 3)
    .map(([key, value]) => `${key}=${value}`)
    .join(' ')
})

/**
 * A handful of lines carry neither `message` nor `msg` (6 of 7,648 in the live
 * buffer). Falling back to the first field keeps the row and the drawer from
 * rendering a blank where a description belongs.
 */
const primary = computed(() => {
  const record = props.row.record
  if (record.message) return record.message
  const first = Object.entries(record.fields)[0]
  return first ? `${first[0]}=${first[1]}` : '(no message)'
})

const tone = computed(() => LEVEL_TONE[props.row.record.level] ?? 'info')
const hasRail = computed(
  () => props.row.record.level === 'WARN' || props.row.record.level === 'ERROR',
)
</script>

<template>
  <button
    type="button"
    class="row"
    :class="[`tone-${tone}`, { 'is-selected': selected }]"
    @click="emit('select', row)"
  >
    <span v-if="hasRail" class="rail" />

    <span class="cell time mono">{{ time }}</span>

    <span class="cell level">
      <span class="dot" />
      <span class="level-label">{{ row.record.level }}</span>
    </span>

    <span class="cell role">{{ row.record.role ?? '—' }}</span>

    <span class="cell run">
      <span v-if="row.record.run" class="run-chip mono">{{ row.record.run }}</span>
    </span>

    <span class="cell message">
      <span class="message-text">{{ primary }}</span>
      <span v-if="preview" class="preview mono">{{ preview }}</span>
    </span>

    <span class="cell span mono">{{
      row.record.span === undefined ? '' : `#${row.record.span}`
    }}</span>
  </button>
</template>

<style scoped>
.row {
  position: relative;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: var(--lane-gap);
  width: 100%;
  height: var(--row-height);
  flex-shrink: 0;
  padding: 0 var(--row-padding-inline);
  text-align: left;
  border-bottom: 1px solid var(--color-divider);
  background-color: transparent;
  cursor: default;
}

.row:hover {
  background-color: var(--color-surface);
}

.row.is-selected {
  background-color: var(--color-raised);
}

.rail {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 2px;
}

.cell {
  flex-shrink: 0;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.time {
  width: var(--lane-time);
  font-size: 11.5px;
  line-height: var(--leading-tight);
  color: var(--color-text-muted);
}

.level {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
  width: var(--lane-level);
}

.dot {
  width: 5px;
  height: 5px;
  flex-shrink: 0;
  border-radius: var(--radius-full);
}

.level-label {
  font-size: 10px;
  font-weight: var(--font-weight-semibold);
  letter-spacing: 0.05em;
}

.role {
  width: var(--lane-role);
  font-size: 11px;
  line-height: var(--leading-tight);
  color: var(--color-text-muted);
}

.run {
  display: flex;
  flex-direction: row;
  align-items: center;
  width: var(--lane-run);
}

.run-chip {
  font-size: 10.5px;
  line-height: 15px;
  padding: 1px 5px;
  color: var(--color-text-muted);
  background-color: var(--color-raised);
  border-radius: var(--radius-xs);
}

.message {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 9px;
  flex: 1;
  /* A floor, so a narrow window shrinks the message lane rather than
     collapsing it to nothing. */
  min-width: 140px;
}

.message-text {
  flex-shrink: 0;
  /* Never let a long message push the preview out of the row; the drawer is
     where the full text lives. */
  max-width: 70%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 12.5px;
  line-height: var(--leading-tight);
  color: var(--color-text);
}

.preview {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  line-height: var(--leading-tight);
  color: var(--color-text-muted);
}

.span {
  width: var(--lane-span);
  text-align: right;
  font-size: 10.5px;
  line-height: var(--leading-tight);
  color: var(--color-text-muted);
}

/* INFO is the norm, so it recedes and lets WARN and ERROR carry. */
.tone-info .dot {
  background-color: var(--color-text-muted);
}
.tone-info .level-label {
  color: var(--color-text-muted);
}

.tone-warn .dot {
  background-color: var(--color-warn);
}
.tone-warn .level-label {
  color: var(--color-warn);
}
.tone-warn .rail {
  background-color: var(--color-warn);
}

.tone-error .dot {
  background-color: var(--color-error);
}
.tone-error .level-label {
  color: var(--color-error);
}
.tone-error .rail {
  background-color: var(--color-error);
}

.tone-debug .dot {
  background-color: var(--color-text-muted);
}
.tone-debug .level-label {
  color: var(--color-text-muted);
}
</style>
