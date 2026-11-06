<script setup>
import AppIcon from './AppIcon.vue'

// รูปเค้ก (ไม่มีรูป = พื้นไล่สีเซจ + ไอคอนเค้ก)
defineProps({ src: { type: String, default: '' }, alt: { type: String, default: '' } })
</script>

<template>
  <img v-if="src" :src="src" :alt="alt" loading="lazy" class="h-full w-full object-cover" />
  <div v-else class="flex h-full w-full items-center justify-center bg-linear-to-br from-brand-100 to-brand-200 text-brand-500" role="img" :aria-label="alt || 'ยังไม่มีรูป'">
    <AppIcon name="cake" :size="44" />
  </div>
</template>
