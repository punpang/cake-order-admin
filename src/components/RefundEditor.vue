<script setup>
import { computed } from 'vue'
import { db } from '../data/store'
import { REFUND_METHODS, refundErrors } from '../lib/refund'
import { money } from '../lib/format'
import AppIcon from './AppIcon.vue'

// เลือกช่องทางคืนเงินตอนยกเลิก: เงินสด / ธนาคาร (โอน) / คะแนนสะสม · แบ่งยอดหลายช่องทางได้ (รวมไม่เกินยอดที่ชำระแล้ว)
// v-model = [{ method, amount }] · canPoints = มีลูกค้าที่มีบัญชีสะสมคะแนน
const rows = defineModel({ type: Array, default: () => [] })
const props = defineProps({ paid: { type: Number, default: 0 }, canPoints: { type: Boolean, default: false }, defaultMethod: { type: String, default: 'cash' } })

const sum = computed(() => rows.value.reduce((s, x) => s + (Number(x.amount) || 0), 0))
const left = computed(() => Math.round((props.paid - sum.value) * 100) / 100)
const pv = computed(() => Number(db.loyalty.pointValue) || 1)
const err = computed(() => refundErrors(rows.value, { paid: props.paid, canPoints: props.canPoints, pointValue: pv.value }))
const usedByOther = (m, row) => rows.value.some((x) => x !== row && x.method === m)
const free = computed(() => Object.keys(REFUND_METHODS).filter((m) => (m !== 'points' || props.canPoints) && !rows.value.some((x) => x.method === m)))
const add = () => free.value.length && rows.value.push({ method: free.value[0], amount: left.value > 0 ? left.value : '' })
const full = () => (rows.value = props.paid > 0 ? [{ method: props.defaultMethod, amount: props.paid }] : [])
const pts = (x) => (x.method === 'points' && Number(x.amount) > 0 ? Math.round((Number(x.amount) / pv.value) * 100) / 100 : null)
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
          v-for="(l, m) in REFUND_METHODS"
          :key="m"
          type="button"
          class="chip"
          :class="[x.method === m ? 'chip-on' : 'chip-off', (m === 'points' && !canPoints) || usedByOther(m, x) ? 'opacity-40' : '']"
          :disabled="(m === 'points' && !canPoints) || usedByOther(m, x)"
          @click="x.method = m"
        >{{ l }}</button>
      </div>
      <div class="flex items-center gap-2">
        <input v-model.number="x.amount" type="text" v-num.dec class="input min-w-0 flex-1" placeholder="จำนวนเงิน (บาท)" :aria-label="`ยอดคืน ${REFUND_METHODS[x.method]}`" />
        <button type="button" class="btn-danger h-11 w-11 shrink-0 px-0" aria-label="ลบแถว" @click="rows.splice(i, 1)"><AppIcon name="trash" :size="16" /></button>
      </div>
      <p v-if="pts(x) != null" class="text-xs text-stone-500">= {{ pts(x) }} คะแนน (1 คะแนน = {{ money(pv) }}) อายุตามค่าตั้งต้น {{ db.loyalty.pointExpireDays }} วัน</p>
    </div>
    <button v-if="free.length && paid" type="button" class="btn-soft h-9 w-full" @click="add"><AppIcon name="plus" :size="16" /> เพิ่มช่องทาง</button>
    <div v-if="paid" class="flex justify-between text-sm" :class="left < 0 ? 'text-rose-600' : 'text-stone-500'">
      <span>รวมคืน {{ money(sum) }}</span><span>{{ left >= 0 ? `ไม่คืน ${money(left)}` : `เกิน ${money(-left)}` }}</span>
    </div>
    <p v-if="err" class="flex items-center gap-2 text-sm text-rose-600"><AppIcon name="alert" :size="16" /> {{ err }}</p>
    <p v-if="!canPoints && paid" class="text-xs text-stone-400">คืนเป็นคะแนนได้เมื่อออร์เดอร์ผูกกับลูกค้า</p>
  </div>
</template>
