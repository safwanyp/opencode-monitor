<script setup lang="ts">
const route = useRoute()
const sessionId = computed(() => String(route.params.id ?? ''))
</script>

<template>
  <AppEmptyState
    :title="`Session ${sessionId}`"
    :description="'The transcript will load from GET /api/session/{id}/message, followed by a live event tail filtered on this session.'"
  />
</template>
