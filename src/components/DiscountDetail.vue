<script setup>
import { ref } from 'vue'
import { money } from '../lib/format'

// ราคาที่ลดแล้ว (เด่น) + "เต็ม x" ขีดฆ่า + ป้าย "ลด x ▾" กดดูรายละเอียดส่วนลด (กดซ้ำซ่อน)
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
    <div class="font-semibold text-stone-900" :class="size === 'lg' ? 'text-lg' : 'text-base'">{{ money(final) }}</div>
    <template v-if="saved() !== 0 || lines.length">
      <div class="mt-1 flex flex-wrap items-center gap-1.5" :class="align === 'right' ? 'justify-end' : ''">
        <span class="text-xs text-stone-400">เต็ม <span class="line-through">{{ money(full) }}</span></span>
        <button
          type="button"
          class="tap inline-flex items-center gap-0.5 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
          :aria-expanded="open"
          @click.stop="open = !open"
        >
          ลด {{ money(saved()) }} <span aria-hidden="true">{{ open ? '▴' : '▾' }}</span>
        </button>
      </div>
      <ul v-if="open" class="mt-1.5 space-y-0.5 text-xs text-stone-600">
        <li v-for="l in lines" :key="l.label" class="flex justify-between gap-3" :class="align === 'right' ? 'ml-auto max-w-64' : 'max-w-64'">
          <span class="min-w-0 break-words text-left">{{ l.label }}</span>
          <span class="shrink-0">{{ l.amount >= 0 ? '−' : '+' }}{{ money(Math.abs(l.amount)) }}</span>
        </li>
      </ul>
    </template>
  </div>
</template>
