<script setup>
import { computed } from 'vue'
import { pickerRows } from '../lib/notifyPicker'
// เลือกช่องทางแจ้งเตือนรายช่อง (เว็บ/แอป · Facebook · SMS): ตามเดิม (สืบทอดระดับถัดไป) · เปิด · ปิด
// model = notifyChannels { web?, facebook?, sms? } · เว็บ/แอปแสดงเสมอเมื่อมีลูกค้า · Facebook/SMS แสดงเฉพาะเมื่อลูกค้ามีข้อมูลติดต่อ · เปลี่ยนแล้ว emit('set', ช่อง, true|false|null)
const props = defineProps({ model: { type: Object, default: () => ({}) }, customer: { type: Object, default: null }, readonly: { type: Boolean, default: false } })
const emit = defineEmits(['set'])
const rows = computed(() => pickerRows(props.model, props.customer))
const OPTS = [[null, 'ตามเดิม'], [true, 'เปิด'], [false, 'ปิด']]
</script>

<template>
  <div v-if="rows.length" class="space-y-2" data-notify-picker>
    <div v-for="r in rows" :key="r.k" class="flex flex-wrap items-center justify-between gap-2">
      <span class="text-sm text-stone-700">{{ r.label }}<span v-if="r.hint" class="block text-xs text-stone-500">{{ r.hint }}</span></span>
      <div class="inline-flex overflow-hidden rounded-lg border border-stone-200 text-xs" role="group" :aria-label="`ช่องทาง ${r.label}`">
        <button v-for="[val, txt] in OPTS" :key="txt" type="button" :disabled="readonly" :data-ch="r.k" :data-val="String(val)"
          class="px-3 py-1.5 transition-colors" :class="r.v === val ? (val === false ? 'bg-rose-600 text-white' : val === true ? 'bg-emerald-600 text-white' : 'bg-stone-700 text-white') : 'bg-white text-stone-600 hover:bg-stone-50'"
          :aria-pressed="r.v === val" @click="emit('set', r.k, val)">{{ txt }}</button>
      </div>
    </div>
  </div>
  <p v-else class="text-xs text-stone-500">ยังไม่มีลูกค้าที่ผูกไว้ จึงตั้งช่องทางแจ้งเตือนไม่ได้</p>
</template>
