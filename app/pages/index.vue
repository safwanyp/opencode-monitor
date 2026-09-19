<script setup lang="ts">
import type { LogRow } from '~/composables/useLogStream'

const stream = useLogStream()
const filters = useLogFilters(stream.rows)
const { facets } = useLogFacets()

const selected = ref<LogRow | null>(null)

/** Explorer A is operational data, so redaction defaults off and is reversible. */
const redaction = ref(false)

const shownRows = computed(() => filters.visible.value)

const mutedCount = computed(() => filters.muted.value.length)

const connection = computed(() => stream.connection.value)

/**
 * Drop a selection that has scrolled out of the client window, so the drawer
 * cannot show a record the list no longer contains.
 */
watch(
  () => stream.rows.value.length,
  () => {
    const current = selected.value
    if (!current) return
    const oldest = stream.rows.value[0]
    if (oldest && current.seq < oldest.seq) selected.value = null
  },
)

function filterByRun(run: string) {
  filters.run.value = run
}

function filterBySpan(span: number) {
  filters.span.value = String(span)
}

function muteMessage(message: string) {
  if (!filters.muted.value.includes(message)) filters.toggleMute(message)
}
</script>

<template>
  <div class="explorer">
    <LogToolbar
      :text="filters.text.value"
      :range-ms="filters.rangeMs.value"
      :following="stream.following.value"
      :muted-count="mutedCount"
      :shown="shownRows.length"
      :total="stream.rows.value.length"
      :connection="connection"
      @search="filters.text.value = $event"
      @time-range="filters.rangeMs.value = $event"
      @toggle-follow="stream.toggleFollow()"
      @unmute-all="filters.unmuteAll()"
    />

    <div class="body">
      <LogFacets
        :facets="facets"
        :levels="filters.levels.value"
        :role="filters.role.value"
        :run="filters.run.value"
        :muted="filters.muted.value"
        :filtered-out="filters.filteredOut.value"
        :active-filter-count="filters.activeFilterCount.value"
        @toggle-level="filters.toggleLevel($event)"
        @set-role="filters.role.value = $event"
        @set-run="filters.run.value = $event"
        @toggle-mute="filters.toggleMute($event)"
        @unmute-all="filters.unmuteAll()"
        @reset="filters.reset()"
      />

      <main class="stream">
        <LogStream
          v-if="shownRows.length > 0"
          :rows="shownRows"
          :selected-seq="selected?.seq ?? null"
          :following="stream.following.value"
          :unseen="stream.unseen.value"
          @select="selected = $event"
          @follow="stream.follow()"
          @pause="stream.pause()"
        />

        <div v-else class="empty">
          <p class="empty-title">
            {{
              stream.rows.value.length === 0
                ? 'No records yet'
                : 'Nothing matches these filters'
            }}
          </p>
          <p class="empty-body">
            {{
              stream.rows.value.length === 0
                ? connection === 'error'
                  ? stream.errorMessage.value ??
                    'The reader is not running. Explorer A reads the file log, so it works whether or not the OpenCode service is up.'
                  : 'Reading the log file…'
                : `${filters.filteredOut.value.toLocaleString('en-US')} records are filtered out. Reset the filters to see them.`
            }}
          </p>
          <button
            v-if="stream.rows.value.length > 0"
            type="button"
            class="empty-action"
            @click="filters.reset()"
          >
            Reset filters
          </button>
        </div>
      </main>

      <LogDetail
        :row="selected"
        :redaction="redaction"
        @toggle-redaction="redaction = !redaction"
        @close="selected = null"
        @filter-run="filterByRun"
        @filter-span="filterBySpan"
        @mute-message="muteMessage"
      />
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

.body {
  display: flex;
  flex-direction: row;
  align-items: stretch;
  flex: 1;
  min-height: 0;
}

.stream {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  flex: 1;
  padding: 40px;
  text-align: center;
}

.empty-title {
  font-size: 14px;
  font-weight: var(--font-weight-semibold);
  color: var(--color-text);
}

.empty-body {
  max-width: 52ch;
  font-size: 12.5px;
  line-height: 19px;
  color: var(--color-text-muted);
}

.empty-action {
  margin-top: 4px;
  height: 28px;
  padding: 0 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-size: 12px;
  color: var(--color-text-secondary);
}

.empty-action:hover {
  border-color: var(--color-border-strong);
  color: var(--color-text);
}
</style>
