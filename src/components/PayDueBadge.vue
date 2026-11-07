<script setup>
import { computed } from 'vue'
import { orderDue } from '../lib/payDue'
import { dateTime } from '../lib/format'
import AppIcon from './AppIcon.vue'

// ป้ายกำหนดชำระ: รับ order (มี payments) หรือ due ({ dueAt, state, text }) ที่คำนวณมาแล้ว
const props = defineProps({ order: { type: Object, default: null }, due: { type: Object, default: null }, short: { type: Boolean, default: false } })
const d = computed(() => props.due || (props.order ? orderDue(props.order) : null))
</script>

<template>
  <span v-if="d" class="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap" :class="d.state === 'overdue' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-800'">
    <AppIcon name="alert" :size="12" />
    <template v-if="d.state === 'overdue'">เกินกำหนดชำระ</template>
    <template v-else>ชำระก่อน {{ short ? d.text.replace('เหลือ ', '') : dateTime(d.dueAt) }}</template>
  </span>
</template>
