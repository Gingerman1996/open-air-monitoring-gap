<template>
  <div class="app">
    <div class="aqi-strip" />
    <ClientOnly>
      <MapDashboard />
      <template #fallback>
        <div class="boot">Loading map…</div>
      </template>
    </ClientOnly>
  </div>
</template>

<style>
.boot {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100vh;
  font-family: var(--mono);
  color: var(--muted);
}
</style>
