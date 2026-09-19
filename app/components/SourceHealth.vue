<script setup lang="ts">
import type { HealthResponse, SourceHealth } from '#shared/types/health'

defineProps<{ health: HealthResponse }>()

type Tone = 'ok' | 'warn' | 'error' | 'idle'

const TONES: Record<string, Tone> = {
  following: 'ok',
  connected: 'ok',
  paused: 'idle',
  reconnecting: 'warn',
  error: 'error',
  disconnected: 'error',
  unknown: 'idle',
}

const tone = (source: SourceHealth): Tone => TONES[source.status] ?? 'idle'

/** `unknown` reads as a placeholder rather than a status word. */
const label = (source: SourceHealth) =>
  source.status === 'unknown' ? '—' : source.status

const sources: Array<{ key: keyof HealthResponse; name: string }> = [
  { key: 'log', name: 'log' },
  { key: 'api', name: 'api' },
]
</script>

<template>
  <div class="health">
    <div
      v-for="source in sources"
      :key="source.key"
      class="pill"
      :class="`tone-${tone(health[source.key])}`"
      :title="health[source.key].detail"
    >
      <span class="dot" />
      <span class="name">{{ source.name }}</span>
      <span class="value">{{ label(health[source.key]) }}</span>
    </div>
  </div>
</template>

<style scoped>
.health {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.pill {
  display: flex;
  align-items: center;
  gap: 7px;
  height: 26px;
  padding: 0 10px;
  background-color: var(--color-raised);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
}

.dot {
  width: 6px;
  height: 6px;
  flex-shrink: 0;
  border-radius: var(--radius-full);
  background-color: var(--color-text-faint);
}

.name,
.value {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  line-height: var(--leading-tight);
}

.name {
  color: var(--color-text-muted);
}

.value {
  color: var(--color-text-secondary);
}

.tone-ok .dot {
  background-color: var(--color-accent);
}

.tone-ok .value {
  color: var(--color-accent);
}

.tone-warn .dot {
  background-color: var(--color-warn);
}

.tone-warn .value {
  color: var(--color-warn);
}

.tone-error .dot {
  background-color: var(--color-error);
}

.tone-error .value {
  color: var(--color-error);
}

.tone-idle .dot {
  background-color: var(--color-text-faint);
}

.tone-idle .value {
  color: var(--color-text-muted);
}
</style>
