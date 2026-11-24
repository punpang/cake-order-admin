<script setup>
// ประวัติการทำรายการของออร์เดอร์ (ใช้ซ้ำทั้งคอลัมน์ซ้ายบนจอกว้างและท้ายหน้าบนจอเล็ก)
import { dateTime } from '../lib/format'
import { ROLES } from '../lib/constants'
defineProps({ history: { type: Array, default: () => [] } })
</script>

<template>
  <section class="card">
    <div class="card-title"><AppIcon name="history" class="text-brand-600" /> ประวัติ</div>
    <ol class="relative space-y-3 border-l-2 border-stone-100 pl-4">
      <li v-for="(h, i) in history.slice().reverse()" :key="i" class="relative">
        <span class="absolute top-1.5 -left-[21px] h-2.5 w-2.5 rounded-full ring-4 ring-white" :class="i === 0 ? 'bg-brand-500' : 'bg-stone-300'" />
        <div class="text-sm break-words text-stone-800">{{ h.text }}</div>
        <div class="text-xs text-stone-400">{{ dateTime(h.at) }} · {{ ROLES[h.by] ?? 'ระบบอัตโนมัติ' }}</div>
      </li>
    </ol>
  </section>
</template>
