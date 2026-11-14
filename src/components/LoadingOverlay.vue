<script setup>
import { loadingState } from '../lib/loading'
</script>

<template>
  <Teleport to="body">
    <div v-if="loadingState.show" class="loading-overlay" role="status" aria-live="polite" aria-busy="true">
      <div class="loading-card">
        <span class="loading-spinner" aria-hidden="true"></span>
        <span>กำลังโหลดข้อมูล…</span>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.loading-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(250, 246, 240, 0.85);
  cursor: progress;
  animation: loading-fade 0.15s ease-out;
}
.loading-card {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.9rem 1.25rem;
  border-radius: 1rem;
  background: #fff;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.12);
  color: #44403c;
  font-size: 0.9rem;
  font-weight: 600;
}
.loading-spinner {
  width: 1.25rem;
  height: 1.25rem;
  border-radius: 9999px;
  border: 3px solid #f6d3dc;
  border-top-color: #c0405f;
  animation: loading-spin 0.8s linear infinite;
}
@keyframes loading-spin {
  to { transform: rotate(360deg); }
}
@keyframes loading-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .loading-spinner { animation-duration: 2.4s; }
}
</style>
