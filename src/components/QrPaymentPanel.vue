<script setup>
// สร้าง QR ชำระจากออร์เดอร์ (ใช้ในหน้ารายละเอียดออร์เดอร์และหน้าเครื่องมือ QR)
// ทุกครั้งที่กดสร้าง = รายการแจ้งชำระใหม่ของออร์เดอร์นั้น · Ref 1 = รหัสร้านค้า · Ref 2 = รหัสอ้างอิงร้านค้า POS/ORD
import { computed, ref } from 'vue'
import { db, reportPayment } from '../data/store'
import { orderTotals } from '../lib/pricing'
import { shopRefOfCode } from '../lib/promptpay'
import { money } from '../lib/format'
import BillerQr from './BillerQr.vue'

const props = defineProps({
  order: { type: Object, required: true },
  defaultAmount: { type: String, default: '' },
})

const amt = ref(props.defaultAmount)
const err = ref('')
const made = ref(null) // { amount, ref1, ref2 } ของ QR ที่สร้างล่าสุด
const amount = computed(() => {
  const s = String(amt.value ?? '').replace(/,/g, '').trim()
  return s === '' ? null : Number(s)
})

function make() {
  err.value = ''
  const n = amount.value
  if (n == null || !Number.isFinite(n) || n <= 0) return (err.value = 'กรอกจำนวนเงินที่มากกว่า 0')
  const balance = orderTotals(props.order).balance
  if (n > balance + 0.004) return (err.value = `ยอดเกินคงค้าง (${money(balance)})`)
  const r = reportPayment(props.order, { amount: n, method: 'โอนเงิน', notify: false })
  if (r.error) return (err.value = r.error)
  made.value = { amount: n, ref1: db.shop.merchantCode, ref2: shopRefOfCode(props.order.code) }
}
</script>

<template>
  <div class="space-y-3">
    <div class="flex flex-wrap items-end gap-2">
      <div class="min-w-0 flex-1">
        <label class="label" for="qrp-amount">จำนวนเงิน (บาท)</label>
        <input id="qrp-amount" v-model="amt" type="text" inputmode="decimal" class="input" placeholder="เช่น 389" />
      </div>
      <button type="button" class="btn-primary" @click="make">สร้าง QR</button>
    </div>
    <p v-if="err" class="text-xs text-rose-700" role="alert">{{ err }}</p>
    <BillerQr v-if="made" :amount="made.amount" :ref1="made.ref1" :ref2="made.ref2" />
  </div>
</template>
