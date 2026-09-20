<script setup lang="ts">
const route = useRoute()

const links = [
  { to: '/sessions', label: 'Sessions' },
  { to: '/logs', label: 'Service Log' },
]

/**
 * Both destinations are prefixes of their own detail routes, so a prefix match
 * is the whole rule. `/logs` no longer needs the exact-match exception that `/`
 * did.
 */
function isActive(to: string) {
  return route.path.startsWith(to)
}
</script>

<template>
  <nav class="nav" aria-label="Explorers">
    <NuxtLink
      v-for="link in links"
      :key="link.to"
      :to="link.to"
      class="nav-item"
      :class="{ 'is-active': isActive(link.to) }"
      :aria-current="isActive(link.to) ? 'page' : undefined"
    >
      {{ link.label }}
    </NuxtLink>
  </nav>
</template>

<style scoped>
.nav {
  display: flex;
  align-items: stretch;
  align-self: stretch;
  padding-left: 6px;
  flex-shrink: 0;
}

.nav-item {
  display: flex;
  align-items: center;
  padding: 0 14px;
  font-size: var(--text-base);
  letter-spacing: -0.005em;
  color: var(--color-text-muted);
  border-bottom: 2px solid transparent;
  transition: color 120ms ease;
}

.nav-item:hover {
  color: var(--color-text-secondary);
}

.nav-item.is-active {
  color: var(--color-text);
  font-weight: var(--font-weight-medium);
  border-bottom-color: var(--color-accent);
}
</style>
