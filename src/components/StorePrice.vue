<script setup>
import { money } from '../lib/format'

// ราคาที่ใช้ (เด่น) + ราคาปกติขีดฆ่าเมื่อมีราคาพิเศษ · from = ขึ้นต้นด้วย "เริ่มต้น"
defineProps({ price: { type: Number, required: true }, regular: { type: Number, default: 0 }, from: { type: Boolean, default: false } })
</script>

<template>
  <span class="inline-flex flex-wrap items-baseline gap-x-2">
    <span v-if="from" class="text-[11px] text-stone-600 sm:text-xs">เริ่มต้น</span>
    <b class="text-[15px] font-semibold text-stone-900 sm:text-lg">{{ money(price) }}</b>
    <span v-if="regular > price" class="text-xs text-stone-500 line-through sm:text-sm">{{ money(regular) }}</span>
  </span>
</template>
