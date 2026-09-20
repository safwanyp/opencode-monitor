<template>
  <NuxtLink to="/sessions" class="brand" aria-label="OpenCode Monitor home">
    <svg width="17" height="17" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6.4" stroke="var(--color-accent-dim)" stroke-width="1.4" />
      <circle cx="8" cy="8" r="2.1" fill="var(--color-accent)" />
    </svg>
    <span class="wordmark">
      <span class="wordmark-strong">OpenCode</span>
      <span class="wordmark-quiet">Monitor</span>
    </span>
  </NuxtLink>
</template>

<style scoped>
.brand {
  display: flex;
  align-items: center;
  gap: 9px;
  flex-shrink: 0;
  padding-right: 18px;
}

.wordmark {
  display: flex;
  align-items: baseline;
  gap: 5px;
  font-size: var(--text-base);
  line-height: var(--leading-snug);
  letter-spacing: -0.012em;
}

.wordmark-strong {
  font-weight: var(--font-weight-semibold);
  color: var(--color-text);
}

.wordmark-quiet {
  font-weight: var(--font-weight-regular);
  color: var(--color-text-muted);
}
</style>
