<script setup lang="ts">
import type { HealthResponse } from '#shared/types/health'

const props = defineProps<{ health: HealthResponse }>()

/**
 * The app is loopback-only, so the origin shown here is always 127.0.0.1.
 * Read from `location` rather than build config so it stays truthful if the
 * port is overridden in .env.
 */
const origin = ref('127.0.0.1:4321')

onMounted(() => {
  origin.value = window.location.host
})

const logDetail = computed(() => props.health.log.detail ?? 'reader not started')
const apiDetail = computed(() => props.health.api.detail ?? 'no upstream yet')
</script>

<template>
  <footer class="statusbar">
    <div class="group">
      <span class="dot" :class="{ 'is-live': health.log.status === 'following' }" />
      <span class="value">{{ health.log.status }}</span>
      <span class="detail">{{ logDetail }}</span>
    </div>

    <span class="separator" />

    <div class="group">
      <span class="dot" :class="{ 'is-live': health.api.status === 'connected' }" />
      <span class="value">{{ health.api.status }}</span>
      <span class="detail">{{ apiDetail }}</span>
    </div>

    <div class="spacer" />

    <span class="detail mono">{{ origin }}</span>
    <span class="separator" />
    <span class="detail">read-only</span>
  </footer>
</template>

<style scoped>
.statusbar {
  display: flex;
  align-items: center;
  gap: 14px;
  height: var(--statusbar-height);
  flex-shrink: 0;
  padding: 0 16px;
  background-color: var(--color-surface);
  border-top: 1px solid var(--color-border);
}

.group {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-shrink: 0;
}

.dot {
  width: 5px;
  height: 5px;
  border-radius: var(--radius-full);
  background-color: var(--color-text-faint);
}

.dot.is-live {
  background-color: var(--color-accent);
}

.value {
  font-family: var(--font-mono);
  font-size: 10.5px;
  line-height: 15px;
  color: var(--color-text-secondary);
}

.detail {
  font-family: var(--font-mono);
  font-size: 10.5px;
  line-height: 15px;
  color: var(--color-text-muted);
}

.separator {
  width: 1px;
  height: 12px;
  flex-shrink: 0;
  background-color: var(--color-border);
}

.spacer {
  margin-left: auto;
}
</style>
