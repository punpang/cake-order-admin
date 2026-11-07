<script setup>
import { toasts, dismissToast } from '../lib/toast'
import AppIcon from './AppIcon.vue'
</script>

<template>
  <!-- region ต้องมีในหน้าเสมอ ข้อความที่เพิ่มเข้ามาจึงถูกประกาศ -->
  <div class="pointer-events-none fixed top-16 right-3 left-3 z-[65] flex flex-col items-end gap-2 sm:left-auto sm:w-96" role="status" aria-live="polite">
    <div v-for="t in toasts" :key="t.id" data-toast class="pointer-events-auto flex w-full items-start gap-2 rounded-2xl bg-stone-900 px-4 py-3 text-sm text-white shadow-xl">
      <AppIcon name="check" :size="18" class="mt-0.5 shrink-0 text-matcha" />
      <span class="min-w-0 flex-1 break-words">{{ t.text }}</span>
      <button type="button" class="shrink-0 rounded-md px-1 text-stone-300 hover:text-white" aria-label="ปิดข้อความ" @click="dismissToast(t.id)"><AppIcon name="x" :size="16" /></button>
    </div>
  </div>
</template>
