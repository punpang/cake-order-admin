<script setup>
import { onBeforeUnmount, onMounted } from 'vue'
import AppIcon from './AppIcon.vue'

defineProps({ title: { type: String, default: '' }, wide: { type: Boolean, default: false } })
const emit = defineEmits(['close'])

// ล็อกการเลื่อนหน้าข้างหลังขณะเปิด
onMounted(() => document.body.classList.add('overflow-hidden'))
onBeforeUnmount(() => document.body.classList.remove('overflow-hidden'))
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50 flex items-end justify-center bg-stone-900/40 backdrop-blur-[2px] sm:items-center sm:p-6" @click.self="emit('close')">
      <div
        class="flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:max-h-[85dvh] sm:rounded-3xl"
        :class="wide ? 'sm:max-w-2xl' : 'sm:max-w-md'"
        role="dialog"
        aria-modal="true"
      >
        <div class="mx-auto mt-2 h-1.5 w-10 shrink-0 rounded-full bg-stone-200 sm:hidden" />
        <div class="flex shrink-0 items-center justify-between gap-2 px-5 pt-3 pb-2 sm:pt-5">
          <h2 class="min-w-0 truncate text-lg font-semibold text-stone-900">{{ title }}</h2>
          <button class="flex h-9 w-9 items-center justify-center rounded-full text-stone-500 hover:bg-stone-100" aria-label="ปิด" @click="emit('close')">
            <AppIcon name="x" :size="20" />
          </button>
        </div>
        <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-1 pb-5">
          <slot />
        </div>
        <div
          v-if="$slots.footer"
          class="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-stone-100 bg-white px-5 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] sm:pb-4"
        >
          <slot name="footer" />
        </div>
      </div>
    </div>
  </Teleport>
</template>
