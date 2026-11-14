<script setup>
// รับชำระโอนหน้าร้านจากหน้าออร์เดอร์ · ทำงานเหมือน QR ของ POS: รอชำระ → ตรวจรายการถุงเงิน (ด้วยรหัสธุรกรรม) → ลูกค้าชำระแล้ว → รับชำระ
// พบรายการที่ตรง (รหัส + ยอด) → ยืนยันอัตโนมัติทันที เฉพาะชำระก่อนวันนัด − X วัน (ตั้งค่าร้าน) · หลังจากนั้นพนักงานยืนยันเอง · หมดอายุตามตั้งค่า POS · ปิดหน้าก่อนชำระ = ยกเลิก QR
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { db, reportPayment, confirmPayment, cancelPaymentRequest } from '../data/store'
import { orderTotals } from '../lib/pricing'
import { listTransfersByRef } from '../lib/maneeRemote'
import { quietly } from '../lib/loading'
import { money, dateTime } from '../lib/format'
import BillerQr from './BillerQr.vue'

const props = defineProps({
  order: { type: Object, required: true },
  amount: { type: Number, default: 0 },
})
const emit = defineEmits(['done'])

const pid = ref(null)
const qr = ref(null) // { amount, ref1, ref2, from, to }
const err = ref('')
const now = ref(Date.now())
const candidates = ref([])
const found = ref(null) // รายการที่พบรายการเดียว
const detectedAt = ref(0)
let timer = null
let tickCount = 0
let polling = false

const pay = computed(() => props.order.payments.find((x) => x.id === pid.value) || null)
const state = computed(() => {
  if (!pay.value) return 'idle'
  if (pay.value.status === 'confirmed') return 'confirmed'
  if (pay.value.status === 'cancelled') return 'cancelled'
  if (detectedAt.value) return 'detected'
  if (qr.value && now.value > new Date(qr.value.to).getTime()) return 'expired'
  return 'waiting'
})
const fmt = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
const left = computed(() => fmt(Math.max(0, Math.ceil((new Date(qr.value?.to || 0).getTime() - now.value) / 1000))))
// ยืนยันอัตโนมัติเฉพาะเมื่อยังไม่ถึงวันตัดรอบ = วันนัด (00:00) − X วัน · ไม่มีวันนัด = ให้พนักงานยืนยันเอง
const autoOk = computed(() => {
  if (!props.order?.pickupAt) return false
  const d = new Date(props.order.pickupAt)
  if (Number.isNaN(d.getTime())) return false
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - (Number(db.shop.orderAutoPayDaysBefore) || 0))
  return now.value < d.getTime()
})

function make() {
  err.value = ''
  const n = Math.round(Number(props.amount) * 100) / 100
  if (!(n > 0)) return (err.value = 'ยอดต้องมากกว่า 0')
  if (n > orderTotals(props.order).balance + 0.004) return (err.value = 'ยอดเกินยอดคงค้าง')
  if (pay.value?.status === 'reported') cancelPaymentRequest(props.order, pid.value, { reason: 'สร้าง QR ใหม่', notify: false, sms: false })
  const r = reportPayment(props.order, { amount: n, method: 'โอนเงิน', notify: false, sms: false })
  if (r.error) return (err.value = r.error)
  const mins = db.shop.posQrExpireMin || 10
  pid.value = r.paymentId
  qr.value = { amount: n, ref1: db.shop.merchantCode || '', ref2: r.qrRef, from: new Date().toISOString(), to: new Date(Date.now() + mins * 60000).toISOString() }
  detectedAt.value = 0
  found.value = null
  candidates.value = []
}

async function poll() {
  if (polling || !qr.value || state.value !== 'waiting') return
  polling = true
  try {
    const r = await listTransfersByRef({ ref: qr.value.ref2, amount: qr.value.amount })
    if (r.error) return
    candidates.value = r.rows
    if (r.rows.length === 1) { found.value = r.rows[0]; detectedAt.value = Date.now() }
  } finally { polling = false }
}

function accept(by, row = null) {
  err.value = ''
  const res = confirmPayment(props.order, pid.value, {
    amount: qr.value.amount,
    method: 'โอนเงิน',
    paidAt: (row || found.value)?.received_at || new Date().toISOString(),
    note: by === 'auto' ? 'รับอัตโนมัติ · ถุงเงิน' : 'พนักงานรับ · ถุงเงิน',
  })
  if (res?.error) return (err.value = res.error)
  emit('done')
}

function cancel() {
  cancelPaymentRequest(props.order, pid.value, { reason: 'ยกเลิก QR หน้าร้าน', notify: false, sms: false })
}

function tick() {
  now.value = Date.now()
  if (state.value === 'detected' && autoOk.value) return accept('auto')
  if (++tickCount % 5 === 0) quietly(poll)
}

onMounted(() => { timer = setInterval(tick, 1000) })
onBeforeUnmount(() => {
  clearInterval(timer)
  // ปิดหน้าก่อนลูกค้าชำระ = ยกเลิก QR ที่ยังค้าง (เหมือน POS)
  if (pay.value?.status === 'reported') cancelPaymentRequest(props.order, pid.value, { reason: 'ปิดหน้าชำระก่อนลูกค้าชำระ', notify: false, sms: false })
})
</script>

<template>
  <div class="space-y-3 rounded-2xl border border-stone-200 bg-white p-3">
    <p v-if="err" class="text-sm text-rose-700" role="alert">{{ err }}</p>

    <template v-if="state === 'idle' || state === 'cancelled'">
      <p v-if="state === 'cancelled'" class="text-center text-sm font-semibold text-stone-600">ยกเลิก QR แล้ว</p>
      <button type="button" class="btn-outline w-full" :disabled="!(amount > 0)" @click="make">สร้าง QR ยอด {{ money(amount) }}</button>
    </template>

    <template v-else-if="state === 'confirmed'">
      <p class="text-center font-semibold text-emerald-700">รับชำระแล้ว</p>
    </template>

    <template v-else>
      <div v-if="state === 'detected'" class="animate-pulse rounded-xl bg-emerald-600 p-3 text-center text-lg font-bold text-white">ลูกค้าชำระแล้ว · รับชำระ {{ money(qr.amount) }}</div>
      <BillerQr v-else :amount="qr.amount" :ref1="qr.ref1" :ref2="qr.ref2" />
      <p class="text-center text-sm" :class="state === 'expired' ? 'font-semibold text-rose-700' : 'text-stone-600'">
        <template v-if="state === 'expired'">QR หมดอายุแล้ว ต้องสร้างใหม่</template>
        <template v-else-if="state === 'detected'">{{ autoOk ? 'ระบบกำลังยืนยันออเดอร์อัตโนมัติ' : 'ชำระหลังกำหนดอัตโนมัติ · รอพนักงานยืนยัน' }}</template>
        <template v-else>สถานะ: รอลูกค้าชำระ · หมดอายุใน {{ left }}</template>
      </p>
      <div v-if="state === 'waiting' && candidates.length > 1" class="space-y-1.5">
        <p class="text-xs text-amber-700">พบรายการที่ตรงหลายรายการ เลือกรายการที่ใช่</p>
        <button v-for="c in candidates" :key="c.id" type="button" class="btn-outline w-full justify-between" @click="accept('staff', c)">
          <span>{{ dateTime(c.received_at) }}</span><span>เลือก</span>
        </button>
      </div>
      <div class="grid grid-cols-2 gap-2">
        <button v-if="state === 'expired'" type="button" class="btn-primary" @click="make">สร้าง QR ใหม่</button>
        <button v-else-if="state === 'detected'" type="button" class="btn-primary" @click="accept('staff')">รับชำระ</button>
        <button v-else type="button" class="btn-outline" @click="accept('staff')">ลูกค้าชำระแล้ว (ไม่พบอัตโนมัติ)</button>
        <button type="button" class="btn-outline" @click="cancel">ยกเลิก QR</button>
      </div>
    </template>
  </div>
</template>
