<script setup>
// บริการเกี่ยวกับเงินของรายการเค้ก (ไม่บังคับ): ซ่อนเงิน / ดึงเงิน / ซ่อนของ · เงินพักไม่ใช่รายได้
import { computed } from 'vue'
import { db } from '../data/store'
import { CASH_KINDS, CASH_LABEL, cashSettingsOf, cashServiceOf } from '../lib/cashService'
import { NOTE_VALUES, holdCountOf, holdAmountOf } from '../lib/holdMoney'
import { money } from '../lib/format'
import AppIcon from './AppIcon.vue'

const props = defineProps({
  modelValue: { type: Object, default: undefined }, // { kind, notes? } หรือ undefined = ไม่ใช้บริการ
  customerFacing: { type: Boolean, default: false }, // ใบเสนอในแชท → แสดงเฉพาะบริการที่เปิด "ให้ลูกค้าเห็น"
})
const emit = defineEmits(['update:modelValue'])

const settings = computed(() => cashSettingsOf(db.shop))
const kinds = computed(() => CASH_KINDS.filter((k) => settings.value.services[k].show && (!props.customerFacing || settings.value.services[k].customer)))
const err = computed(() => (props.modelValue ? (cashServiceOf(props.modelValue, db.shop, { customerFacing: props.customerFacing }).error || '') : ''))
const amount = computed(() => holdAmountOf(props.modelValue?.notes || {}))

function pick(kind) {
  if (props.modelValue?.kind === kind) return emit('update:modelValue', undefined)
  emit('update:modelValue', kind === 'stash' ? { kind } : { kind, notes: {} })
}
function setNote(v, n) {
  const notes = { ...(props.modelValue?.notes || {}), [v]: Math.max(0, Math.floor(Number(n) || 0)) }
  emit('update:modelValue', { ...props.modelValue, notes })
}
</script>

<template>
  <div v-if="kinds.length" class="space-y-3 rounded-2xl border border-stone-200 p-3.5">
    <div class="text-sm font-semibold text-stone-700"><AppIcon name="wallet" class="text-brand-600" /> บริการเกี่ยวกับเงิน <span class="font-normal text-stone-400">(ไม่บังคับ)</span></div>
    <div class="flex flex-wrap gap-1.5" role="radiogroup" aria-label="บริการเกี่ยวกับเงิน">
      <button v-for="k in kinds" :key="k" type="button" class="chip" :class="modelValue?.kind === k ? 'chip-on' : 'chip-off'" role="radio" :aria-checked="modelValue?.kind === k" @click="pick(k)">{{ CASH_LABEL[k] }} · ค่าบริการ {{ money(settings.services[k].fee) }}</button>
    </div>
    <template v-if="modelValue && modelValue.kind !== 'stash'">
      <div class="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <div v-for="v in NOTE_VALUES" :key="v" class="rounded-xl border border-stone-200 p-2 text-center">
          <div class="text-xs text-stone-500">{{ v }} บาท</div>
          <div class="mt-1 flex items-center justify-between gap-1">
            <button type="button" class="btn-outline h-8 w-8 px-0" :aria-label="`ลดธนบัตร ${v} บาท`" @click="setNote(v, (modelValue.notes?.[v] || 0) - 1)">−</button>
            <input type="number" min="0" inputmode="numeric" class="input h-8 w-12 px-1 text-center" :value="modelValue.notes?.[v] || 0" :aria-label="`จำนวนธนบัตร ${v} บาท`" @input="setNote(v, $event.target.value)" />
            <button type="button" class="btn-outline h-8 w-8 px-0" :aria-label="`เพิ่มธนบัตร ${v} บาท`" @click="setNote(v, (modelValue.notes?.[v] || 0) + 1)">+</button>
          </div>
        </div>
      </div>
      <p class="text-sm text-stone-600">เงินพัก <b class="text-stone-900">{{ money(amount) }}</b> · {{ holdCountOf(modelValue.notes) }} ใบ<span v-if="settings.maxNotes"> (สูงสุด {{ settings.maxNotes }} ใบ)</span> · ไม่นับเป็นรายได้</p>
    </template>
    <p v-if="modelValue" class="text-sm text-stone-600">ค่าบริการ{{ CASH_LABEL[modelValue.kind] }} <b class="text-stone-900">{{ money(settings.services[modelValue.kind].fee) }}</b> (เข้ารายได้)</p>
    <div v-if="modelValue" class="flex items-center justify-between gap-2">
      <p v-if="err" class="text-sm text-danger-700" role="alert">{{ err }}</p>
      <button type="button" class="btn-outline ml-auto h-9 px-3" @click="emit('update:modelValue', undefined)">ไม่ใช้บริการ</button>
    </div>
  </div>
</template>
