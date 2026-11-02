<script setup>
import { ref } from 'vue'
import { money } from '../lib/format'

// ราคาเต็ม (ขีดฆ่า) + ราคาที่ลดแล้ว + รายละเอียดส่วนลด (กดเปิด/ปิด)
const props = defineProps({
  full: { type: Number, required: true },
  final: { type: Number, required: true },
  lines: { type: Array, default: () => [] }, // [{ label, amount }]
  size: { type: String, default: 'base' }, // base | lg
  align: { type: String, default: 'right' }, // right | left
})
const open = ref(false)
const saved = () => props.full - props.final
</script>

<template>
  <div class="leading-tight" :class="align === 'right' ? 'text-right' : 'text-left'">
    <template v-if="saved() !== 0 || lines.length">
      <div class="text-xs text-stone-400 line-through">{{ money(full) }}</div>
      <div class="font-semibold text-rose-600" :class="size === 'lg' ? 'text-lg' : ''">{{ money(final) }}</div>
      <button type="button" class="mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:underline" :aria-expanded="open" @click.stop="open = !open">
        ลด {{ money(saved()) }} <span aria-hidden="true">{{ open ? '▴' : '▾' }}</span>
      </button>
      <ul v-if="open" class="mt-1 space-y-0.5 text-xs text-stone-600">
        <li v-for="l in lines" :key="l.label" class="flex justify-between gap-3" :class="align === 'right' ? 'ml-auto max-w-64' : 'max-w-64'">
          <span class="min-w-0 break-words text-left">{{ l.label }}</span>
          <span class="shrink-0">{{ l.amount >= 0 ? '−' : '+' }}{{ money(Math.abs(l.amount)) }}</span>
        </li>
      </ul>
    </template>
    <div v-else class="font-semibold text-stone-900" :class="size === 'lg' ? 'text-lg' : ''">{{ money(final) }}</div>
  </div>
</template>
