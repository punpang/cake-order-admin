<script setup>
import CakeArt from './art/CakeArt.vue'

// รูปเค้ก (ไม่มีรูป = ภาพวาดเค้กตามชื่อสินค้า) · เติมเต็มกรอบแม่ ตั้งสัดส่วนที่กรอบแม่
defineProps({ src: { type: String, default: '' }, alt: { type: String, default: '' } })
</script>

<template>
  <img v-if="src" :src="src" :alt="alt" loading="lazy" class="h-full w-full object-cover" />
  <div v-else class="h-full w-full" role="img" :aria-label="alt || 'ยังไม่มีรูป'">
    <CakeArt :name="alt" />
  </div>
</template>
