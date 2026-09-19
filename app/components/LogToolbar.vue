<script setup lang="ts">
import type { TimeRangeOption } from '~/composables/useLogFilters'
import { TIME_RANGES } from '~/composables/useLogFilters'

const props = defineProps<{
  text: string
  rangeMs: number | null
  following: boolean
  mutedCount: number
  shown: number
  total: number
  connection: string
}>()

// Emit names avoid colons: a quoted key containing `:` trips the SFC compiler's
// type-literal parser ("Did not expect a type annotation here").
const emit = defineEmits<{
  search: [value: string]
  timeRange: [value: number | null]
  toggleFollow: []
  unmuteAll: []
}>()

const searchRef = ref<HTMLInputElement | null>(null)

const rangeLabel = computed(
  () =>
    TIME_RANGES.find((option) => option.ms === props.rangeMs)?.label ??
    'Whole buffer',
)

function onRangeChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  emit('timeRange', value === 'all' ? null : Number(value))
}

/** `/` focuses search, the way every terminal-adjacent tool behaves. */
function onKeydown(event: KeyboardEvent) {
  if (event.key === '/' && document.activeElement !== searchRef.value) {
    event.preventDefault()
    searchRef.value?.focus()
  }
  if (event.key === 'Escape' && document.activeElement === searchRef.value) {
    searchRef.value?.blur()
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="toolbar">
    <div class="search" :class="{ 'is-focused': false }">
      <svg
        width="13"
        height="13"
        viewBox="0 0 16 16"
        fill="none"
        stroke="var(--color-text-muted)"
        stroke-width="1.6"
        stroke-linecap="round"
      >
        <circle cx="7.2" cy="7.2" r="4.7" />
        <path d="M10.7 10.7 14 14" />
      </svg>
      <input
        ref="searchRef"
        class="search-input"
        type="text"
        :value="text"
        placeholder="Filter by message, field or span"
        spellcheck="false"
        autocomplete="off"
        @input="emit('search', ($event.target as HTMLInputElement).value)"
      />
      <button
        v-if="text"
        type="button"
        class="clear"
        aria-label="Clear search"
        @click="emit('search', '')"
      >
        <svg
          width="11"
          height="11"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
        >
          <path d="M4 4l8 8M12 4l-8 8" />
        </svg>
      </button>
      <kbd v-else class="kbd mono">/</kbd>
    </div>

    <span class="count mono">
      {{ shown.toLocaleString('en-US') }} of
      {{ total.toLocaleString('en-US') }}
    </span>

    <span v-if="connection !== 'live'" class="conn mono" :class="`conn-${connection}`">
      {{ connection }}
    </span>

    <span class="spacer" />

    <button
      v-if="mutedCount > 0"
      type="button"
      class="chip"
      title="Show all muted messages"
      @click="emit('unmuteAll')"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        stroke="var(--color-text-muted)"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M2 2l12 12" />
        <path d="M6.2 6.3A5.9 5.9 0 0 0 1.6 8s2.4 4 6.4 4a6.6 6.6 0 0 0 2.6-.5" />
        <path d="M9.4 4.4A6.3 6.3 0 0 1 14.4 8a11 11 0 0 1-1.9 2.2" />
      </svg>
      <span>{{ mutedCount }} muted</span>
    </button>

    <label class="range">
      <select class="range-select" :value="rangeMs ?? 'all'" @change="onRangeChange">
        <option v-for="option in TIME_RANGES" :key="option.label" :value="option.ms ?? 'all'">
          {{ option.label }}
        </option>
      </select>
      <span class="range-label">{{ rangeLabel }}</span>
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

    <button
      type="button"
      class="follow"
      :class="{ 'is-paused': !following }"
      @click="emit('toggleFollow')"
    >
      <span class="follow-dot" />
      <span>{{ following ? 'Following' : 'Paused' }}</span>
    </button>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 12px;
  height: 46px;
  flex-shrink: 0;
  padding: 0 16px;
  background-color: var(--color-bg);
  border-bottom: 1px solid var(--color-border);
}

.search {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 9px;
  height: 30px;
  padding: 0 8px 0 10px;
  background-color: var(--color-raised);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  flex: 1;
  min-width: 0;
  max-width: 460px;
}

.search:focus-within {
  border-color: var(--color-border-strong);
}

.search-input {
  flex: 1;
  min-width: 0;
  font-size: 12.5px;
  line-height: 18px;
  color: var(--color-text);
}

.search-input::placeholder {
  color: var(--color-text-muted);
}

.clear {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  color: var(--color-text-muted);
}

.clear:hover {
  color: var(--color-text);
}

.kbd {
  font-size: 10px;
  line-height: 15px;
  padding: 1px 6px;
  color: var(--color-text-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xs);
}

.count {
  font-size: 10.5px;
  line-height: 15px;
  color: var(--color-text-muted);
  white-space: nowrap;
}

.conn {
  font-size: 10.5px;
  line-height: 15px;
  white-space: nowrap;
  color: var(--color-text-muted);
}

.conn-reconnecting {
  color: var(--color-warn);
}

.conn-error {
  color: var(--color-error);
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
  padding: 0 11px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-size: 12px;
  line-height: 16px;
  color: var(--color-text-secondary);
  white-space: nowrap;
}

.chip:hover {
  border-color: var(--color-border-strong);
  color: var(--color-text);
}

.range {
  position: relative;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  height: 30px;
  padding: 0 9px 0 11px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  cursor: pointer;
}

/* The native control is kept for behaviour and accessibility, and hidden so the
   label can carry the design's typography. */
.range-select {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
  width: 100%;
}

.range-label {
  font-size: 12px;
  line-height: 16px;
  color: var(--color-text-secondary);
  white-space: nowrap;
}

.follow {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  height: 30px;
  padding: 0 12px;
  background-color: var(--color-accent-bg);
  border: 1px solid var(--color-accent-dim);
  border-radius: var(--radius-sm);
  font-size: 12px;
  font-weight: var(--font-weight-medium);
  line-height: 16px;
  color: var(--color-accent);
  white-space: nowrap;
}

.follow.is-paused {
  background-color: var(--color-raised);
  border-color: var(--color-border);
  color: var(--color-text-secondary);
}

.follow-dot {
  width: 6px;
  height: 6px;
  border-radius: var(--radius-full);
  background-color: var(--color-accent);
}

.follow.is-paused .follow-dot {
  background-color: var(--color-text-muted);
}
</style>
