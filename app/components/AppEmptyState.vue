<script setup lang="ts">
defineProps<{
  title: string
  description: string
}>()
</script>

<template>
  <div class="empty">
    <svg
      class="mark"
      width="26"
      height="26"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6.4" stroke="var(--color-border-strong)" stroke-width="1.2" />
      <circle cx="8" cy="8" r="2.1" fill="var(--color-border-strong)" />
    </svg>
    <h2 class="title">{{ title }}</h2>
    <p class="description">{{ description }}</p>
  </div>
</template>

<style scoped>
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  flex: 1;
  min-height: 0;
  padding: 40px;
  text-align: center;
}

.mark {
  margin-bottom: 2px;
}

.title {
  font-size: var(--text-md);
  font-weight: var(--font-weight-semibold);
  letter-spacing: -0.01em;
  line-height: var(--leading-snug);
  color: var(--color-text);
}

.description {
  max-width: 46ch;
  font-size: var(--text-sm);
  line-height: 19px;
  color: var(--color-text-muted);
}
</style>
