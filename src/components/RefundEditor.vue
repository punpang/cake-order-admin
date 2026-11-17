<script setup>
import MoneyInput from './MoneyInput.vue'
import { computed } from 'vue'
import { REFUND_METHODS, REFUND_CHOICES, refundErrors } from '../lib/refund'
import { money } from '../lib/format'
import AppIcon from './AppIcon.vue'

// เลือกช่องทางคืนเงินตอนยกเลิก/คืนบางส่วน: เงินสด / ธนาคาร (โอน) / คูปองคืนเงิน · แบ่งยอดหลายช่องทางได้ (รวมไม่เกินยอดที่ชำระแล้ว)
// v-model = [{ method, amount }] · canCredit = ออร์เดอร์ผูกกับลูกค้า จึงออกคูปองคืนเงินได้
const rows = defineModel({ type: Array, default: () => [] })
const props = defineProps({ paid: { type: Number, default: 0 }, canCredit: { type: Boolean, default: false }, defaultMethod: { type: String, default: 'cash' } })

const sum = computed(() => rows.value.reduce((s, x) => s + (Number(x.amount) || 0), 0))
const left = computed(() => Math.round((props.paid - sum.value) * 100) / 100)
const err = computed(() => refundErrors(rows.value, { paid: props.paid, canCredit: props.canCredit }))
const usedByOther = (m, row) => rows.value.some((x) => x !== row && x.method === m)
const free = computed(() => REFUND_CHOICES.filter((m) => (m !== 'credit' || props.canCredit) && !rows.value.some((x) => x.method === m)))
const add = () => free.value.length && rows.value.push({ method: free.value[0], amount: left.value > 0 ? left.value : '' })
const full = () => (rows.value = props.paid > 0 ? [{ method: props.defaultMethod, amount: props.paid }] : [])
</script>

<template>
  <div class="space-y-3">
    <div class="flex items-center justify-between rounded-xl bg-stone-50 p-3 text-sm text-stone-600">
      <span>ชำระแล้ว <b class="text-stone-900">{{ money(paid) }}</b></span>
      <button type="button" class="text-brand-700 underline" @click="full">คืนเต็มจำนวน</button>
    </div>
    <p v-if="!paid" class="text-sm text-stone-500">ยังไม่มียอดที่ยืนยันชำระ ไม่ต้องคืนเงิน</p>
    <div v-for="(x, i) in rows" :key="i" class="space-y-2 rounded-xl border border-stone-200 p-2.5">
      <div class="flex flex-wrap gap-1.5">
        <button
          v-for="m in REFUND_CHOICES"
          :key="m"
          type="button"
          class="chip"
          :class="[x.method === m ? 'chip-on' : 'chip-off', (m === 'credit' && !canCredit) || usedByOther(m, x) ? 'opacity-40' : '']"
          :disabled="(m === 'credit' && !canCredit) || usedByOther(m, x)"
          @click="x.method = m"
        >{{ REFUND_METHODS[m] }}</button>
      </div>
      <div class="flex items-center gap-2">
        <MoneyInput v-model.number="x.amount" class="input min-w-0 flex-1" placeholder="จำนวนเงิน (บาท)" :aria-label="`ยอดคืน ${REFUND_METHODS[x.method]}`" />
        <button type="button" class="btn-danger h-11 w-11 shrink-0 px-0" aria-label="ลบแถว" @click="rows.splice(i, 1)"><AppIcon name="trash" :size="16" /></button>
      </div>
      <p v-if="x.method === 'credit' && Number(x.amount) > 0" class="text-xs text-stone-500">ออกเป็นคูปองยอด {{ money(Number(x.amount)) }} ไม่มีวันหมดอายุ ใช้ได้หลายครั้งจนหมดยอด</p>
    </div>
    <button v-if="free.length && paid" type="button" class="btn-soft h-9 w-full" @click="add"><AppIcon name="plus" :size="16" /> เพิ่มช่องทาง</button>
    <div v-if="paid" class="flex justify-between text-sm" :class="left < 0 ? 'text-rose-700' : 'text-stone-500'">
      <span>รวมคืน {{ money(sum) }}</span><span>{{ left >= 0 ? `ไม่คืน ${money(left)}` : `เกิน ${money(-left)}` }}</span>
    </div>
    <p v-if="err" class="flex items-center gap-2 text-sm text-rose-700"><AppIcon name="alert" :size="16" /> {{ err }}</p>
    <p v-if="!canCredit && paid" class="text-xs text-stone-400">คืนเป็นคูปองได้เมื่อออร์เดอร์ผูกกับลูกค้า</p>
  </div>
</template>
