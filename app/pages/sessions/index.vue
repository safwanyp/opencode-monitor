<script setup lang="ts">
import type { SessionSummary } from '#shared/types/events'
import type { ContextSummary } from '#shared/types/contexts'
import {
  billableTokens,
  formatCost,
  formatCount,
  formatRelative,
  formatTokens,
} from '#shared/utils/format'
import {
  buildSessionTree,
  filterSessionTree,
  flattenSessionTree,
  sortSessionTree,
} from '~/composables/useSessionTree'
import type { SessionSortKey } from '~/composables/useSessionSort'
import type { FlatSessionRow } from '~/composables/useSessionTree'
import { useContexts, modelMismatch } from '~/composables/useContexts'

const { sessions, error, loading, truncated, reload } = useSessions()
const { liveSessions, connection } = useEventStream()
const { key: sortKey, direction: sortDirection, toggle: toggleSort } = useSessionSort()

/**
 * Which parents are open. Persisted in `useState` so a round trip into a session
 * and back does not collapse everything the user just opened.
 */
const expanded = useState<string[]>('session-expanded', () => [])

const { contexts, forDirectory } = useContexts()

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
const directory = ref<string>('any')

/**
 * Which configuration context to show. A filter, not a mode: it narrows the same
 * list rather than replacing it.
 */
const contextFilter = ref<string>('any')

/** The list is machine-wide, so the directory is the filter that narrows it. */
const directories = computed(() => {
  const counts = new Map<string, number>()
  for (const session of sessions.value) {
    const key = session.directory ?? '(unknown)'
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
})

/** Sessions per context, so the facet can show its weight. */
const contextCounts = computed(() => {
  const counts = new Map<string, number>()
  for (const session of sessions.value) {
    const context = forDirectory(session.directory)
    if (context) counts.set(context.id, (counts.get(context.id) ?? 0) + 1)
  }
  return counts
})

const selectedContext = computed<ContextSummary | null>(
  () => contexts.value.find((c) => c.id === contextFilter.value) ?? null,
)

/**
 * Sessions that did not use the model their context declares.
 *
 * Not a verdict: it can be config drift over time, or a model chosen for one
 * invocation. The wording on the row says so, because the data cannot tell the
 * two apart.
 */
const mismatches = computed(() => {
  const map = new Map<string, ReturnType<typeof modelMismatch>>()
  for (const session of sessions.value) {
    const mismatch = modelMismatch(
      forDirectory(session.directory),
      session.agent,
      session.model,
    )
    if (mismatch) map.set(session.id, mismatch)
  }
  return map
})

function mismatchHint(sessionId: string): string {
  const mismatch = mismatches.value.get(sessionId)
  if (!mismatch) return ''
  return `Did not use the model ${mismatch.contextLabel} declares — expected ${mismatch.expected}, used ${mismatch.recorded}`
}

/** The last two path segments, since the leading ones are shared. */
function shortPath(path: string): string {
  const parts = path.split('/').filter(Boolean)
  return parts.length <= 2 ? path : `…/${parts.slice(-2).join('/')}`
}

const allOutcomes = computed(() => {
  const counts = new Map<string, number>()
  for (const session of sessions.value) {
    const key = session.outcome ?? 'unknown'
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])
})

const filterActive = computed(
  () =>
    search.value.trim() !== '' ||
    liveOnly.value ||
    outcomes.value.length > 0 ||
    directory.value !== 'any' ||
    contextFilter.value !== 'any',
)

/** Hoisted, since `matches` runs once per session on every pass over the list. */
const outcomeSet = computed(() => new Set(outcomes.value))

function matches(session: SessionSummary): boolean {
  if (liveOnly.value && !liveSessions.value.has(session.id)) return false

  if (directory.value !== 'any') {
    if ((session.directory ?? '(unknown)') !== directory.value) return false
  }

  if (contextFilter.value !== 'any') {
    if (forDirectory(session.directory)?.id !== contextFilter.value) return false
  }

  if (outcomeSet.value.size > 0 && !outcomeSet.value.has(session.outcome ?? 'unknown')) return false

  const query = search.value.trim().toLowerCase()
  if (query === '') return true

  return [
    session.title,
    session.directory ?? '',
    session.model?.id ?? '',
    session.agent ?? '',
    session.id,
  ]
    .join(' ')
    .toLowerCase()
    .includes(query)
}

/**
 * Tree, filtered, sorted, flattened.
 *
 * Order matters: filtering keeps ancestors of a match, and the flatten step
 * opens every surviving ancestor while a filter is active — both so a matched
 * subagent is never hidden behind a collapsed parent.
 */
const tree = computed(() =>
  sortSessionTree(
    filterSessionTree(buildSessionTree(sessions.value), matches),
    sortKey.value,
    sortDirection.value,
  ),
)

const rows = computed(() =>
  flattenSessionTree(tree.value, {
    expanded: new Set(expanded.value),
    liveSessions: liveSessions.value,
  }),
)

/**
 * Every parent in the current tree, at any depth.
 *
 * Walks the tree rather than the flattened rows: a row that is hidden under a
 * collapsed parent is not in `rows`, so scanning `rows` only ever expands one
 * level per click.
 */
function parentIds(): string[] {
  const ids: string[] = []
  const visit = (node: SessionNode) => {
    if (node.children.length > 0) ids.push(node.session.id)
    for (const child of node.children) visit(child)
  }
  for (const node of tree.value) visit(node)
  return ids
}

/**
 * Reveal what a search matched.
 *
 * A search hunts for something specific, so a match buried under a collapsed
 * parent would be invisible — the one thing a filter must not do. Expanding its
 * ancestors once, when the query changes, keeps that guarantee while leaving
 * every later collapse intact.
 *
 * Facet filters do not do this. They select a set rather than hunt for a
 * needle, so the tree stays as the user left it.
 */
watch(search, () => {
  if (search.value.trim() === '') return
  expanded.value = [...new Set([...expanded.value, ...parentIds()])]
})

/**
 * Flagged sessions per subtree.
 *
 * Computed once over the tree rather than per row, and rendered on a collapsed
 * parent so the flag is discoverable without expanding everything.
 */
const flaggedInSubtree = computed(() => {
  const map = new Map<string, number>()

  const visit = (node: SessionNode): number => {
    let total = 0
    for (const child of node.children) {
      if (mismatches.value.has(child.session.id)) total++
      total += visit(child)
    }
    map.set(node.session.id, total)
    return total
  }

  for (const node of tree.value) visit(node)
  return map
})

function flaggedHint(sessionId: string): string {
  const count = flaggedInSubtree.value.get(sessionId) ?? 0
  return `${count} session${count === 1 ? '' : 's'} below did not use the model this context declares`
}

/**
 * The sessions the current filters select, independent of how the tree draws
 * them.
 *
 * Deliberately not `rows`: the tree keeps non-matching ancestors so a matched
 * subagent is not orphaned, and every parent row shows a subtree total. Summing
 * rows would therefore count some sessions twice and others not at all. This
 * counts each selected session exactly once, which is what the header reports.
 */
const viewSessions = computed(() => sessions.value.filter(matches))

const roots = computed(
  () => viewSessions.value.filter((s) => s.parentID === undefined).length,
)
const subagentCount = computed(
  () => viewSessions.value.filter((s) => s.parentID !== undefined).length,
)

const totals = computed(() => {
  let cost = 0
  let tokens = 0
  for (const session of viewSessions.value) {
    cost += session.cost ?? 0
    tokens += billableTokens(session.tokens) ?? 0
  }
  return { cost, tokens }
})

/**
 * Live work in the current view.
 *
 * Unfiltered this is the raw count, so a session that has started but not yet
 * reached the list still lights up. Filtering by definition excludes sessions we
 * cannot attribute, so the intersection is the honest answer there.
 */
const activeNow = computed(() => {
  if (!filterActive.value) return liveSessions.value.size
  const ids = new Set(viewSessions.value.map((session) => session.id))
  let count = 0
  for (const id of liveSessions.value.keys()) if (ids.has(id)) count++
  return count
})

const expandableIds = computed(() =>
  rows.value.filter((r) => r.hasChildren).map((r) => r.node.session.id),
)

function isExpanded(id: string) {
  return expanded.value.includes(id)
}

function toggleExpand(id: string) {
  expanded.value = isExpanded(id)
    ? expanded.value.filter((value) => value !== id)
    : [...expanded.value, id]
}

function expandAll() {
  expanded.value = [...new Set([...expanded.value, ...parentIds()])]
}

function collapseAll() {
  expanded.value = []
}

function toggleOutcome(value: string) {
  outcomes.value = outcomes.value.includes(value)
    ? outcomes.value.filter((o) => o !== value)
    : [...outcomes.value, value]
}

/**
 * A parent row shows the whole subtree, so the tooltip has to say so — otherwise
 * the number silently differs in meaning between rows.
 */
function costHint(entry: FlatSessionRow): string {
  const own = entry.node.session.cost ?? 0
  if (!entry.hasChildren || entry.subtreeCost === own) return ''
  return `This session ${formatCost(own)} · subagents ${formatCost(entry.subtreeCost - own)}`
}

function tokenHint(entry: FlatSessionRow): string {
  const own = billableTokens(entry.node.session.tokens) ?? 0
  if (!entry.hasChildren || entry.subtreeTokens === own) return ''
  return `This session ${formatTokens(own)} · subagents ${formatTokens(entry.subtreeTokens - own)}`
}

const OUTCOME_TONE: Record<string, string> = {
  succeeded: 'ok',
  failed: 'error',
  interrupted: 'warn',
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
        {{ rows.length.toLocaleString('en-US') }} shown
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

      <button
        type="button"
        class="chip"
        :disabled="expandableIds.length === 0"
        @click="expandAll"
      >
        Expand all
      </button>
      <button
        type="button"
        class="chip"
        :disabled="expanded.length === 0"
        @click="collapseAll"
      >
        Collapse all
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
            :disabled="!filterActive"
            @click="outcomes = []; liveOnly = false; search = ''; directory = 'any'; contextFilter = 'any'"
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

        <section v-if="contexts.length > 1" class="group">
          <h2 class="group-title">Context</h2>
          <button
            type="button"
            class="facet-row"
            :class="{ 'is-off': contextFilter !== 'any' }"
            @click="contextFilter = 'any'"
          >
            <span class="facet-label">All contexts</span>
            <span class="facet-count mono">{{ formatCount(sessions.length) }}</span>
          </button>
          <button
            v-for="context in contexts"
            :key="context.id"
            type="button"
            class="facet-row"
            :class="{ 'is-off': contextFilter !== 'any' && contextFilter !== context.id }"
            :title="context.scopeDir ?? 'Sessions no project config governs'"
            @click="contextFilter = context.id"
          >
            <span class="facet-label">{{ context.label }}</span>
            <span class="facet-count mono">{{
              formatCount(contextCounts.get(context.id) ?? 0)
            }}</span>
          </button>

          <!-- The stack is the "why": which files merged, and in what order. -->
          <div v-if="selectedContext" class="stack">
            <div
              v-for="entry in selectedContext.stack"
              :key="entry.path"
              class="stack-row"
              :title="entry.path"
            >
              <span class="stack-kind mono">{{ entry.kind === 'global' ? 'global' : entry.kind }}</span>
              <span class="stack-path mono">{{ shortPath(entry.path) }}</span>
            </div>
            <p v-if="selectedContext.keys.length" class="stack-note">
              sets
              <span class="mono">{{ selectedContext.keys.join(', ') }}</span>
            </p>
            <p v-else-if="selectedContext.id === 'default'" class="stack-note">
              No project config applies — the baseline definitions are the whole
              answer here.
            </p>
          </div>
        </section>

        <section v-if="directories.length > 1" class="group">
          <h2 class="group-title">Directory</h2>
          <button
            type="button"
            class="facet-row"
            :class="{ 'is-off': directory !== 'any' }"
            @click="directory = 'any'"
          >
            <span class="facet-label">All projects</span>
            <span class="facet-count mono">{{ formatCount(sessions.length) }}</span>
          </button>
          <button
            v-for="[path, count] in directories"
            :key="path"
            type="button"
            class="facet-row"
            :class="{ 'is-off': directory !== 'any' && directory !== path }"
            :title="path"
            @click="directory = path"
          >
            <span class="facet-label">{{ shortPath(path) }}</span>
            <span class="facet-count mono">{{ formatCount(count) }}</span>
          </button>
        </section>

        <p class="note">
          Every session on this machine, across all projects — subagents nested
          under the session that spawned them.
          <template v-if="truncated">
            Showing the most recent {{ formatCount(sessions.length) }}; older
            sessions are not loaded.
          </template>
          <template v-else>
            {{ formatCount(sessions.length) }} loaded.
          </template>
          Live badges come from the event stream; the list is polled.
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
            <span class="stat-value mono">{{ formatCount(roots) }}</span>
            <span class="stat-label">Sessions</span>
          </div>
          <span class="vrule" />
          <div class="stat">
            <span class="stat-value mono">{{ formatCount(subagentCount) }}</span>
            <span class="stat-label">Subagents</span>
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
          <div class="col-link">
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
                  width="10" height="10" viewBox="0 0 16 16" fill="none"
                  stroke="currentColor" stroke-width="1.8" stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path :d="sortDirection === 'asc' ? 'M8 12.5 8 3.5M4 7 8 3l4 4' : 'M8 3.5 8 12.5M4 9l4 4 4-4'" />
                </svg>
              </button>
            </span>
          </div>
        </div>

        <div class="list">
          <p v-if="loading" class="message">Loading sessions…</p>

          <div v-else-if="error" class="message">
            <p class="message-title">Explorer B cannot reach the service</p>
            <p class="message-body">
              {{ error }} — Explorer A keeps working, because it reads the file log.
            </p>
          </div>

          <p v-else-if="rows.length === 0" class="message">
            <template v-if="sessions.length === 0">No sessions yet.</template>
            <template v-else>No sessions match these filters.</template>
          </p>

          <div
            v-for="entry in rows"
            v-else
            :key="entry.node.session.id"
            class="row"
            :class="{ 'is-child': entry.node.depth > 0 }"
          >
            <span
              v-if="entry.node.depth > 0"
              class="thread"
              :style="{ left: `calc(var(--lead) + var(--indent) * ${entry.node.depth - 1})` }"
            />

            <span class="cell marker">
              <button
                v-if="entry.hasChildren"
                type="button"
                class="toggle"
                :aria-expanded="entry.expanded"
                :title="entry.expanded ? 'Collapse subagents' : 'Expand subagents'"
                @click="toggleExpand(entry.node.session.id)"
              >
                <svg width="11" height="11" viewBox="0 0 16 16" fill="none"
                  :stroke="entry.expanded ? 'var(--color-accent)' : 'var(--color-text-muted)'"
                  stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <path :d="entry.expanded ? 'M3.5 6 8 10.5 12.5 6' : 'M6 3.5 10.5 8 6 12.5'" />
                </svg>
              </button>
              <span v-else class="toggle-spacer" />
              <span
                v-if="liveSessions.has(entry.node.session.id)"
                class="live-dot is-on"
                :title="`Active ${formatRelative(liveSessions.get(entry.node.session.id), now)} ago`"
              />
            </span>

            <NuxtLink
              :to="`/sessions/${entry.node.session.id}`"
              class="row-link"
              :style="{ paddingLeft: `calc(var(--indent) * ${entry.node.depth})` }"
            >
              <span class="cell title">
                <span class="title-text">{{ entry.node.session.title }}</span>
                <span
                  v-if="entry.hasChildren"
                  class="child-badge mono"
                  :title="`${entry.descendants} subagent${entry.descendants === 1 ? '' : 's'}`"
                >
                  {{ entry.descendants }}
                  <template v-if="entry.liveDescendants > 0">· {{ entry.liveDescendants }} live</template>
                </span>
                <span
                  v-if="(flaggedInSubtree.get(entry.node.session.id) ?? 0) > 0"
                  class="child-badge is-flagged mono"
                  :title="flaggedHint(entry.node.session.id)"
                >
                  {{ flaggedInSubtree.get(entry.node.session.id) }} flagged
                </span>
              </span>
              <span class="cell dir mono">{{ entry.node.session.directory ?? '—' }}</span>
              <span class="cell model mono">
                <span
                  v-if="mismatches.get(entry.node.session.id)"
                  class="mismatch"
                  :title="mismatchHint(entry.node.session.id)"
                />
                {{ entry.node.session.model?.id ?? '—' }}
              </span>
              <span class="cell agent">{{ entry.node.session.agent ?? '—' }}</span>
              <span
                class="cell cost mono"
                :class="{ 'is-subtree': entry.hasChildren }"
                :title="costHint(entry)"
              >{{
                entry.hasChildren
                  ? formatCost(entry.subtreeCost)
                  : formatCost(entry.node.session.cost)
              }}</span>
              <span
                class="cell tokens mono"
                :class="{ 'is-subtree': entry.hasChildren }"
                :title="tokenHint(entry)"
              >{{
                entry.hasChildren
                  ? formatTokens(entry.subtreeTokens)
                  : formatTokens(billableTokens(entry.node.session.tokens))
              }}</span>
              <span class="cell outcome">
                <span
                  class="outcome-chip"
                  :class="`tone-${OUTCOME_TONE[entry.node.session.outcome ?? ''] ?? 'neutral'}`"
                >
                  {{ entry.node.session.outcome ?? 'unknown' }}
                </span>
              </span>
              <span class="cell updated mono">{{
                formatRelative(entry.node.session.updated, now)
              }}</span>
            </NuxtLink>
          </div>
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
  max-width: 420px;
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

.chip:disabled {
  color: var(--color-text-faint);
  cursor: default;
}

.chip:not(:disabled):hover {
  border-color: var(--color-border-strong);
  color: var(--color-text);
}

.chip.is-on {
  background-color: var(--color-accent-bg);
  border-color: var(--color-accent-dim);
  color: var(--color-accent);
}

.live-dot {
  width: 6px;
  height: 6px;
  flex-shrink: 0;
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
  gap: 18px;
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

/* The header mirrors a row: a fixed marker lane, then the link's own lanes. */
.columns {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 12px;
  height: 30px;
  flex-shrink: 0;
  padding: 0 16px;
  border-bottom: 1px solid var(--color-border);
}

.col-link {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 12px;
  flex: 1;
  min-width: 0;
}

.col {
  flex-shrink: 0;
  font-size: var(--text-2xs);
  font-weight: var(--font-weight-semibold);
  letter-spacing: var(--tracking-caps);
  color: var(--color-text-muted);
}

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
  width: 26px;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
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
  /* The indent gutter begins after the row padding, the marker column and the
     gap between them; `--lead` lands the thread inside that gutter rather than
     on top of the chevron, which is what a bare 16px offset did. */
  --indent: 14px;
  --lead: calc(16px + 26px + 12px + 6px);
  position: relative;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 12px;
  height: 40px;
  padding: 0 16px;
  border-bottom: 1px solid var(--color-divider);
}

/* A vertical rule joins a child to the parent it hangs from. */
.thread {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background-color: var(--color-border);
}

.row:hover {
  background-color: var(--color-surface);
}

.toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}

.toggle-spacer {
  width: 14px;
  flex-shrink: 0;
}

.row-link {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 12px;
  flex: 1;
  min-width: 0;
}

.cell {
  flex-shrink: 0;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.cell.title {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
}

.title-text {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 13px;
  font-weight: var(--font-weight-medium);
  color: var(--color-text);
}

/* A collapsed parent still says how much sits under it. */
.child-badge {
  flex-shrink: 0;
  font-size: 10px;
  line-height: 15px;
  padding: 1px 6px;
  color: var(--color-text-muted);
  background-color: var(--color-raised);
  border-radius: var(--radius-xs);
}

.child-badge.is-flagged {
  background-color: var(--color-warn-bg);
  color: var(--color-warn);
}

.row.is-child .title-text {
  font-weight: var(--font-weight-regular);
  color: var(--color-text-secondary);
}

.row.is-child .cell.dir {
  color: var(--color-text-muted);
}

/* Sits in the model lane so the flagged value is the one you look at. A ring,
   not a filled dot: this is a question, not an error. */
.mismatch {
  display: inline-block;
  width: 5px;
  height: 5px;
  margin-right: 6px;
  border-radius: var(--radius-full);
  border: 1.5px solid var(--color-warn);
  box-sizing: border-box;
  vertical-align: middle;
}

.cell.model {
  display: flex;
  flex-direction: row;
  align-items: center;
}

.stack {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-top: 8px;
  padding: 8px 9px;
  background-color: var(--color-raised);
  border-radius: var(--radius-sm);
}

.stack-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
}

.stack-kind {
  flex-shrink: 0;
  width: 58px;
  font-size: 9.5px;
  line-height: 14px;
  color: var(--color-text-faint);
}

.stack-path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 10px;
  line-height: 14px;
  color: var(--color-text-secondary);
}

.stack-note {
  margin-top: 2px;
  font-size: 10px;
  line-height: 14px;
  color: var(--color-text-muted);
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

/* An aggregate across the subtree, not this row alone. Brighter, because it is
   the number that matters when the row is collapsed. */
.row .cell.cost.is-subtree {
  color: var(--color-text);
}

.row .cell.tokens {
  font-size: 11px;
  color: var(--color-text-muted);
}

.row .cell.tokens.is-subtree {
  color: var(--color-text-secondary);
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
