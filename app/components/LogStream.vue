<script setup lang="ts">
import type { LogRow } from '~/composables/useLogStream'

const props = defineProps<{
  rows: LogRow[]
  selectedSeq: number | null
  following: boolean
  unseen: number
}>()

const emit = defineEmits<{
  select: [row: LogRow]
  follow: []
}>()

/** Matches the row height in LogRow.vue and the Paper design. */
const ROW_HEIGHT = 32

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
  count: () => props.rows.length,
  rowHeight: ROW_HEIGHT,
})

const window = computed(() =>
  props.rows.slice(startIndex.value, endIndex.value),
)

// Auto-scroll only while following, and only if the user has not scrolled away.
// Scrolling up is how you read history, so it must not be fought.
function maybeFollow() {
  if (props.following && isAtBottom()) scrollToBottom()
}

watch(() => props.rows.length, () => nextTick(maybeFollow))

function onUserScroll() {
  onScroll()
  if (!props.following && isAtBottom()) emit('follow')
}
</script>

<template>
  <div class="wrap">
    <div
      ref="scroller"
      class="scroller"
      role="log"
      aria-label="Service log records"
      @scroll="onUserScroll"
    >
      <div class="sizer" :style="{ height: `${totalHeight}px` }">
        <div class="window" :style="{ transform: `translateY(${offsetY}px)` }">
          <LogRow
            v-for="row in window"
            :key="row.seq"
            :row="row"
            :selected="row.seq === selectedSeq"
            @select="emit('select', $event)"
          />
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

.scroller {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  contain: strict;
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
  box-shadow: 0 6px 20px rgb(0 0 0 / 45%);
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
