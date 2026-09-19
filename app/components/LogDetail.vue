<script setup lang="ts">
import type { LogRecord } from '#shared/types/records'
import { redactRecord } from '#shared/utils/redaction'
import { formatDateTime } from '#shared/utils/format'

import type { LogRow } from '~/composables/useLogStream'

const props = defineProps<{
  row: LogRow | null
  redaction: boolean
}>()

const emit = defineEmits<{
  close: []
  'toggle-redaction': []
  'filter-run': [run: string]
  'filter-span': [span: number]
  'mute-message': [message: string]
}>()

type Tab = 'fields' | 'json' | 'raw'
const tab = ref<Tab>('fields')

watch(
  () => props.row?.seq,
  () => {
    tab.value = 'fields'
  },
)

const redacted = computed(() => {
  if (!props.row) return { value: null as LogRecord | null, masked: 0 }
  return props.redaction
    ? redactRecord(props.row.record)
    : { value: props.row.record, masked: 0 }
})

const record = computed(() => redacted.value.value)

/** Same fallback the row uses, so the drawer is never titled with nothing. */
const title = computed(() => {
  if (!record.value) return ''
  if (record.value.message) return record.value.message
  const first = Object.entries(record.value.fields)[0]
  return first ? `${first[0]}=${first[1]}` : '(no message)'
})

/** Only offer to mute something that has a message to match on. */
const canMute = computed(() => Boolean(record.value?.message))

const levelTone: Record<string, string> = {
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error',
  DEBUG: 'debug',
}

/**
 * Full date and time here, not just the clock. The list can span several days,
 * and a bare `HH:MM:SS` in the detail view would be the one place a user cannot
 * tell which day they are looking at.
 */
const time = computed(() => formatDateTime(record.value?.ts))

/** JSON-looking values are the ones worth pretty-printing. */
function prettyJson(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2)
  } catch {
    return null
  }
}

const fieldEntries = computed(() =>
  Object.entries(record.value?.fields ?? {}).map(([key, value]) => ({
    key,
    value,
    json: prettyJson(value),
  })),
)

const jsonView = computed(() =>
  record.value ? JSON.stringify(record.value, null, 2) : '',
)

function quote(value: string): string {
  return /[\s"\\]/.test(value)
    ? `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`
    : value
}

/** Rebuild the line as it appears in the file, minus the promoted keys. */
const rawLine = computed(() => {
  if (!record.value) return ''
  const r = record.value
  const parts = [`timestamp=${r.ts}`, `level=${r.level}`]
  if (r.run) parts.push(`run=${r.run}`)
  parts.push(`message=${quote(r.message)}`)
  for (const [key, value] of Object.entries(r.fields)) {
    parts.push(`${key}=${quote(value)}`)
  }
  if (r.span !== undefined) parts.push(`http.span=${r.span}`)
  if (r.role) parts.push(`role=${r.role}`)
  return parts.join(' ')
})
</script>

<template>
  <aside class="drawer">
    <div v-if="!record" class="empty">
      <p class="empty-title">No record selected</p>
      <p class="empty-body">
        Pick a line in the stream to see its fields, its JSON, and the raw line
        as written.
      </p>
    </div>

    <template v-else>
      <header class="head">
        <div class="head-row">
          <span class="chip" :class="`tone-${levelTone[record.level] ?? 'info'}`">
            <span class="chip-dot" />
            {{ record.level }}
          </span>

          <button
            type="button"
            class="redaction"
            :title="
              redaction ? 'Redaction is on — click to show values' : 'Redaction is off'
            "
            @click="emit('toggle-redaction')"
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 16 16"
              fill="none"
              :stroke="redaction ? 'var(--color-accent)' : 'var(--color-text-muted)'"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M8 1.8 3 3.9v4.3c0 3 2.1 5.4 5 6.1 2.9-.7 5-3.1 5-6.1V3.9z" />
            </svg>
            <span>Redaction {{ redaction ? 'on' : 'off' }}</span>
            <span class="switch" :class="{ 'is-on': redaction }"><span class="knob" /></span>
          </button>

          <button
            type="button"
            class="close"
            aria-label="Clear selection"
            @click="emit('close')"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              stroke-width="1.7"
              stroke-linecap="round"
            >
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>

        <h2 class="title">{{ title }}</h2>

        <div class="meta">
          <span class="mono">{{ time }}</span>
          <span class="sep">·</span>
          <span class="mono">seq {{ row?.seq }}</span>
          <template v-if="record.run">
            <span class="sep">·</span>
            <span class="mono">{{ record.run }}</span>
          </template>
          <template v-if="record.role">
            <span class="sep">·</span>
            <span class="mono">{{ record.role }}</span>
          </template>
          <template v-if="record.span !== undefined">
            <span class="sep">·</span>
            <span class="mono">#{{ record.span }}</span>
          </template>
        </div>

        <p v-if="redacted.masked > 0" class="masked">
          {{ redacted.masked }} value{{ redacted.masked === 1 ? '' : 's' }} masked
        </p>
      </header>

      <nav class="tabs">
        <button
          v-for="option in ['fields', 'json', 'raw'] as Tab[]"
          :key="option"
          type="button"
          class="tab"
          :class="{ 'is-active': tab === option }"
          @click="tab = option"
        >
          {{ option === 'raw' ? 'Raw line' : option === 'json' ? 'JSON' : 'Fields' }}
        </button>
      </nav>

      <div class="body">
        <template v-if="tab === 'fields'">
          <p v-if="fieldEntries.length === 0" class="note">
            This record has no extra fields.
          </p>
          <div
            v-for="entry in fieldEntries"
            :key="entry.key"
            class="field"
            :class="{ 'is-block': entry.json }"
          >
            <span class="field-key mono">{{ entry.key }}</span>
            <div class="field-value">
              <pre v-if="entry.json" class="code mono">{{ entry.json }}</pre>
              <span v-else class="mono">{{ entry.value || '—' }}</span>
            </div>
          </div>
        </template>

        <pre v-else-if="tab === 'json'" class="code mono">{{ jsonView }}</pre>

        <pre v-else class="code mono">{{ rawLine }}</pre>
      </div>

      <div class="related">
        <h3 class="section-title">Related</h3>
        <button
          v-if="record.run"
          type="button"
          class="related-row"
          @click="emit('filter-run', record.run)"
        >
          <span>Filter to run {{ record.run }}</span>
          <span class="chev">›</span>
        </button>
        <button
          v-if="record.span !== undefined"
          type="button"
          class="related-row"
          @click="emit('filter-span', record.span)"
        >
          <span>Search span #{{ record.span }}</span>
          <span class="chev">›</span>
        </button>
        <button
          v-if="canMute"
          type="button"
          class="related-row"
          @click="emit('mute-message', record.message)"
        >
          <span>Mute “{{ record.message }}”</span>
          <span class="chev">›</span>
        </button>
      </div>
    </template>
  </aside>
</template>

<style scoped>
.drawer {
  display: flex;
  flex-direction: column;
  width: 384px;
  flex-shrink: 0;
  background-color: var(--color-surface);
  border-left: 1px solid var(--color-border);
  overflow: hidden;
}

.empty {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 24px 16px;
}

.empty-title {
  font-size: 12px;
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-secondary);
}

.empty-body {
  font-size: 12px;
  line-height: 18px;
  color: var(--color-text-muted);
}

.head {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  padding: 14px 16px;
  border-bottom: 1px solid var(--color-border);
}

.head-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.chip {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
  height: 20px;
  padding: 0 8px;
  border-radius: var(--radius-xs);
  font-size: 10px;
  font-weight: var(--font-weight-semibold);
  letter-spacing: 0.06em;
}

.chip-dot {
  width: 5px;
  height: 5px;
  border-radius: var(--radius-full);
  background-color: currentColor;
}

.tone-info {
  background-color: var(--color-raised);
  color: var(--color-text-secondary);
}
.tone-warn {
  background-color: var(--color-warn-bg);
  color: var(--color-warn);
}
.tone-error {
  background-color: var(--color-error-bg);
  color: var(--color-error);
}
.tone-debug {
  background-color: var(--color-raised);
  color: var(--color-text-muted);
}

.redaction {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  line-height: 16px;
  color: var(--color-text-muted);
}

.redaction:hover {
  color: var(--color-text-secondary);
}

.close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  margin-left: 4px;
  color: var(--color-text-muted);
  border-radius: var(--radius-xs);
}

.close:hover {
  color: var(--color-text);
  background-color: var(--color-raised);
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

.title {
  margin-top: 14px;
  font-size: 15px;
  font-weight: var(--font-weight-semibold);
  letter-spacing: -0.015em;
  line-height: 21px;
  color: var(--color-text);
}

.meta {
  display: flex;
  flex-direction: row;
  align-items: center;
  flex-wrap: wrap;
  gap: 7px;
  margin-top: 9px;
  font-size: 11px;
  line-height: 16px;
  color: var(--color-text-muted);
}

.sep {
  color: var(--color-text-faint);
}

.masked {
  margin-top: 8px;
  font-size: 10.5px;
  line-height: 15px;
  color: var(--color-accent);
}

.tabs {
  display: flex;
  flex-direction: row;
  align-items: stretch;
  gap: 18px;
  height: 40px;
  flex-shrink: 0;
  padding: 0 16px;
}

.tab {
  display: flex;
  align-items: center;
  font-size: 12px;
  color: var(--color-text-muted);
  border-bottom: 2px solid transparent;
}

.tab.is-active {
  color: var(--color-text);
  font-weight: var(--font-weight-medium);
  border-bottom-color: var(--color-accent);
}

.body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 10px 16px 0;
}

.note {
  font-size: 12px;
  color: var(--color-text-muted);
}

/* Key on the left in a fixed lane, value on the right: scan the keys down one
   column rather than hunting for them. A JSON-looking value gets the full width
   instead, because a pretty-printed block needs it. */
.field {
  display: flex;
  flex-direction: row;
  align-items: baseline;
  gap: 12px;
}

.field.is-block {
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
}

.field-key {
  width: 104px;
  flex-shrink: 0;
  font-size: 11px;
  line-height: 16px;
  color: var(--color-text-muted);
}

.field-value {
  flex: 1;
  min-width: 0;
  font-size: 11.5px;
  line-height: 17px;
  color: var(--color-text-secondary);
  word-break: break-word;
  white-space: pre-wrap;
}

.code {
  font-size: 11px;
  line-height: 17px;
  padding: 9px 11px;
  background-color: var(--color-raised);
  border-radius: var(--radius-sm);
  color: var(--color-text-secondary);
  white-space: pre-wrap;
  word-break: break-word;
  overflow-x: auto;
}

.related {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  padding: 14px 16px 16px;
  border-top: 1px solid var(--color-divider);
}

.section-title {
  font-size: 10px;
  font-weight: var(--font-weight-semibold);
  letter-spacing: var(--tracking-caps);
  color: var(--color-text-muted);
  margin-bottom: 6px;
}

.related-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 9px;
  height: 30px;
  width: 100%;
  text-align: left;
  font-size: 12px;
  line-height: 16px;
  color: var(--color-text-secondary);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.related-row:hover {
  color: var(--color-text);
}

.chev {
  color: var(--color-text-faint);
}
</style>
