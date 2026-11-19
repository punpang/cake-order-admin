<script setup>
// ปุ่มลัดช่วงวันที่ (ใช้คู่กับช่องวันที่ ตั้งแต่–ถึง) · กดแล้วส่ง [from, to] ผ่าน @set
import { computed } from 'vue'
import { toDateStr } from '../lib/format'

const props = defineProps({
  from: { type: String, default: '' },
  to: { type: String, default: '' },
  presets: { type: Array, default: () => ['today', 'tomorrow', 'next7', 'month'] },
})
const emit = defineEmits(['set'])

const day = (n) => { const x = new Date(); x.setDate(x.getDate() + n); return toDateStr(x) }
const monthOf = () => { const x = new Date(); return [toDateStr(new Date(x.getFullYear(), x.getMonth(), 1)), toDateStr(new Date(x.getFullYear(), x.getMonth() + 1, 0))] }
const DEFS = {
  today: { l: 'วันนี้', r: () => [day(0), day(0)] },
  tomorrow: { l: 'พรุ่งนี้', r: () => [day(1), day(1)] },
  next7: { l: '7 วันข้างหน้า', r: () => [day(0), day(6)] },
  last7: { l: '7 วันที่ผ่านมา', r: () => [day(-6), day(0)] },
  month: { l: 'เดือนนี้', r: monthOf },
}
const list = computed(() => props.presets.filter((k) => DEFS[k]).map((k) => {
  const range = DEFS[k].r()
  return { k, l: DEFS[k].l, range, on: props.from === range[0] && props.to === range[1] }
}))
</script>

<template>
  <div class="flex flex-wrap gap-2" role="group" aria-label="ช่วงวันที่ลัด">
    <button v-for="p in list" :key="p.k" type="button" class="chip" :class="p.on ? 'chip-on' : 'chip-off'" :aria-pressed="p.on" @click="emit('set', p.range)">{{ p.l }}</button>
  </div>
</template>
