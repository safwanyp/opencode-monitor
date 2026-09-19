<script setup lang="ts">
const health = useSourceHealth()
</script>

<template>
  <div class="shell">
    <header class="topbar">
      <AppBrand />
      <span class="rule" />
      <AppNav />
      <span class="spacer" />
      <SourceHealth :health="health" />
    </header>

    <div class="body">
      <slot />
    </div>

    <AppStatusBar :health="health" />
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  background-color: var(--color-bg);
}

.topbar {
  display: flex;
  align-items: stretch;
  height: var(--header-height);
  flex-shrink: 0;
  padding: 0 16px;
  background-color: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
}

.rule {
  width: 1px;
  flex-shrink: 0;
  background-color: var(--color-border);
}

.spacer {
  margin-left: auto;
}

.body {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
</style>
