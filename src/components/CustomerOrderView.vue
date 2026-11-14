<script setup>
import { orderNo } from '../lib/format'
import { safeHref } from '../lib/safeUrl'
import { computed, reactive, ref, watch } from 'vue'
import { customerPay, customerReadSlip, customerRequestExtension, customerRequestPhotoOptOut, customerCancelPhotoOptOut, customerRequestQr } from '../data/store'
import { BANKS, PAY_MSG, bankByCode, checkCustomerTxn } from '../lib/payFields'
import { billerIdOf, promptPayBillerPayload, shopCodeOf, shopRefOfCode } from '../lib/promptpay'
import { visiblePayAccounts } from '../lib/payAccounts'
import { money, dateOnly, dateTime, formatPhone } from '../lib/format'
import { STATUS } from '../lib/constants'
import { LEGAL_KINDS } from '../lib/legalDefaults'
import { resizeImage, imageErrorMessage } from '../lib/imageResize'
import StatusBadge from './StatusBadge.vue'
import PayDueBadge from './PayDueBadge.vue'
import AppIcon from './AppIcon.vue'
import CustomerTaxInvoice from './CustomerTaxInvoice.vue'

// หน้าออร์เดอร์ของลูกค้า (ใช้ร่วมกันทั้งลิงก์ #/o/:token และหน้าบัญชีที่ล็อกอิน)
// order = มุมมองจาก customerOrderView/myOrder · ctx = { token } | { orderId } · emits: refresh (หลังทำรายการ) · review
const props = defineProps({ order: { type: Object, required: true }, ctx: { type: Object, required: true }, canReview: { type: Boolean, default: false } })
const emit = defineEmits(['refresh', 'review'])
const o = computed(() => props.order)

// ---------- แถบขั้นตอน ----------
const SHIP = computed(() => o.value.fulfillment === 'delivery')
const STEPS = computed(() => SHIP.value ? ['รอชำระ', 'ยืนยันแล้ว', 'กำลังเตรียม', 'เตรียมแล้ว', 'พร้อมจัดส่ง', 'กำลังจัดส่ง', 'ส่งมอบแล้ว'] : ['รอชำระ', 'ยืนยันแล้ว', 'กำลังเตรียม', 'พร้อมรับ', 'ส่งมอบแล้ว'])
const STEP_OF = computed(() => SHIP.value
  ? { draft: 0, awaiting_payment: 0, payment_reported: 0, payment_confirmed: 1, order_confirmed: 1, preparing: 2, prepared: 3, ready_to_ship: 4, shipping: 5, delivered: 6 }
  : { draft: 0, awaiting_payment: 0, payment_reported: 0, payment_confirmed: 1, order_confirmed: 1, preparing: 2, prepared: 3, delivered: 4 })
const step = computed(() => STEP_OF.value[o.value.status] ?? 0)
const cancelled = computed(() => o.value.status === 'cancelled')

// ---------- ชำระเงิน ----------
const info = computed(() => o.value.pay.info)
const accounts = computed(() => visiblePayAccounts(info.value)) // บัญชีที่ร้านเปิดให้แสดง
const billerId = computed(() => billerIdOf(info.value?.billerId)) // Biller ID (15 หลัก) จากร้าน · ใช้สร้าง QR แบบ Biller
const shopCode = computed(() => shopCodeOf(info.value?.merchantCode)) // รหัสร้านค้า (Ref 1) จากร้าน · ใช้สร้าง QR
const hasInfo = computed(() => !!(accounts.value.length || info.value.note))
const requests = computed(() => o.value.payments.filter((p) => p.status === 'reported' && p.shopRequested && !p.submitted))
const f = reactive({ mode: 'all', custom: '', paymentId: null, slip: '', slipName: '', note: '', error: '', ok: '', busy: false, txnDate: '', txnTime: '', bankCode: '', ref: '', qrNote: '', reading: false })
const open = ref(false)
const room = computed(() => o.value.pay.room)
// ยอดขั้นต่ำที่ลูกค้าระบุเองได้ (มัดจำขั้นต่ำ) · 0 = ไม่มี
const minimum = computed(() => Number(o.value.pay.minimum) || 0)
const belowMinimum = computed(() => minimum.value > 0 && f.mode === 'custom' && amount.value < minimum.value - 0.004)
const amount = computed(() => {
  if (f.mode === 'all') return room.value
  if (f.mode === 'req') return Math.min(requests.value.find((p) => p.id === f.paymentId)?.amount ?? 0, room.value)
  return Number(f.custom) || 0
})
function pick(mode, p = null) {
  f.mode = mode
  f.paymentId = p?.id || null
}
const qr = ref('')
// QR ของยอดที่ลูกค้าเลือก: กดสร้างก่อน → เซิร์ฟเวอร์สร้างรายการแจ้งชำระใหม่ (มีรหัสสุ่มของตัวเอง) · Ref 1 = รหัสร้านค้า · Ref 2 = POS/ORD + รหัสสุ่ม
const qrReq = reactive({ amount: 0, paymentId: '', qrRef: '', busy: false, error: '' })
const payload = computed(() => (qrReq.qrRef && billerId.value && shopCode.value && qrReq.amount > 0 ? promptPayBillerPayload(billerId.value, qrReq.amount, shopCode.value, qrReq.qrRef) : null))
function clearQr() { Object.assign(qrReq, { amount: 0, paymentId: '', qrRef: '', busy: false, error: '' }) }
// ยินยอมก่อนชำระ (ลูกค้ารายใหม่/เวอร์ชันใหม่): เซิร์ฟเวอร์ตอบรายการที่ต้องยินยอม → แสดงช่องติ๊ก ต้องติ๊กครบจึงส่งได้
const consentNeed = ref([])
const consentOk = reactive({ privacy: false, terms: false, cookie: false })
const consentAll = computed(() => consentNeed.value.every((k) => consentOk[k]))
function askConsent(kinds) { consentNeed.value = kinds; for (const k of kinds) consentOk[k] = false }
async function makeQr() {
  qrReq.error = ''
  if (!(amount.value > 0)) return (qrReq.error = 'เลือกยอดก่อนสร้าง QR')
  if (belowMinimum.value) return (qrReq.error = `ยอดต้องไม่น้อยกว่า ${money(minimum.value)}`)
  qrReq.busy = true
  const r = await customerRequestQr(props.ctx, amount.value, consentAll.value)
  qrReq.busy = false
  if (r.consentNeeded) return askConsent(r.consentNeeded)
  if (r.error) return (qrReq.error = r.error)
  consentNeed.value = []
  Object.assign(qrReq, { amount: r.amount, paymentId: r.paymentId, qrRef: r.qrRef })
  if (r.stale) staleNote.value = true
}
watch([amount, () => f.mode, () => f.paymentId], () => { if (qrReq.qrRef && qrReq.amount !== amount.value) clearQr() })
watch(
  [payload, open],
  async () => {
    qr.value = ''
    if (!open.value || !payload.value) return
    try {
      const QR = await import('qrcode')
      qr.value = await (QR.default || QR).toDataURL(payload.value, { margin: 1, width: 240, errorCorrectionLevel: 'M' })
    } catch {
      qr.value = ''
    }
  },
  { immediate: true },
)
const copied = ref('')
async function copy(text, key) {
  try {
    await navigator.clipboard.writeText(text)
    copied.value = key
    setTimeout(() => (copied.value = ''), 1500)
  } catch {
    copied.value = ''
  }
}
// วัน-เวลาปัจจุบันตามเวลาไทย (ค่าเริ่มต้นของฟอร์ม · ลูกค้าแก้ได้)
function thaiNow() {
  const d = new Date(Date.now() + 7 * 3600000)
  const p = (n) => String(n).padStart(2, '0')
  return { date: `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`, time: `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}` }
}
function openPay() {
  open.value = true
  const n = thaiNow()
  if (!f.txnDate) f.txnDate = n.date
  if (!f.txnTime) f.txnTime = n.time
  if (!f.note) f.note = o.value.code // เติมเลขออร์เดอร์ในหมายเหตุเป็นค่าจริง (เดิมเป็นแค่ placeholder)
}
// ตัวเลือกธนาคาร: รายการของระบบ + รหัสจาก QR ที่ไม่อยู่ในรายการ (ไม่ทิ้งค่าที่อ่านได้จากสลิป)
const bankOptions = computed(() => {
  const list = BANKS.map((b) => ({ code: b.code, name: b.name }))
  if (f.bankCode && !bankByCode(f.bankCode)) list.push({ code: f.bankCode, name: `รหัสธนาคาร ${f.bankCode} (จาก QR)` })
  return list
})
// อ่าน QR จากรูปสลิป → เติมธนาคาร/เลขอ้างอิง · ไม่มี QR หรืออ่านไม่ได้ → กรอกเองได้ (ไม่บล็อกการส่ง)
let readSeq = 0
async function readSlip(dataUrl) {
  const seq = ++readSeq
  f.reading = true
  f.qrNote = ''
  let r
  try { r = await customerReadSlip(props.ctx, dataUrl) } catch { r = { error: 'อ่านสลิปไม่สำเร็จ' } }
  if (seq !== readSeq) return // แนบรูปใหม่ระหว่างรอ → ใช้ผลของรูปล่าสุดเท่านั้น
  f.reading = false
  if (r.error) return (f.qrNote = 'อ่านสลิปอัตโนมัติไม่ได้ · ไม่ต้องกรอกธนาคารและเลขอ้างอิงก็ได้ ร้านจะตรวจจากสลิปให้')
  const q = r.qr || {}
  if (q.kind === 'promptpay') {
    Object.assign(f, { slip: '', slipName: '' })
    return (f.error = PAY_MSG.notSlip)
  }
  // เติมค่าจากสลิปเหมือนสลิปในแชท: QR → ธนาคาร/เลขอ้างอิง · ภาพ → ยอด/วัน-เวลา (ทับค่าที่ระบบเติมไว้ก่อน · ไม่เปลี่ยนยอดในรายการที่ร้านขอ)
  const fl = r.fields || null
  const got = []
  if (q.kind === 'slip') {
    f.bankCode = q.bankCode
    f.ref = q.ref
    got.push('ธนาคาร/เลขอ้างอิงจาก QR')
  }
  if (fl?.amount != null) {
    if (f.mode !== 'req' && fl.amount > 0 && fl.amount <= room.value + 0.004) { f.mode = 'custom'; f.custom = String(fl.amount) }
    got.push(`ยอด ${money(fl.amount)}`)
  }
  if (fl?.paidAt?.includes('T')) {
    const [d, t] = fl.paidAt.split('T')
    f.txnDate = d
    f.txnTime = t
    got.push(`วัน-เวลา ${d} ${t}`)
  }
  if (got.length) return (f.qrNote = `อ่านจากสลิปแล้ว: ${got.join(' · ')} · ตรวจอีกครั้งก่อนส่ง`)
  f.qrNote = 'ไม่พบ QR ในรูป · กรอกยอด วัน-เวลา ธนาคาร และเลขอ้างอิงเองได้ ร้านจะตรวจจากสลิปให้'
}
async function onSlip(e) {
  f.error = ''
  const file = e.target.files?.[0]
  if (!file) return
  try {
    const r = await resizeImage(file)
    f.slip = r.dataUrl
    f.slipName = file.name
    readSlip(r.dataUrl) // ไม่รอผล: ปุ่มส่งถูกปิดระหว่างอ่าน
  } catch (err) {
    f.error = imageErrorMessage(err)
  }
}
async function submit() {
  f.error = f.ok = ''
  if (!(amount.value > 0)) return (f.error = 'กรอกยอดที่โอน')
  if (belowMinimum.value) return (f.error = `ยอดต้องไม่น้อยกว่า ${money(minimum.value)}`)
  if (!f.slip) return (f.error = 'แนบสลิปก่อนกดส่ง')
  const chk = checkCustomerTxn({ txnDate: f.txnDate, txnTime: f.txnTime, bankCode: f.bankCode, ref: f.ref, createdAt: o.value.createdAt })
  if (chk.error) return (f.error = chk.error)
  f.busy = true
  const r = await customerPay(props.ctx, { amount: amount.value, slip: f.slip, note: f.note, paymentId: qrReq.paymentId && qrReq.amount === amount.value ? qrReq.paymentId : (f.mode === 'req' ? f.paymentId : null), txnDate: f.txnDate, txnTime: f.txnTime, bankCode: f.bankCode, ref: f.ref, consent: consentAll.value })
  f.busy = false
  if (r.consentNeeded) return askConsent(r.consentNeeded)
  if (r.error) return (f.error = r.error)
  consentNeed.value = []
  f.ok = r.autoConfirmed ? 'ร้านยืนยันการชำระแล้ว ขอบคุณค่ะ' : 'ส่งสลิปแล้ว ร้านจะตรวจสอบและยืนยันให้'
  if (r.stale) staleNote.value = true
  Object.assign(f, { slip: '', slipName: '', note: '', custom: '', mode: 'all', paymentId: null, txnDate: '', txnTime: '', bankCode: '', ref: '', qrNote: '' })
  clearQr()
  open.value = false
  emit('refresh')
}
const reload = () => window.location.reload()
const extNote = ref('')
const extMsg = ref('')
const extBusy = ref(false)
const staleNote = ref(false) // ทำรายการสำเร็จแล้ว แต่โหลดข้อมูลล่าสุดกลับมาไม่ได้
async function askExtension(p) {
  if (extBusy.value) return
  extMsg.value = ''
  extBusy.value = true
  const r = await customerRequestExtension(props.ctx, p.id, extNote.value)
  extBusy.value = false
  if (r.error) return (extMsg.value = r.error)
  if (r.stale) staleNote.value = true
  extNote.value = ''
  emit('refresh')
}
const overdue = computed(() => o.value.payments.filter((p) => p.status === 'reported' && p.due === 'overdue'))
const submitted = computed(() => o.value.payments.filter((p) => p.status === 'reported' && p.submitted))
const PAY_LABEL = (p) => (p.status === 'confirmed' ? ['ชำระแล้ว', 'bg-emerald-100 text-emerald-800'] : p.submitted ? ['รอร้านตรวจสอบสลิป', 'bg-sky-100 text-sky-800'] : p.due === 'overdue' ? ['เกินกำหนด', 'bg-rose-100 text-rose-700'] : ['รอชำระ', 'bg-amber-100 text-amber-800'])
// ---------- รูปงานเสร็จ + ขอไม่ให้ใช้รูปเผยแพร่ ----------
const photos = computed(() => o.value.items.flatMap((i) => (i.workPhotos || []).map((p) => ({ ...p, name: i.name }))))
const pc = reactive({ open: false, note: '', agree: false, error: '', ok: '', busy: false })
const big = ref('')
async function askOptOut() {
  if (pc.busy) return
  pc.error = ''
  if (!pc.agree) return (pc.error = 'ติ๊กยืนยันก่อนส่งคำขอ')
  pc.busy = true
  const r = await customerRequestPhotoOptOut(props.ctx, pc.note)
  pc.busy = false
  if (r.error) return (pc.error = r.error)
  if (r.stale) staleNote.value = true
  pc.open = false
  pc.note = ''
  pc.agree = false
  pc.ok = 'ส่งคำขอแล้ว ร้านจะตรวจสอบและลบรูปออกจากทุกที่ (ระหว่างนี้รูปจะไม่แสดงบนเว็บร้าน)'
  emit('refresh')
}
async function cancelOptOut() {
  if (pc.busy) return
  pc.busy = true
  const r = await customerCancelPhotoOptOut(props.ctx)
  pc.busy = false
  if (r.error) pc.error = r.error
  else { pc.ok = 'ยกเลิกคำขอแล้ว'; if (r.stale) staleNote.value = true; emit('refresh') }
}
const canPayUi = computed(() => !cancelled.value && o.value.status !== 'draft' && o.value.balance > 0)
// ราคาก่อนลด = ยอดรวมหลังลด + ส่วนลด (ถ้า VAT แยกนอก ส่วนลดต้องคูณ VAT ด้วย)
const beforeDiscount = computed(() => {
  const d = Number(o.value.discountTotal) || 0
  if (!d) return 0
  const k = o.value.vatMode === 'exclusive' ? 1 + (Number(o.value.vatRate) || 0) / 100 : 1
  return Math.round((Number(o.value.total) + d * k) * 100) / 100
})
</script>

<template>
  <div class="space-y-3 text-sm">
    <p v-if="staleNote" class="rounded-xl bg-amber-50 p-3 text-amber-800" role="status">ทำรายการสำเร็จแล้ว แต่ยังโหลดข้อมูลล่าสุดจากเซิร์ฟเวอร์ไม่ได้ ข้อมูลบนจออาจยังไม่อัปเดต <button type="button" class="ml-1 underline" @click="reload">โหลดหน้าใหม่</button></p>
    <!-- สรุป + ขั้นตอน -->
    <section class="card">
      <!-- ป้ายสถานะอยู่แถวบน เลขออร์เดอร์ได้ความกว้างเต็มการ์ด → ไม่ถูกตัดขึ้นบรรทัดใหม่บนมือถือ -->
      <div class="flex items-center justify-between gap-3">
        <div class="text-xs text-stone-600">ออร์เดอร์</div>
        <div class="flex flex-wrap items-center justify-end gap-1.5"><StatusBadge :status="o.status" /><PayDueBadge :due="o.payDue" /></div>
      </div>
      <h1 class="mt-0.5 text-[22px] whitespace-nowrap text-stone-900 min-[360px]:text-[26px]">{{ orderNo(o.code) }}</h1>
      <div v-if="o.customer" class="truncate text-stone-500">{{ o.customer.name }}<span v-if="o.customer.phone"> · {{ o.customer.phone.startsWith('xxx') ? o.customer.phone : formatPhone(o.customer.phone) }}</span></div>
      <ol v-if="!cancelled" class="mt-4 grid gap-1" :style="{ gridTemplateColumns: `repeat(${STEPS.length}, minmax(0, 1fr))` }" aria-label="ขั้นตอนออร์เดอร์">
        <li v-for="(label, i) in STEPS" :key="label" class="flex flex-col items-center gap-1 text-center" :aria-current="i === step ? 'step' : undefined">
          <span class="flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold" :class="i < step ? 'bg-matcha text-stone-900' : i === step ? 'bg-brand-600 text-white ring-4 ring-brand-100' : 'bg-stone-100 text-stone-500'">
            <AppIcon v-if="i < step" name="check" :size="14" /><template v-else>{{ i + 1 }}</template>
          </span>
          <span class="text-[11px] leading-tight" :class="i === step ? 'font-semibold text-stone-900' : 'text-stone-600'">{{ label }}</span>
        </li>
      </ol>
      <p v-else class="mt-3 rounded-xl bg-rose-50 p-3 text-rose-700">ออร์เดอร์นี้ถูกยกเลิกแล้ว · หากมีข้อสงสัยติดต่อร้านได้เลย</p>
    </section>

    <!-- แจ้งสถานะสำคัญ -->
    <section v-if="overdue.length" class="rounded-3xl border-2 border-rose-200 bg-rose-50 p-4 text-rose-800" role="alert">
      <div class="flex items-center gap-2 font-semibold"><AppIcon name="alert" :size="18" /> เกินกำหนดชำระ</div>
      <p class="mt-1">ยอด {{ money(overdue[0].amount) }} ต้องชำระก่อน {{ dateTime(overdue[0].dueAt) }} · ตอนนี้แจ้งชำระเองไม่ได้ หากต้องการเวลาเพิ่มกดขอขยายเวลา</p>
      <template v-for="p in overdue" :key="p.id">
        <p v-if="p.extension === 'pending'" class="mt-2 rounded-lg bg-white/70 p-2 text-sm">ส่งคำขอขยายเวลาแล้ว รอร้านตอบกลับ</p>
        <p v-else-if="p.extension === 'denied'" class="mt-2 rounded-lg bg-white/70 p-2 text-sm">ร้านไม่อนุมัติการขยายเวลา กรุณาติดต่อร้าน</p>
        <div v-else class="mt-2 space-y-2">
          <input v-model="extNote" class="input bg-white" maxlength="200" placeholder="เหตุผล (ไม่บังคับ)" aria-label="เหตุผลที่ขอขยายเวลา" />
          <button class="btn-primary w-full" :disabled="extBusy" @click="askExtension(p)"><span v-if="extBusy" class="brand-ring on-brand" aria-hidden="true"></span>{{ extBusy ? 'กำลังส่งคำขอ…' : 'ขอขยายเวลาชำระ' }}</button>
        </div>
      </template>
      <p v-if="extMsg" class="mt-2 text-sm text-rose-700">{{ extMsg }}</p>
    </section>
    <section v-if="submitted.length" class="rounded-3xl border-2 border-sky-200 bg-sky-50 p-4 text-sky-800">ส่งสลิป {{ money(submitted.reduce((s, p) => s + p.amount, 0)) }} แล้ว · รอร้านตรวจสอบและยืนยัน</section>
    <section v-if="o.payments.some((p) => p.status === 'confirmed')" class="rounded-3xl border-2 border-stone-200 bg-stone-50 p-4 text-sm text-stone-700" aria-label="หลังชำระเงิน">หลังชำระเงินแล้ว ร้านสงวนสิทธิ์ตรวจสอบรายละเอียดรายการสั่งซื้อ และลูกค้าได้ศึกษาข้อตกลง PDPA และอื่น ๆ แล้ว</section>
    <section v-if="o.unpaidApproved" class="rounded-3xl border-2 border-indigo-200 bg-indigo-50 p-4 text-indigo-800">ร้านยืนยันการสั่งซื้อแล้ว · ชำระยอดคงค้างได้ตอนรับสินค้า</section>
    <p v-if="f.ok" class="rounded-3xl bg-emerald-50 p-3 text-emerald-800" role="status">{{ f.ok }}</p>

    <!-- นัดรับ/ส่ง -->
    <section class="card flex items-start gap-3">
      <span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-brand-700"><AppIcon :name="o.fulfillment === 'delivery' ? 'truck' : 'store'" :size="20" /></span>
      <div class="min-w-0 flex-1">
        <div class="text-xs font-medium text-stone-500">นัด{{ o.fulfillment === 'delivery' ? 'จัดส่ง' : 'รับที่ร้าน' }}</div>
        <div class="mt-0.5 text-lg font-semibold leading-snug text-stone-900">{{ dateTime(o.pickupAt) }}</div>
        <div v-if="o.delivery" class="mt-2 space-y-0.5 rounded-xl bg-stone-50 p-3 text-stone-600">
          <div v-if="o.delivery.placeName" class="font-medium text-stone-800">{{ o.delivery.placeName }}</div>
          <div v-if="o.delivery.address" class="break-words">{{ o.delivery.address }}</div>
          <div v-if="o.delivery.detail" class="break-words text-stone-500">{{ o.delivery.detail }}</div>
          <div v-if="o.delivery.distanceKm != null" class="text-stone-500">ระยะทาง {{ o.delivery.distanceKm }} กม.</div>
          <a v-if="safeHref(o.delivery.mapUrl)" :href="safeHref(o.delivery.mapUrl)" target="_blank" rel="noopener noreferrer" class="mt-1 inline-flex items-center gap-1 font-medium text-brand-700 underline"><AppIcon name="pin" :size="14" /> เปิดแผนที่</a>
        </div>
        <div v-if="o.birthday" class="mt-2 text-stone-500">วันเกิด {{ o.birthday.name }}</div>
      </div>
    </section>

    <!-- รายการ -->
    <section class="card">
      <div class="mb-1 flex items-center justify-between text-xs font-medium text-stone-500"><span>รายการสินค้า</span><span>{{ o.items.length }} รายการ</span></div>
      <ul class="divide-y divide-stone-100">
        <li v-for="it in o.items" :key="it.id" class="min-w-0 py-3 first:pt-1 last:pb-0">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="font-semibold leading-snug break-words text-stone-900">{{ it.name }}</div>
              <div class="mt-0.5 text-xs text-stone-500">{{ it.qty }} × {{ money(it.unitPrice) }}</div>
            </div>
            <div class="shrink-0 font-semibold text-stone-900">{{ money(it.unitPrice * it.qty) }}</div>
          </div>
          <dl v-if="it.lines && it.lines.length" class="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-xl bg-stone-50 px-3 py-2 text-xs">
            <template v-for="(d, j) in it.lines" :key="j">
              <dt class="text-stone-500">{{ d.group }}</dt>
              <dd class="break-words text-stone-800">{{ d.value }}</dd>
            </template>
          </dl>
          <div v-if="it.note" class="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs break-words text-amber-900">หมายเหตุ: {{ it.note }}</div>
        </li>
      </ul>
    </section>

    <!-- รูปงานเสร็จ -->
    <section v-if="photos.length || o.photoConsent === 'revoked'" class="card space-y-3" aria-label="รูปงานของคุณ">
      <div class="flex items-center gap-2 text-[15px] font-semibold text-stone-900"><AppIcon name="image" class="text-brand-600" /> รูปงานของคุณ</div>
      <div v-if="photos.length" class="grid grid-cols-2 gap-2">
        <button v-for="p in photos" :key="p.id" type="button" class="overflow-hidden rounded-xl border border-stone-200 text-left" :aria-label="`ดูรูปใหญ่ ${p.name}`" @click="big = p.image"><img :src="p.image" :alt="`รูปงาน ${p.name}`" class="aspect-square w-full object-cover" /><span class="block truncate p-1.5 text-xs text-stone-500">{{ p.name }}</span></button>
      </div>
      <p v-else class="text-stone-500">ร้านลบรูปงานของออร์เดอร์นี้ตามที่คุณแจ้งแล้ว</p>
      <div class="rounded-xl bg-stone-50 p-3 text-xs text-stone-600" role="note" aria-label="การนำรูปไปใช้">
        <b class="text-stone-800">การนำรูปงานไปใช้:</b> ร้านอาจนำรูปงานนี้ไปใช้เป็นรูปตัวอย่างบนเว็บไซต์และโซเชียลของร้าน (ทุกช่องทาง) หากไม่ต้องการ แจ้งได้ ร้านจะตรวจสอบและลบรูปออกจากทุกที่ รวมถึงรูปในออร์เดอร์นี้
      </div>
      <p v-if="o.photoConsent === 'requested'" class="rounded-xl bg-amber-50 p-3 text-amber-800" role="status">ส่งคำขอไม่ให้ใช้รูปแล้ว รอร้านตรวจสอบ · ระหว่างนี้รูปจะไม่แสดงบนเว็บร้าน <button type="button" class="ml-1 underline" :disabled="pc.busy" @click="cancelOptOut">{{ pc.busy ? 'กำลังยกเลิก…' : 'ยกเลิกคำขอ' }}</button></p>
      <template v-else-if="o.photoConsent !== 'revoked' && photos.length">
        <button v-if="!pc.open" type="button" class="btn-outline w-full" @click="pc.open = true; pc.error = ''; pc.ok = ''">ไม่อนุญาตให้ใช้รูปเผยแพร่</button>
        <div v-else class="space-y-2 rounded-xl border border-stone-200 p-3">
          <label class="label" for="pc-note">หมายเหตุถึงร้าน (ไม่บังคับ)</label>
          <textarea id="pc-note" v-model="pc.note" rows="2" maxlength="300" class="input" aria-label="หมายเหตุขอไม่เผยแพร่รูป"></textarea>
          <label class="flex items-start gap-2 py-1.5 text-stone-700"><input v-model="pc.agree" type="checkbox" class="mt-0.5 h-5 w-5 shrink-0 accent-brand-600" aria-label="ยืนยันไม่ให้ใช้รูป" /> ยืนยันไม่ให้ร้านนำรูปงานของออร์เดอร์นี้ไปเผยแพร่ในทุกช่องทาง และให้ลบรูปทิ้ง (ร้านจะตรวจสอบก่อนลบ)</label>
          <p v-if="pc.error" class="text-rose-700" role="alert">{{ pc.error }}</p>
          <div class="flex gap-2"><button type="button" class="btn-outline flex-1" @click="pc.open = false">ยกเลิก</button><button type="button" class="btn-primary flex-1" :disabled="pc.busy" @click="askOptOut"><span v-if="pc.busy" class="brand-ring on-brand" aria-hidden="true"></span>{{ pc.busy ? 'กำลังส่ง…' : 'ส่งคำขอ' }}</button></div>
        </div>
      </template>
      <p v-if="pc.ok" class="text-emerald-700" role="status">{{ pc.ok }}</p>
      <div v-if="big" class="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/80 p-4" role="dialog" aria-modal="true" aria-label="รูปงาน" @click="big = ''"><img :src="big" alt="รูปงานขยาย" class="max-h-full max-w-full rounded-2xl" /></div>
    </section>

    <!-- ยอด -->
    <section class="card">
      <div v-if="o.discountTotal || (o.delivery && o.delivery.shippingFee)" class="space-y-1.5 text-stone-500">
        <div v-if="o.discountTotal" class="flex justify-between"><span>ราคาก่อนลด</span><span>{{ money(beforeDiscount) }}</span></div>
        <div v-if="o.discountTotal" class="flex justify-between"><span>ส่วนลดรวม</span><span class="text-rose-600">-{{ money(o.discountTotal) }}</span></div>
        <div v-if="o.delivery && o.delivery.shippingFee" class="flex justify-between"><span>ค่าจัดส่ง</span><span>{{ money(o.delivery.shippingFee) }}</span></div>
      </div>
      <div class="flex items-baseline justify-between gap-3" :class="{ 'mt-2 border-t border-dashed border-stone-200 pt-2': o.discountTotal || (o.delivery && o.delivery.shippingFee) }">
        <span class="font-medium text-stone-900">ยอดรวม</span><b class="text-xl text-stone-900">{{ money(o.total) }}</b>
      </div>
      <div v-if="o.vatMode" class="mt-0.5 flex justify-between text-xs text-stone-500"><span>{{ o.vatMode === 'exclusive' ? `รวม VAT ${o.vatRate}% (บวกเพิ่ม)` : `รวม VAT ${o.vatRate}% แล้ว` }}</span><span>{{ money(o.vat) }}</span></div>
      <div v-if="o.refunds?.length || o.returns?.length" class="mt-3 space-y-1.5 border-t border-stone-100 pt-3">
        <div v-for="(r, i) in o.refunds" :key="'rf' + i" class="flex justify-between gap-3 text-xs text-rose-700"><span class="min-w-0 break-words">คืนเงิน · {{ r.label }}<template v-if="r.points != null"> ({{ r.points }} คะแนน)</template></span><span class="shrink-0">{{ money(r.amount) }}</span></div>
        <template v-for="rt in o.returns || []" :key="rt.id"><div v-for="(r, i) in rt.items" :key="rt.id + i" class="flex justify-between gap-3 text-xs text-rose-700"><span class="min-w-0 break-words">คืนเงินบางส่วน · {{ r.label }}<template v-if="r.points != null"> ({{ r.points }} คะแนน)</template></span><span class="shrink-0">{{ money(r.amount) }}</span></div></template>
      </div>
      <div class="mt-3 flex justify-between border-t border-stone-100 pt-3 text-stone-600"><span>ชำระแล้ว</span><span>{{ money(o.paid) }}</span></div>
      <div v-if="!cancelled" class="mt-3 flex items-center justify-between gap-3 rounded-2xl px-4 py-3" :class="o.balance > 0 ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-800'">
        <span class="font-semibold">คงค้าง</span><b class="text-lg">{{ money(o.balance) }}</b>
      </div>
    </section>

    <!-- การชำระเงิน -->
    <section v-if="!cancelled && o.status !== 'draft'" class="card">
      <div class="mb-2 flex items-center gap-2 text-[15px] font-semibold text-stone-900"><AppIcon name="wallet" class="text-brand-600" /> การชำระเงิน</div>
      <ul v-if="o.payments.length" class="mb-3 space-y-2">
        <li v-for="p in o.payments" :key="p.id" class="flex items-start justify-between gap-2 rounded-xl border border-stone-200/70 p-3">
          <span class="min-w-0">
            <b class="text-stone-900">{{ money(p.amount) }}</b>
            <span class="block text-xs text-stone-500"><template v-if="p.status === 'confirmed'">{{ p.method }} · {{ dateOnly(p.paidAt) }}</template><template v-else-if="p.dueAt">ชำระก่อน {{ dateTime(p.dueAt) }}</template><template v-else>{{ dateOnly(p.paidAt) }}</template></span>
          </span>
          <span class="shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold" :class="PAY_LABEL(p)[1]">{{ PAY_LABEL(p)[0] }}</span>
        </li>
      </ul>
      <p v-else class="mb-3 rounded-xl bg-stone-50 p-3 text-center text-stone-500">ยังไม่มีการชำระ</p>

      <template v-if="canPayUi">
        <p v-if="o.pay.block" class="rounded-xl bg-stone-50 p-3 text-stone-600">{{ o.pay.block }}</p>
        <button v-else-if="!open" class="btn-primary w-full" @click="openPay()"><AppIcon name="wallet" :size="18" /> ชำระเงิน</button>
        <div v-else class="space-y-3">
          <div>
            <div class="label">ยอดที่จะโอน</div>
            <div class="flex flex-wrap gap-2">
              <button type="button" class="chip" :class="f.mode === 'all' ? 'chip-on' : 'chip-off'" @click="pick('all')">ค้างทั้งหมด {{ money(room) }}</button>
              <button v-for="p in requests" :key="p.id" type="button" class="chip" :class="f.mode === 'req' && f.paymentId === p.id ? 'chip-on' : 'chip-off'" @click="pick('req', p)">ตามที่ร้านแจ้ง {{ money(p.amount) }}</button>
              <button type="button" class="chip" :class="f.mode === 'custom' ? 'chip-on' : 'chip-off'" @click="pick('custom')">ระบุเอง</button>
            </div>
            <input v-if="f.mode === 'custom'" v-model="f.custom" type="text" inputmode="decimal" class="input mt-2" placeholder="ยอดที่โอน (บาท)" aria-label="ยอดที่โอน" />
            <p v-if="f.mode === 'custom' && minimum > 0" class="mt-1 text-xs text-stone-500">ขั้นต่ำ {{ money(minimum) }}</p>
            <p v-if="f.mode === 'custom' && Number(f.custom) > room" class="mt-1 text-xs text-rose-700">เกินคงค้าง (ไม่เกิน {{ money(room) }})</p>
          </div>

          <div v-if="hasInfo" class="rounded-2xl border border-stone-200 bg-white p-3">
            <div v-if="billerId && shopCode" class="text-center">
              <div class="text-xs text-stone-500">QR นี้สำหรับออร์เดอร์</div>
              <div class="text-base font-semibold text-stone-900">{{ orderNo(o.code) }}</div>
              <img v-if="qr" :src="qr" alt="QR พร้อมเพย์" class="mx-auto h-48 w-48" />
              <div v-if="consentNeed.length" class="space-y-2 rounded-xl bg-amber-50 p-3 text-sm text-stone-700" role="group" aria-label="ยินยอมก่อนชำระ">
                <p class="font-semibold">ก่อนชำระเงิน กรุณายินยอมตามข้อต่อไปนี้</p>
                <label v-for="k in consentNeed" :key="k" class="flex items-start gap-2"><input v-model="consentOk[k]" type="checkbox" class="mt-0.5 h-4 w-4" :data-consent="k" /><span>{{ LEGAL_KINDS[k]?.label || k }}</span></label>
              </div>
              <button v-else type="button" class="btn-soft mx-auto mt-2" :disabled="qrReq.busy || !(amount > 0) || belowMinimum || (consentNeed.length > 0 && !consentAll)" @click="makeQr"><span v-if="qrReq.busy" class="brand-ring" aria-hidden="true"></span>{{ qrReq.busy ? 'กำลังสร้าง QR…' : 'สร้าง QR สำหรับยอดนี้' }}</button>
              <p v-if="qrReq.error" class="mt-1 text-xs text-rose-700" role="alert">{{ qrReq.error }}</p>
            </div>
            <p v-if="amount > 0" class="text-center text-base font-semibold text-stone-900">{{ money(amount) }}</p>
            <div class="mt-3 space-y-2 text-left">
              <div v-for="a in accounts" :key="a.id" class="rounded-xl border border-stone-200 bg-stone-50 p-3">
                <div class="text-xs font-medium text-stone-500">{{ a.kind === 'bank' ? 'โอนเข้าบัญชีธนาคาร' : 'พร้อมเพย์' }}</div>
                <div class="mt-0.5 font-semibold text-stone-900">{{ a.kind === 'bank' ? a.bankName : 'พร้อมเพย์' }}</div>
                <div class="mt-1 flex flex-wrap items-center gap-2 text-stone-700">
                  <span class="text-base font-semibold text-stone-900">{{ a.kind === 'bank' ? a.accountNo : a.promptpayId }}</span>
                  <button type="button" class="chip chip-off h-7 px-2 text-xs" @click="copy(a.kind === 'bank' ? a.accountNo : a.promptpayId, 'acc-' + a.id)">{{ copied === 'acc-' + a.id ? 'คัดลอกแล้ว' : (a.kind === 'bank' ? 'คัดลอกเลขบัญชี' : 'คัดลอก') }}</button>
                </div>
                <div v-if="a.accountName" class="mt-1 text-xs text-stone-500">ชื่อบัญชี: <span class="text-stone-800">{{ a.accountName }}</span></div>
              </div>
              <div v-if="info.note" class="pt-1 text-xs text-stone-500">{{ info.note }}</div>
            </div>
          </div>
          <p v-else class="rounded-xl bg-amber-50 p-3 text-amber-800">ร้านยังไม่ได้ตั้งช่องทางรับชำระ กรุณาสอบถามร้าน</p>

          <div>
            <div class="label">สลิปการโอน <span class="text-rose-600">*</span></div>
            <label class="flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed border-stone-200 p-3 text-stone-500 hover:border-brand-300">
              <img v-if="f.slip" :src="f.slip" alt="สลิป" class="h-14 w-14 rounded-lg object-cover" />
              <AppIcon v-else name="image" :size="22" />
              <span class="min-w-0 truncate">{{ f.slip ? f.slipName || 'เปลี่ยนรูปสลิป' : 'แนบรูปสลิป (ย่อให้อัตโนมัติ ≤ 2 MB)' }}</span>
              <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" class="hidden" aria-label="แนบสลิป" @change="onSlip" />
            </label>
          </div>
          <div class="space-y-2 rounded-2xl border border-stone-200 p-3">
            <div class="text-xs text-stone-500">รายละเอียดการโอน (ให้ตรงกับสลิป) <span class="text-rose-600">*</span></div>
            <div class="grid grid-cols-2 gap-2">
              <div><label class="label" for="pay-date">วันที่โอน</label><input id="pay-date" v-model="f.txnDate" type="date" class="input" :max="thaiNow().date" /></div>
              <div><label class="label" for="pay-time">เวลาที่โอน</label><input id="pay-time" v-model="f.txnTime" type="time" class="input" /></div>
            </div>
            <div><label class="label" for="pay-bank">ธนาคารของผู้โอน <span class="font-normal text-stone-400">(ไม่บังคับ)</span></label>
              <select id="pay-bank" v-model="f.bankCode" class="input">
                <option value="">ไม่ระบุ</option>
                <option v-for="b in bankOptions" :key="b.code" :value="b.code">{{ b.name }}</option>
              </select>
            </div>
            <div><label class="label" for="pay-ref">เลขอ้างอิงรายการ <span class="font-normal text-stone-400">(ไม่บังคับ)</span></label><input id="pay-ref" v-model="f.ref" class="input" maxlength="40" autocomplete="off" placeholder="ไม่ต้องกรอกก็ได้ ร้านตรวจจากสลิปให้" /></div>
            <p v-if="f.qrNote" class="text-xs text-stone-500" role="status">{{ f.qrNote }}</p>
          </div>
          <div><label class="label">หมายเหตุ <span class="font-normal text-stone-400">(ไม่บังคับ · ใส่เลขออร์เดอร์ {{ orderNo(o.code) }} เพื่อให้ร้านตรวจได้ง่าย)</span></label><input v-model="f.note" class="input" maxlength="200" :placeholder="o.code" /></div>
          <p v-if="f.error" class="text-rose-700" role="alert">{{ f.error }}</p>
          <!-- ยินยอมก่อนชำระ: แสดงเฉพาะเมื่อร้านขอ · ต้องติ๊กทุกข้อจึงส่งได้ -->
          <div v-if="consentNeed.length" class="space-y-2 rounded-xl bg-amber-50 p-3 text-sm text-stone-700" role="group" aria-label="ยินยอมก่อนชำระ">
            <p class="font-semibold">ก่อนชำระเงิน กรุณายินยอมตามข้อต่อไปนี้</p>
            <label v-for="k in consentNeed" :key="k" class="flex items-start gap-2"><input v-model="consentOk[k]" type="checkbox" class="mt-0.5 h-4 w-4" :data-consent="k" /><span>{{ LEGAL_KINDS[k]?.label || k }}</span></label>
          </div>
          <div class="flex gap-2">
            <button class="btn-outline flex-1" @click="open = false">ยกเลิก</button>
            <button class="btn-primary flex-1" :disabled="f.busy || f.reading || !(amount > 0) || belowMinimum || (consentNeed.length > 0 && !consentAll)" @click="submit">{{ f.reading ? 'กำลังอ่านสลิป…' : 'ส่งสลิปแจ้งชำระ' }}</button>
          </div>
          <p class="text-xs text-stone-400">ร้านจะตรวจสลิปแล้วยืนยันยอดให้ (ยังไม่ตัดเงินอัตโนมัติ)</p>
        </div>
      </template>
    </section>

    <CustomerTaxInvoice v-if="o.vatRate > 0" :order-id="ctx.orderId || ''" :token="ctx.token || ''" :cancelled="cancelled" />

    <section v-if="canReview || o.review" class="card">
      <p v-if="o.review" class="text-stone-500">รีวิวของคุณ: {{ '★'.repeat(o.review.rating) }}</p>
      <button v-else class="btn-soft h-10" @click="emit('review', o)"><AppIcon name="star" :size="16" /> เขียนรีวิว</button>
    </section>
  </div>
</template>
