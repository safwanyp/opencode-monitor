<script setup lang="ts">
const { resolved, toggle } = useTheme()

/** The icon shows the theme you are in; the label says what the click does. */
const label = computed(() =>
  resolved.value === 'dark' ? 'Switch to light theme' : 'Switch to dark theme',
)
</script>

<template>
  <button
    type="button"
    class="theme-toggle"
    :title="label"
    :aria-label="label"
    @click="toggle"
  >
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path
        v-if="resolved === 'dark'"
        d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z"
      />
      <template v-else>
        <circle cx="12" cy="12" r="4.4" />
        <path
          d="M12 1.6v2M12 20.4v2M1.6 12h2M20.4 12h2M4.7 4.7l1.4 1.4M17.9 17.9l1.4 1.4M19.3 4.7l-1.4 1.4M6.1 17.9l-1.4 1.4"
        />
      </template>
    </svg>
  </button>
</template>

<style scoped>
/* Sized and rounded to sit with the health pills rather than beside them. */
.theme-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  flex-shrink: 0;
  color: var(--color-text-muted);
  background-color: var(--color-raised);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
  transition:
    color 120ms ease,
    border-color 120ms ease;
}

.theme-toggle:hover {
  color: var(--color-text);
  border-color: var(--color-border-strong);
}
</style>
