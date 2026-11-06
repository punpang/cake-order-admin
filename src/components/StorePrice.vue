<script setup>
import { money } from '../lib/format'

// ราคาที่ใช้ (เด่น) + ราคาปกติขีดฆ่าเมื่อมีราคาพิเศษ · from = ขึ้นต้นด้วย "เริ่มต้น"
defineProps({ price: { type: Number, required: true }, regular: { type: Number, default: 0 }, from: { type: Boolean, default: false } })
</script>

<template>
  <span class="inline-flex flex-wrap items-baseline gap-x-2">
    <span v-if="from" class="text-xs text-stone-500">เริ่มต้น</span>
    <b class="text-lg font-semibold text-stone-900">{{ money(price) }}</b>
    <span v-if="regular > price" class="text-sm text-stone-400 line-through">{{ money(regular) }}</span>
  </span>
</template>
