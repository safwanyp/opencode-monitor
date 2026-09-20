<script setup lang="ts">
import type { LogRow } from '~/composables/useLogStream'
import { createDayCursor } from '#shared/utils/format'

const props = defineProps<{
  rows: LogRow[]
  selectedSeq: number | null
  following: boolean
  unseen: number
}>()

const emit = defineEmits<{
  select: [row: LogRow]
  follow: []
  pause: []
}>()

/** Fallback only; the real value is read from the `--row-height` token. */
const ROW_HEIGHT = 32

const headerRef = ref<HTMLElement | null>(null)

type StreamItem =
  | { kind: 'row'; key: string; row: LogRow }
  | { kind: 'day'; key: string; label: string }

/**
 * Rows, with a separator wherever the calendar day changes.
 *
 * A bare `HH:MM:SS` column cannot distinguish two days, and the retained window
 * spans several once the log is quiet — the file itself already holds seven
 * dates. The separator is the same height as a row, so the list stays uniform
 * and the virtualiser is unaffected.
 */
const items = computed<StreamItem[]>(() => {
  const out: StreamItem[] = []
  const nextMarker = createDayCursor()

  for (const row of props.rows) {
    const marker = nextMarker(row.record.ts)
    if (marker) out.push(marker)
    out.push({ kind: 'row', key: `row:${row.seq}`, row })
  }

  return out
})

const {
  scroller,
  totalHeight,
  startIndex,
  endIndex,
  offsetY,
  onScroll,
  isAtBottom,
  scrollToBottom,
} = useVirtualRows({
  count: () => items.value.length,
  rowHeight: ROW_HEIGHT,
  // The header lives inside the scroller so it shares the rows' width exactly;
  // the window maths therefore has to skip its height.
  leadingOffset: () => headerRef.value?.offsetHeight ?? 0,
})

const window = computed(() => items.value.slice(startIndex.value, endIndex.value))

/**
 * The first fill jumps to the newest record unconditionally.
 *
 * Follow has to be conditional afterwards so that scrolling up to read is never
 * fought — but on first paint there is no user intent to respect, and landing
 * on the oldest records is simply wrong.
 *
 * This also has to run on mount, not only on change: the parent renders this
 * component only once there are rows, so `rows.length` never changes from zero.
 */
let didInitialScroll = false

function jumpToNewest() {
  didInitialScroll = true
  scrollToBottom()
}

onMounted(() => {
  if (props.rows.length === 0) return
  requestAnimationFrame(() => {
    if (props.rows.length > 0) jumpToNewest()
  })
})

watch(
  () => props.rows.length,
  async () => {
    await nextTick()
    if (props.rows.length === 0) return

    if (!didInitialScroll) {
      jumpToNewest()
      return
    }

    if (props.following && isAtBottom()) scrollToBottom()
  },
)

/** Scrolling is the follow control: up means stop following, bottom means resume. */
function onUserScroll() {
  onScroll()
  const atBottom = isAtBottom()
  if (atBottom && !props.following) emit('follow')
  else if (!atBottom && props.following) emit('pause')
}
</script>

<template>
  <div class="wrap">
    <div
      ref="scroller"
      class="scroller"
      role="log"
      aria-label="Service log records"
      aria-live="off"
      @scroll="onUserScroll"
    >
      <div ref="headerRef" class="columns" aria-hidden="true">
        <span class="col time">Time</span>
        <span class="col level">Level</span>
        <span class="col role">Role</span>
        <span class="col run">Run</span>
        <span class="col message">Message</span>
        <span class="col span">Span</span>
      </div>

      <div class="sizer" :style="{ height: `${totalHeight}px` }">
        <div class="window" :style="{ transform: `translateY(${offsetY}px)` }">
          <template v-for="item in window" :key="item.key">
            <div v-if="item.kind === 'day'" class="day">
              <span class="day-rule" />
              <span class="day-label mono">{{ item.label }}</span>
              <span class="day-rule" />
            </div>

            <LogRow
              v-else
              :row="item.row"
              :selected="item.row.seq === selectedSeq"
              @select="emit('select', $event)"
            />
          </template>
        </div>
      </div>
    </div>

    <Transition name="fade">
      <button
        v-if="!following && unseen > 0"
        type="button"
        class="jump"
        @click="emit('follow')"
      >
        <span class="jump-dot" />
        <span>{{ unseen.toLocaleString('en-US') }} new</span>
        <span class="jump-action">Jump to live</span>
      </button>
    </Transition>
  </div>
</template>

<style scoped>
.wrap {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

/* Lanes come from the same tokens the rows use, so the two cannot drift.
   Inside the scroller and sticky, so it shares the rows' width exactly — a
   header outside would be one scrollbar wider than the rows it labels. */
.columns {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: var(--lane-gap);
  height: 30px;
  flex-shrink: 0;
  padding: 0 var(--row-padding-inline);
  border-bottom: 1px solid var(--color-border);
  background-color: var(--color-bg);
}

.col {
  flex-shrink: 0;
  font-size: var(--text-2xs);
  font-weight: var(--font-weight-semibold);
  letter-spacing: var(--tracking-caps);
  color: var(--color-text-muted);
}

.col.time {
  width: var(--lane-time);
}
.col.level {
  width: var(--lane-level);
}
.col.role {
  width: var(--lane-role);
}
.col.run {
  width: var(--lane-run);
}
.col.message {
  flex: 1;
  min-width: 140px;
}
.col.span {
  width: var(--lane-span);
  text-align: right;
}

.scroller {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
}

/* A day separator at row height, so the list stays uniform for the virtualiser. */
.day {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 12px;
  height: var(--row-height);
  flex-shrink: 0;
  padding: 0 var(--row-padding-inline);
}

.day-rule {
  flex: 1;
  height: 1px;
  background-color: var(--color-border);
}

.day-label {
  flex-shrink: 0;
  font-size: var(--text-2xs);
  font-weight: var(--font-weight-semibold);
  letter-spacing: var(--tracking-caps);
  color: var(--color-text-muted);
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

.jump {
  position: absolute;
  left: 50%;
  bottom: 16px;
  transform: translateX(-50%);
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  height: 30px;
  padding: 0 12px;
  background-color: var(--color-overlay);
  border: 1px solid var(--color-accent-dim);
  border-radius: var(--radius-full);
  font-size: 12px;
  color: var(--color-text-secondary);
  box-shadow: var(--shadow-popover);
}

.jump:hover {
  border-color: var(--color-accent);
}

.jump-dot {
  width: 6px;
  height: 6px;
  border-radius: var(--radius-full);
  background-color: var(--color-accent);
}

.jump-action {
  font-weight: var(--font-weight-medium);
  color: var(--color-accent);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 120ms ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
