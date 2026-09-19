<script setup lang="ts">
import type { LogRow } from '~/composables/useLogStream'
import type { SpanGroup } from '~/composables/useLogViews'
import { buildSpanItems, summariseSpans } from '~/composables/useLogViews'

const props = defineProps<{
  rows: LogRow[]
  selectedSeq: number | null
}>()

const emit = defineEmits<{ select: [row: LogRow] }>()

const ROW_HEIGHT = 32

const expanded = ref(new Set<string>())

const groups = computed(() => groupSpans(props.rows))
const summary = computed(() => summariseSpans(groups.value))
const items = computed(() => buildSpanItems(groups.value, expanded.value))

const { scroller, totalHeight, startIndex, endIndex, offsetY, onScroll, isAtBottom, scrollToBottom } =
  useVirtualRows({ count: () => items.value.length, rowHeight: ROW_HEIGHT })

const window = computed(() => items.value.slice(startIndex.value, endIndex.value))

function toggle(key: string) {
  const next = new Set(expanded.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  expanded.value = next
}

/** A new set of records invalidates expansion state keyed to old groups. */
watch(
  () => props.rows.length,
  async () => {
    await nextTick()
    if (isAtBottom()) scrollToBottom()
  },
)

function timeOf(ts: string) {
  const at = Date.parse(ts)
  if (!Number.isFinite(at)) return ts
  const d = new Date(at)
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`
}

const tone = (level: string) => level.toLowerCase()

/** A one-line description when the span has no request shape of its own. */
function describe(group: SpanGroup): string {
  if (group.messages.length === 1) return group.messages[0] as string
  const extra = group.messages.length - 1
  return `${group.messages[0]} +${extra} more`
}
</script>

<template>
  <div class="wrap">
    <div class="summary">
      <div class="stat">
        <span class="stat-value mono">{{ summary.total.toLocaleString('en-US') }}</span>
        <span class="stat-label">Spans</span>
      </div>
      <span class="vrule" />
      <div class="stat">
        <span class="stat-value mono">{{ summary.multi.toLocaleString('en-US') }}</span>
        <span class="stat-label">Multi-line</span>
      </div>
      <span class="vrule" />
      <div class="stat">
        <span class="stat-value mono">{{ summary.withShape.toLocaleString('en-US') }}</span>
        <span class="stat-label">With request shape</span>
      </div>
      <span class="vrule" />
      <div class="stat">
        <span class="stat-value mono" :class="{ 'is-error': summary.failed > 0 }">
          {{ summary.failed.toLocaleString('en-US') }}
        </span>
        <span class="stat-label">Failed</span>
      </div>
      <span class="vrule" />
      <div class="stat">
        <span class="stat-value mono">{{ summary.slowest === null ? '—' : `${summary.slowest}ms` }}</span>
        <span class="stat-label">Slowest</span>
      </div>

      <p class="note">
        Grouped by run and span. A span value is only unique within a run, so the
        span alone would merge unrelated records.
      </p>
    </div>

    <div class="columns" aria-hidden="true">
      <span class="col chev" />
      <span class="col time">Time</span>
      <span class="col method">Method</span>
      <span class="col where">Span / message</span>
      <span class="col status">Status</span>
      <span class="col duration">Duration</span>
      <span class="col lines">Lines</span>
    </div>

    <div ref="scroller" class="scroller" @scroll="onScroll">
      <div class="sizer" :style="{ height: `${totalHeight}px` }">
        <div class="window" :style="{ transform: `translateY(${offsetY}px)` }">
          <template v-for="item in window" :key="item.key">
            <button
              v-if="item.kind === 'group'"
              type="button"
              class="row group-row"
              :class="[`tone-${tone(item.group.level)}`, { 'is-open': expanded.has(item.group.key) }]"
              :title="item.group.messages.join('\n')"
              @click="toggle(item.group.key)"
            >
              <span class="cell chev">
                <svg width="11" height="11" viewBox="0 0 16 16" fill="none"
                  :stroke="expanded.has(item.group.key) ? 'var(--color-accent)' : 'var(--color-text-muted)'"
                  stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <path :d="expanded.has(item.group.key) ? 'M3.5 6 8 10.5 12.5 6' : 'M6 3.5 10.5 8 6 12.5'" />
                </svg>
              </span>
              <span class="cell time mono">{{ timeOf(item.group.firstTs) }}</span>
              <span class="cell method mono">{{ item.group.method ?? '' }}</span>
              <span class="cell where">
                <span class="where-text mono">{{ item.group.url ?? describe(item.group) }}</span>
                <span class="where-meta mono">{{ item.group.run ?? '' }} · #{{ item.group.span }}</span>
              </span>
              <span class="cell status mono" :class="{ 'is-error': item.group.level === 'ERROR' }">
                {{ item.group.status ?? '' }}
              </span>
              <span class="cell duration mono" :class="{ 'is-slow': (item.group.durationMs ?? 0) >= 1000 }">
                {{ item.group.durationMs === undefined ? '' : `${item.group.durationMs}ms` }}
              </span>
              <span class="cell lines mono">{{ item.group.lines.length }}</span>
            </button>

            <button
              v-else
              type="button"
              class="row line-row"
              :class="{ 'is-selected': item.row?.seq === selectedSeq }"
              @click="item.row && emit('select', item.row)"
            >
              <span class="thread" />
              <span class="cell time mono">{{ item.row ? timeOf(item.row.record.ts) : '' }}</span>
              <span class="cell method" />
              <span class="cell where">
                <span class="level-dot" :class="`tone-${tone(item.row?.record.level ?? 'INFO')}`" />
                <span class="line-message mono">{{ item.row?.record.message }}</span>
              </span>
              <span class="cell status" />
              <span class="cell duration" />
              <span class="cell lines" />
            </button>
          </template>
        </div>
      </div>
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

.note {
  margin-left: auto;
  max-width: 34ch;
  text-align: right;
  font-size: 11px;
  line-height: 16px;
  color: var(--color-text-muted);
}

.columns {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: var(--lane-gap);
  height: 30px;
  flex-shrink: 0;
  padding: 0 var(--row-padding-inline);
  border-bottom: 1px solid var(--color-border);
}

.col {
  flex-shrink: 0;
  font-size: var(--text-2xs);
  font-weight: var(--font-weight-semibold);
  letter-spacing: var(--tracking-caps);
  color: var(--color-text-muted);
}

.col.chev {
  width: 14px;
}
.col.time {
  width: var(--lane-time);
}
.col.method {
  width: 54px;
}
.col.where {
  flex: 1;
  min-width: 140px;
}
.col.status {
  width: 56px;
}
.col.duration {
  width: 76px;
  text-align: right;
}
.col.lines {
  width: 46px;
  text-align: right;
}

.scroller {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
}

.sizer {
  position: relative;
  width: 100%;
}

.window {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  will-change: transform;
}

.row {
  position: relative;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: var(--lane-gap);
  width: 100%;
  height: var(--row-height);
  padding: 0 var(--row-padding-inline);
  text-align: left;
  border-bottom: 1px solid var(--color-divider);
}

.row:hover {
  background-color: var(--color-surface);
}

.group-row.is-open {
  background-color: var(--color-raised);
}

.line-row.is-selected {
  background-color: var(--color-raised);
}

.line-row {
  background-color: var(--color-surface);
}

.cell {
  flex-shrink: 0;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.cell.chev {
  width: 14px;
  display: flex;
  align-items: center;
}

.cell.time {
  width: var(--lane-time);
  font-size: 11.5px;
  line-height: var(--leading-tight);
  color: var(--color-text-muted);
}

.cell.method {
  width: 54px;
  font-size: 11px;
  line-height: var(--leading-tight);
  color: var(--color-text-secondary);
}

.cell.where {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 9px;
  flex: 1;
  min-width: 140px;
}

.where-text {
  flex-shrink: 0;
  max-width: 62%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 12px;
  line-height: var(--leading-tight);
  color: var(--color-text);
}

.where-meta {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 10.5px;
  line-height: var(--leading-tight);
  color: var(--color-text-muted);
}

.cell.status {
  width: 56px;
  font-size: 11.5px;
  line-height: var(--leading-tight);
  color: var(--color-text-secondary);
}

.cell.status.is-error {
  color: var(--color-error);
}

.cell.duration {
  width: 76px;
  text-align: right;
  font-size: 11.5px;
  line-height: var(--leading-tight);
  color: var(--color-text-muted);
}

.cell.duration.is-slow {
  color: var(--color-warn);
}

.cell.lines {
  width: 46px;
  text-align: right;
  font-size: 10.5px;
  line-height: var(--leading-tight);
  color: var(--color-text-muted);
}

/* An expanded span draws a thread down its left edge, so the lines read as
   belonging to the row above rather than as new top-level rows. */
.thread {
  position: absolute;
  left: 23px;
  top: 0;
  bottom: 0;
  width: 1px;
  background-color: var(--color-border);
}

.line-row .cell.time {
  padding-left: 22px;
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
  font-size: 11.5px;
  line-height: var(--leading-tight);
  color: var(--color-text-secondary);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
</style>
