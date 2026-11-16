<script setup>
import { computed } from 'vue'
import { CHANNELS } from '../lib/constants'
import { formatPhone } from '../lib/format'
// เลือกช่องทางแจ้งเตือนรายช่อง (Facebook / SMS): ตามเดิม (สืบทอดระดับถัดไป) · เปิด · ปิด
// model = notifyChannels { facebook?, sms? } · แสดงเฉพาะช่องที่ลูกค้ามีข้อมูลติดต่อ · เปลี่ยนแล้ว emit('set', ช่อง, true|false|null)
const props = defineProps({ model: { type: Object, default: () => ({}) }, customer: { type: Object, default: null }, readonly: { type: Boolean, default: false } })
const emit = defineEmits(['set'])
const addr = (k) => (k === 'facebook' ? props.customer?.fbPsid : formatPhone(props.customer?.phone || '') || '')
const rows = computed(() => ['facebook', 'sms'].filter((k) => addr(k)).map((k) => ({ k, label: CHANNELS[k].label, v: typeof props.model?.[k] === 'boolean' ? props.model[k] : null })))
const OPTS = [[null, 'ตามเดิม'], [true, 'เปิด'], [false, 'ปิด']]
</script>

<template>
  <div v-if="rows.length" class="space-y-2" data-notify-picker>
    <div v-for="r in rows" :key="r.k" class="flex flex-wrap items-center justify-between gap-2">
      <span class="text-sm text-stone-700">{{ r.label }}</span>
      <div class="inline-flex overflow-hidden rounded-lg border border-stone-200 text-xs" role="group" :aria-label="`ช่องทาง ${r.label}`">
        <button v-for="[val, txt] in OPTS" :key="txt" type="button" :disabled="readonly" :data-ch="r.k" :data-val="String(val)"
          class="px-3 py-1.5 transition-colors" :class="r.v === val ? (val === false ? 'bg-rose-600 text-white' : val === true ? 'bg-emerald-600 text-white' : 'bg-stone-700 text-white') : 'bg-white text-stone-600 hover:bg-stone-50'"
          :aria-pressed="r.v === val" @click="emit('set', r.k, val)">{{ txt }}</button>
      </div>
    </div>
  </div>
  <p v-else class="text-xs text-stone-500">ลูกค้ายังไม่มีช่องทางติดต่อที่ผูกไว้</p>
</template>
