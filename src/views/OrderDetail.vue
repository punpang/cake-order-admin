<script setup>
import { computed, reactive, ref } from 'vue'
import {
  can, findOrder, findCustomer, setStatus, reportPayment, confirmPayment, receivePaymentNow, revertStatus, setAdjustment, cancelOrder, countPickups,
  updatePaymentRequest, cancelPaymentRequest, cancelConfirmedPayment,
  requestConfirmUnpaid, confirmUnpaid, rejectConfirmUnpaid, grantPayExtension, denyPayExtension,
  saveOrderItem, removeOrderItem, orderDate,
  db, customerPoints, usableDiscountCoupons, applyPoints, removePoints, applyCoupon, removeCoupon,
  setBirthday, depositOf, setDelivery,
} from '../data/store'
import { orderTotals, shipNetOf } from '../lib/pricing'
import { QUICK_DUE, quickDue, dueState, remainingText, dueBeforePickup, dueDaysBefore, isHHmm, customerPending } from '../lib/payDue'
import { CHANNELS, NOTIFY_EVENTS } from '../lib/constants'
import { askConfirm, askConfirmEx } from '../lib/confirm'
import { prevStatus } from '../lib/orderFlow'
import { STATUS } from '../lib/constants'
import { orderCost } from '../lib/materials'
import { money, dateTime, toDateStr, pad, num, formatPhone, phoneDigits } from '../lib/format'
import { PAYMENT_METHODS, ROLES } from '../lib/constants'
import StatusBadge from '../components/StatusBadge.vue'
import PayDueBadge from '../components/PayDueBadge.vue'
import DiscountDetail from '../components/DiscountDetail.vue'
import ItemCard from '../components/ItemCard.vue'
import ItemEditor from '../components/ItemEditor.vue'
import AppModal from '../components/AppModal.vue'
import AppIcon from '../components/AppIcon.vue'
import PickupModal from '../components/PickupModal.vue'
import RefundEditor from '../components/RefundEditor.vue'
import ChangeBuyerModal from '../components/ChangeBuyerModal.vue'
import OrderLinkModal from '../components/OrderLinkModal.vue'
import TaxInvoiceModal from '../components/TaxInvoiceModal.vue'
import WorkPhotos from '../components/WorkPhotos.vue'
import { invoiceOfOrder } from '../data/acct'
import { defaultRefundMethod, refundList } from '../lib/refund'
import BirthdayFields from '../components/BirthdayFields.vue'
import DeliveryFields from '../components/DeliveryFields.vue'
import { checkMapUrl } from '../lib/delivery'
import { parseBirthday, toForm, mdLabel } from '../lib/birthday'

const props = defineProps({ id: { type: String, required: true } })
const order = computed(() => findOrder(props.id))
const customer = computed(() => order.value && findCustomer(order.value.customerId))
const t = computed(() => orderTotals(order.value))
// ข้อความแจ้งเตือนของออร์เดอร์นี้ (จำลอง)
const messages = computed(() => db.outbox.filter((m) => m.orderId === order.value.id))
// ต้นทุนวัตถุดิบ / กำไร (แอดมิน)
const matCost = computed(() => orderCost(order.value, db.optionGroups, db.retailItems, db.ingredients))
const shipCost = computed(() => shipNetOf(t.value))
const cost = computed(() => matCost.value + shipCost.value)
const load = computed(() => countPickups(order.value.pickupAt, order.value.id))
const closed = computed(() => ['delivered', 'cancelled'].includes(order.value.status))

const canDeliver = computed(() =>
  order.value.fulfillment === 'delivery' ? can('deliverShipping') : can('deliverPickup'),
)

const isShip = computed(() => order.value.fulfillment === 'delivery')
// ขั้นจัดส่ง: เตรียมแล้ว → พร้อมจัดส่ง → กำลังจัดส่ง → ส่งมอบ · ออร์เดอร์รับที่ร้าน: เตรียมแล้ว → ส่งมอบ
const canShipStep = computed(() => can('markPrepared') || can('deliverShipping'))
const shipAction = computed(() => {
  const s = order.value.status
  if (!isShip.value) return (s === 'prepared' && canDeliver.value) ? 'deliver' : ''
  if (s === 'prepared' && canShipStep.value) return 'ready'
  if (s === 'ready_to_ship' && can('deliverShipping')) return 'ship'
  if (s === 'shipping' && can('deliverShipping')) return 'deliver'
  return ''
})
const startable = (s) => ['payment_confirmed', 'order_confirmed'].includes(s)
const unpaidStage = (s) => ['awaiting_payment', 'payment_reported'].includes(s)
const primaryAction = computed(() => {
  const s = order.value.status
  return (s === 'draft' && can('sendToPayment'))
    || (startable(s) && can('startPreparing'))
    || (s === 'preparing' && can('markPrepared'))
    || !!shipAction.value
})

const hasActions = computed(() => {
  const s = order.value.status
  return canRevertUi.value
    || (can('cancel') && !closed.value)
    || (s === 'draft' && can('sendToPayment'))
    || (startable(s) && can('startPreparing'))
    || (s === 'preparing' && can('markPrepared'))
    || !!shipAction.value
    || (unpaidStage(s) && (can('confirmUnpaid') || can('requestConfirmUnpaid')))
})

const paidPct = computed(() => (t.value.total > 0 ? Math.min(100, Math.round((t.value.paid / t.value.total) * 100)) : 0))
const initial = (n) => (n || '').replace(/^คุณ/, '').trim().charAt(0)

const nowLocal = () => {
  const d = new Date()
  return `${toDateStr(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ---------- แจ้งยอดชำระ / แก้ยอดที่แจ้ง / ยืนยันยอดจริง ----------
const payOpen = ref(false)
const payMode = ref('new') // new | edit | confirm | direct (รับชำระทันที ไม่ต้องแจ้งยอด)
const payTarget = ref(null)
const pay = reactive({ amount: 0, method: PAYMENT_METHODS[0], paidAt: '', slip: '', note: '', dueAt: '', notify: true })
const payError = ref('')
// กำหนดชำระตามเวลานัด: ก่อนนัด N ชม. / ล่วงหน้า N วัน ก่อน HH:mm (ผ่านไปแล้ว = ปิดปุ่ม + เหตุผล)
const HOURS_BEFORE = [1, 3, 6, 12, 24]
const DAYS_BEFORE = [1, 2, 3]
const dueHours = ref(db.shop.payDueRule.hoursBefore)
const dueDays = ref(db.shop.payDueRule.daysBefore)
const dueTime = ref(db.shop.payDueRule.atTime)
const beforeOpts = computed(() => HOURS_BEFORE.map((h) => ({ h, ...dueBeforePickup(order.value.pickupAt, h) })))
const beforeCustom = computed(() => dueBeforePickup(order.value.pickupAt, dueHours.value))
const daysOpts = computed(() => DAYS_BEFORE.map((d) => ({ d, ...dueDaysBefore(order.value.pickupAt, d, isHHmm(dueTime.value) ? dueTime.value : '12:00') })))
const daysCustom = computed(() => dueDaysBefore(order.value.pickupAt, dueDays.value, dueTime.value))
const dueReasons = computed(() => [...beforeOpts.value.filter((x) => x.disabled).map((x) => `ก่อนนัด ${x.h} ชม.: ${x.reason}`), ...daysOpts.value.filter((x) => x.disabled).map((x) => `ล่วงหน้า ${x.d} วัน ก่อน ${dueTime.value}: ${x.reason}`)])
const PAY_TITLE = { new: 'แจ้งยอดชำระ', edit: 'แก้ยอดที่แจ้ง', confirm: 'ยืนยันยอดชำระ', direct: 'รับชำระทันที' }
// มัดจำ: แจ้งยอดงวดแรก (ยังไม่มีงวดที่แจ้ง/ยืนยัน) เติมยอดมัดจำให้ แก้ได้
const fullAmount = computed(() => Math.max(t.value.balance - t.value.reported, 0))
const depositAmount = computed(() => Math.min(depositOf(t.value.total), fullAmount.value))
const showDeposit = computed(() =>
  payMode.value === 'new' && db.shop.depositPercent > 0 && !order.value.payments.some((x) => x.status !== 'cancelled') && depositAmount.value < fullAmount.value,
)
function openPay(mode = 'new', p = null) {
  payMode.value = mode
  payTarget.value = p
  Object.assign(pay, p
    ? { amount: mode === 'confirm' && p.customerSubmitted ? p.amount : (p.requested ?? p.amount), method: p.method, paidAt: p.paidAt, slip: p.slip, note: p.note, dueAt: p.dueAt || '' }
    : { amount: mode === 'direct' ? Math.max(t.value.balance, 0) : fullAmount.value, method: PAYMENT_METHODS[0], paidAt: nowLocal(), slip: '', note: '', dueAt: db.shop.payDueMin > 0 ? quickDue(db.shop.payDueMin) : '' })
  if (showDeposit.value) pay.amount = depositAmount.value
  dueHours.value = db.shop.payDueRule.hoursBefore
  dueDays.value = db.shop.payDueRule.daysBefore
  dueTime.value = db.shop.payDueRule.atTime
  pay.notify = true
  payError.value = ''
  payOpen.value = true
}
function onSlip(e) {
  const f = e.target.files[0]
  if (f) pay.slip = URL.createObjectURL(f)
}
async function savePay() {
  if (!(pay.amount > 0)) return (payError.value = 'กรอกยอดเงิน')
  if (payMode.value === 'direct') {
    if (!(await askConfirm({ title: 'รับชำระทันที', message: `ได้รับ ${money(pay.amount)} (${pay.method}) · บันทึกเป็นยอดที่ยืนยันแล้วเลย`, okText: 'ยืนยัน' }))) return
    const r = receivePaymentNow(order.value, { ...pay })
    if (r.error) return (payError.value = r.error)
    payOpen.value = false
    return
  }
  if (payMode.value !== 'confirm' && !pay.dueAt) return (payError.value = 'ต้องกำหนดชำระ เลือกเวลาก่อน')
  if (payMode.value !== 'confirm' && new Date(pay.dueAt).getTime() <= Date.now()) return (payError.value = 'กำหนดชำระต้องเป็นเวลาในอนาคต')
  if (payMode.value === 'confirm' && !(await askConfirm({ title: 'ยืนยันยอดชำระ', message: `ได้รับจริง ${money(pay.amount)}`, okText: 'ยืนยัน' }))) return
  if (payMode.value === 'confirm') confirmPayment(order.value, payTarget.value.id, { ...pay })
  else if (payMode.value === 'edit') updatePaymentRequest(order.value, payTarget.value.id, { ...pay })
  else reportPayment(order.value, { ...pay })
  payOpen.value = false
}
const PAY_BADGE = {
  reported: { t: 'รอลูกค้าชำระ', cls: 'bg-sky-100 text-sky-800' },
  confirmed: { t: 'ยืนยันแล้ว', cls: 'bg-emerald-100 text-emerald-800' },
  cancelled: { t: 'ยกเลิกแล้ว', cls: 'bg-stone-100 text-stone-500' },
}

// ---------- แก้วันเวลานัด / วันเกิด ----------
const pickupOpen = ref(false)
const canEditPickup = computed(() => can('editPickup') && !closed.value)
const canEditBirthday = computed(() => can('editPickup') && order.value.status !== 'cancelled')
const bdOpen = ref(false)
const bd = ref({ name: '', day: '', month: '' })
const bdError = ref('')
function openBirthday() {
  bd.value = toForm(order.value.birthday)
  bdError.value = ''
  bdOpen.value = true
}
function saveBirthday() {
  const r = parseBirthday(bd.value)
  if (r.error) return (bdError.value = r.error)
  setBirthday(order.value, r.value)
  bdOpen.value = false
}

// ---------- แก้ข้อมูลจัดส่ง ----------
const dvOpen = ref(false)
const dv = reactive({ placeName: '', address: '', mapUrl: '', detail: '', distanceKm: '', shippingFee: 0, feeManual: false })
const dvError = ref('')
const canEditDelivery = computed(() => can('editPickup') && !closed.value && order.value.fulfillment === 'delivery')
function openDelivery() {
  const o = order.value
  Object.assign(dv, { placeName: o.placeName || '', address: o.address || '', mapUrl: o.mapUrl || '', detail: o.detail || '', distanceKm: o.distanceKm ?? '', shippingFee: o.shippingFee || 0, feeManual: !!o.feeManual })
  dvError.value = ''
  dvOpen.value = true
}
function saveDelivery() {
  const r = setDelivery(order.value, { ...dv })
  if (r.error) return (dvError.value = r.error)
  dvOpen.value = false
}
const mapHref = computed(() => checkMapUrl(order.value.mapUrl).url || '')

// ---------- ปรับราคา ----------
const adjOpen = ref(false)
// sign: -1 = ส่วนลด, 1 = เพิ่มราคา · amount = จำนวนเงิน (บวก) กรอกด้วยแป้นตัวเลข
const adj = reactive({ amount: 0, sign: -1, reason: '' })
const adjError = ref('')
function openAdj() {
  const a = Number(order.value.adjustment.amount) || 0
  Object.assign(adj, { amount: Math.abs(a) || '', sign: a > 0 ? 1 : -1, reason: order.value.adjustment.reason })
  adjError.value = ''
  adjOpen.value = true
}
function saveAdj() {
  if (!adj.reason.trim()) return (adjError.value = 'ใส่เหตุผล')
  setAdjustment(order.value, adj.sign * (Number(adj.amount) || 0), adj.reason.trim())
  adjOpen.value = false
}

// ---------- popup ยืนยัน ----------
async function doStatus(status, text, title) {
  if (status === 'delivered' && t.value.balance > 0) return
  // สถานะที่มีข้อความถึงลูกค้า: มีช่องติ๊ก "แจ้งลูกค้า" (ค่าเริ่มต้นติ๊ก)
  const tells = ['awaiting_payment', 'prepared', 'shipping', 'delivered'].includes(status) && order.value.channel !== 'pos' && !!customer.value
  const r = await askConfirmEx({ title, message: `ออร์เดอร์ ${order.value.code}`, okText: title, ...(tells ? { checkbox: { label: 'แจ้งลูกค้า', hint: 'ไม่ติ๊ก = ไม่ส่งข้อความถึงลูกค้า (ทีมยังได้รับตามปกติ)', value: true } } : {}) })
  if (r.ok) setStatus(order.value, status, text, { notify: tells ? r.checked : true })
}
async function doConfirmUnpaid() {
  const r = await askConfirmEx({ title: 'ยืนยันการสั่งซื้อ (ยังไม่ชำระ)', message: `ออร์เดอร์ ${order.value.code} · คงค้าง ${money(t.value.balance)} ชำระได้ภายหลัง`, okText: 'ยืนยัน', checkbox: { label: 'แจ้งลูกค้า', value: true } })
  if (r.ok) confirmUnpaid(order.value, { notify: r.checked })
}
async function doRequestUnpaid() {
  if (await askConfirm({ title: 'ขออนุมัติยืนยันการสั่งซื้อ', message: 'ส่งคำขอให้แอดมินอนุมัติ (ยังไม่ชำระ)', okText: 'ส่งคำขอ' })) requestConfirmUnpaid(order.value)
}
async function doRejectUnpaid() {
  if (await askConfirm({ title: 'ไม่อนุมัติ', message: `ปฏิเสธคำขอยืนยันของ ${order.value.code}`, okText: 'ไม่อนุมัติ', danger: true })) rejectConfirmUnpaid(order.value)
}
// ---------- ขยายเวลาชำระ ----------
const extFor = ref(null) // งวดที่กำลังขยาย
const extAt = ref('')
function openExt(p) {
  extFor.value = p
  extAt.value = quickDue(db.shop.payDueMin || 30)
}
function saveExt() {
  if (!extAt.value || new Date(extAt.value).getTime() <= Date.now()) return
  grantPayExtension(order.value, extFor.value.id, extAt.value)
  extFor.value = null
}
async function doDenyExt(p) {
  if (await askConfirm({ title: 'ไม่อนุมัติขยายเวลา', message: 'ลูกค้าจะยังชำระเองไม่ได้', okText: 'ไม่อนุมัติ', danger: true })) denyPayExtension(order.value, p.id)
}
async function doCancelConfirmed(p) {
  if (await askConfirm({ title: 'ยกเลิกยอดที่ยืนยันแล้ว', message: `${money(p.amount)} (${p.method})`, okText: 'ยกเลิกยอด', danger: true })) cancelConfirmedPayment(order.value, p.id)
}
async function doRemoveItem(it) {
  if (await askConfirm({ title: 'ลบสินค้า', message: `${it.name} × ${it.qty}`, okText: 'ลบ', danger: true })) removeOrderItem(order.value, it.id)
}
async function doCancelRequest(p) {
  if (await askConfirm({ title: 'ยกเลิกยอดที่แจ้ง', message: money(p.requested ?? p.amount), okText: 'ยกเลิกยอด', danger: true })) cancelPaymentRequest(order.value, p.id)
}
async function doRemovePoints() {
  if (await askConfirm({ title: 'ยกเลิกการใช้คะแนน', message: `คืน ${order.value.pointsUsed.points} คะแนนให้ลูกค้า`, okText: 'ยกเลิกการใช้', danger: true })) removePoints(order.value)
}
async function doApplyCoupon(c) {
  if (await askConfirm({ title: 'ใช้คูปอง', message: `${c.name} (−${money(c.amount)})`, okText: 'ใช้คูปอง' })) applyCoupon(order.value, c.id)
}
async function doRemoveCoupon(u) {
  if (await askConfirm({ title: 'ยกเลิกการใช้คูปอง', message: u.name, okText: 'ยกเลิกการใช้', danger: true })) removeCoupon(order.value, u.couponId)
}

// ---------- แก้รายการสินค้า (แอดมิน) ----------
const editing = ref(null) // null = ปิด, {} = เพิ่มใหม่, { item } = แก้ไข
function onSaveItem(item) {
  saveOrderItem(order.value, item)
  editing.value = null
}

// ---------- คะแนน / คูปอง (พนักงาน) ----------
const canLoyalty = computed(() => can('useLoyalty') && !closed.value && !!customer.value)
const points = computed(() => customerPoints(customer.value))
const coupons = computed(() => usableDiscountCoupons(customer.value))
const ptOpen = ref(false)
const ptUse = ref(0)
const ptError = ref('')
// ใช้ได้ไม่เกินคะแนนที่มี และไม่เกินยอดที่ต้องจ่าย
const ptMax = computed(() => Math.min(points.value, Math.floor(Math.max(t.value.total, 0) / (db.loyalty.pointValue || 1))))
function openPoints() {
  ptUse.value = ptMax.value
  ptError.value = ''
  ptOpen.value = true
}
async function savePoints() {
  const n = Math.floor(Number(ptUse.value) || 0)
  if (n <= 0 || n > ptMax.value) return (ptError.value = `ใช้ได้ 1 – ${ptMax.value} คะแนน`)
  if (!(await askConfirm({ title: 'ใช้คะแนน', message: `ใช้ ${n} คะแนน ลด ${money(n * db.loyalty.pointValue)}`, okText: 'ใช้คะแนน' }))) return
  applyPoints(order.value, n)
  ptOpen.value = false
}

// ---------- ยกเลิก ----------
const cancelOpen = ref(false)
const cxl = reactive({ reason: '', refunds: [], refundNote: '', notify: true })
const cxlError = ref('')
const buyerOpen = ref(false)
const linkOpen = ref(false)
const taxOpen = ref(false)
// ย้อนสถานะทีละขั้น
const rv = reactive({ open: false, reason: '', error: '' })
const revTo = computed(() => prevStatus(order.value))
const canRevertUi = computed(() => can('revertStatus') && order.value.channel !== 'pos' && !!revTo.value)
function openRevert() { Object.assign(rv, { open: true, reason: '', error: '' }) }
function saveRevert() {
  const r = revertStatus(order.value, rv.reason)
  if (r.error) return (rv.error = r.error)
  rv.open = false
}
function openCancel() {
  // คืนเต็มจำนวนตามช่องทางที่ลูกค้าจ่ายล่าสุดเป็นค่าตั้งต้น (เปลี่ยน/แบ่งช่องทางได้: เงินสด / ธนาคาร / คะแนนสะสม)
  const last = order.value.payments.filter((p) => p.status === 'confirmed').at(-1)
  Object.assign(cxl, { reason: '', refunds: t.value.paid > 0 ? [{ method: defaultRefundMethod(last?.method), amount: t.value.paid }] : [], refundNote: '', notify: true })
  cxlError.value = ''
  cancelOpen.value = true
}
async function saveCancel() {
  if (!cxl.reason.trim()) return (cxlError.value = 'ใส่เหตุผลการยกเลิก')
  if (!(await askConfirm({ title: 'ยกเลิกออร์เดอร์', message: `ออร์เดอร์ ${order.value.code}\nเหตุผล: ${cxl.reason}`, okText: 'ยกเลิกออร์เดอร์', danger: true }))) return
  const r = cancelOrder(order.value, { reason: cxl.reason, refunds: cxl.refunds.map((x) => ({ method: x.method, amount: Number(x.amount) })), refundNote: cxl.refundNote, notify: cxl.notify })
  if (r.error) return (cxlError.value = r.error)
  cancelOpen.value = false
}
</script>

<template>
  <div v-if="!order" class="card flex flex-col items-center gap-3 py-12 text-center">
    <div class="font-semibold text-stone-800">ไม่พบออร์เดอร์</div>
    <RouterLink to="/admin/orders" class="btn-soft">กลับไปหน้าออร์เดอร์</RouterLink>
  </div>

  <div v-else class="mx-auto max-w-5xl" :class="hasActions ? 'pb-[calc(env(safe-area-inset-bottom)+6rem)] lg:pb-0' : ''">
    <!-- หัว -->
    <div class="mb-4 flex items-center gap-2">
      <RouterLink to="/admin/orders" class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-stone-700 shadow-sm ring-1 ring-stone-200/70" aria-label="กลับ">
        <AppIcon name="back" :size="20" />
      </RouterLink>
      <div class="min-w-0 flex-1">
        <h1 class="truncate text-xl font-semibold tracking-tight text-stone-900">{{ order.code }}</h1>
      </div>
      <span v-if="customerPending(order).length" class="inline-flex shrink-0 items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap text-sky-700">ลูกค้าแจ้งโอน รอตรวจสลิป</span>
      <PayDueBadge :order="order" />
      <StatusBadge :status="order.status" />
    </div>

    <!-- ขออนุมัติยืนยันการสั่งซื้อ (ยังไม่ชำระ) -->
    <div v-if="order.approval?.status === 'pending' && unpaidStage(order.status)" class="mb-3 flex flex-wrap items-center gap-2 rounded-2xl bg-indigo-50 p-3 text-sm text-indigo-800">
      <AppIcon name="alert" :size="16" />
      <span class="min-w-0 flex-1">มีคำขออนุมัติยืนยันการสั่งซื้อ (ยังไม่ชำระ) · คงค้าง {{ money(t.balance) }}<span v-if="order.approval.note"> · {{ order.approval.note }}</span></span>
      <template v-if="can('confirmUnpaid')">
        <button class="btn-primary h-9 px-3" @click="doConfirmUnpaid">อนุมัติ</button>
        <button class="btn-outline h-9 px-3" @click="doRejectUnpaid">ไม่อนุมัติ</button>
      </template>
      <span v-else class="text-xs">รอแอดมินอนุมัติ</span>
    </div>
    <div v-else-if="order.approval?.status === 'rejected' && unpaidStage(order.status)" class="mb-3 rounded-2xl bg-rose-50 p-3 text-sm text-rose-700">ไม่อนุมัติยืนยันแบบยังไม่ชำระ<span v-if="order.approval.decisionNote"> · {{ order.approval.decisionNote }}</span></div>

    <div class="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-4">
      <!-- ซ้าย -->
      <div class="min-w-0 space-y-3 lg:space-y-4">
        <!-- ลูกค้า + นัดรับ -->
        <section class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div class="card flex min-w-0 gap-3">
            <span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-600 text-lg font-semibold text-white">{{ initial(customer?.name) }}</span>
            <div class="min-w-0 flex-1">
              <div class="text-xs text-stone-500">ลูกค้า</div>
              <div class="truncate font-semibold text-stone-900">{{ customer?.name }}</div>
              <div v-if="customer?.line" class="truncate text-sm text-stone-500">LINE {{ customer.line }}</div>
              <div v-if="customer?.note" class="mt-1 text-sm break-words text-stone-500">{{ customer.note }}</div>
              <div v-if="order.birthday" class="mt-1 text-sm break-words text-stone-600">
                วันเกิด {{ order.birthday.name }} · {{ mdLabel(order.birthday.md) }}
                <button v-if="canEditBirthday" class="ml-1 text-brand-700 underline" @click="openBirthday">แก้</button>
              </div>
              <button v-else-if="canEditBirthday" class="mt-1 text-sm text-brand-700 underline" @click="openBirthday">+ เพิ่มวันเกิด</button>
              <button v-if="can('changeBuyer') && order.status !== 'cancelled'" class="mt-1 block text-sm text-brand-700 underline" @click="buyerOpen = true">เปลี่ยนผู้ซื้อ</button>
              <button v-if="can('createOrder') && order.status !== 'draft' && order.channel !== 'pos'" class="mt-1 block text-sm text-brand-700 underline" @click="linkOpen = true">ส่งลิงก์ให้ลูกค้า</button>
              <button v-if="can('taxInvoice') && t.vatMode && order.status !== 'draft' && order.status !== 'cancelled'" class="mt-1 block text-sm text-brand-700 underline" @click="taxOpen = true">ใบกำกับภาษีเต็มรูป</button>
            </div>
            <a
              v-if="customer?.phone"
              :href="`tel:${phoneDigits(customer.phone)}`"
              class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700"
              :aria-label="`โทร ${formatPhone(customer.phone)}`"
            ><AppIcon name="phone" /></a>
          </div>

          <div class="card flex min-w-0 gap-3">
            <span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
              <AppIcon :name="order.fulfillment === 'delivery' ? 'truck' : 'store'" :size="22" />
            </span>
            <div class="min-w-0 flex-1">
              <div class="text-xs text-stone-500">นัดรับ · {{ order.fulfillment === 'delivery' ? 'จัดส่ง' : 'รับที่ร้าน' }}</div>
              <div class="font-semibold text-stone-900">{{ dateTime(order.pickupAt) }}</div>
              <div v-if="order.address" class="mt-1 flex gap-1 text-sm text-stone-600">
                <AppIcon name="pin" :size="15" class="mt-0.5 text-stone-400" />
                <span class="min-w-0 break-words"><b v-if="order.placeName" class="font-semibold text-stone-800">{{ order.placeName }} · </b>{{ order.address }}</span>
              </div>
              <div v-if="order.fulfillment === 'delivery' && (order.distanceKm != null || mapHref || order.detail)" class="mt-1 space-y-0.5 text-sm text-stone-600">
                <div v-if="order.distanceKm != null">ระยะทาง {{ order.distanceKm }} กม. · ค่าส่ง {{ money(order.shippingFee) }}</div>
                <div v-if="order.detail" class="break-words">รายละเอียด: {{ order.detail }}</div>
                <a v-if="mapHref" :href="mapHref" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 text-brand-700 underline"><AppIcon name="pin" :size="14" /> เปิดแผนที่</a>
              </div>
              <button v-if="canEditDelivery" class="mt-1 block text-sm text-brand-700 underline" @click="openDelivery">แก้ข้อมูลจัดส่ง</button>
              <div class="mt-1.5 text-xs text-stone-400">วันเดียวกันมีอีก {{ load.day }} · ชั่วโมงเดียวกัน {{ load.hour }}</div>
            </div>
            <button v-if="canEditPickup" class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700" aria-label="แก้วันเวลานัด" @click="pickupOpen = true"><AppIcon name="edit" /></button>
          </div>
        </section>

        <!-- สินค้า -->
        <section class="card">
          <div class="card-title"><AppIcon name="cake" class="text-brand-600" /> สินค้า <span class="font-normal text-stone-400">{{ order.items.length }}</span></div>
          <div class="space-y-2.5">
            <div v-for="it in order.items" :key="it.id">
            <ItemCard :item="it" class="bg-stone-50/50">
              <template v-if="can('editItems')">
                <button class="btn-outline h-9 px-3" @click="editing = { item: it }"><AppIcon name="edit" :size="16" /> แก้ไข</button>
                <button v-if="order.items.length > 1" class="btn-danger h-9 px-3" @click="doRemoveItem(it)"><AppIcon name="trash" :size="16" /> ลบ</button>
              </template>
            </ItemCard>
            <WorkPhotos :order="order" :item="it" />
            </div>
          </div>
          <button v-if="can('editItems')" class="btn-soft mt-3 w-full" @click="editing = {}"><AppIcon name="plus" :size="16" /> เพิ่มสินค้า</button>
        </section>

        <!-- ยกเลิก -->
        <section v-if="order.cancel" class="card border-rose-200 bg-rose-50/70">
          <div class="card-title text-rose-700"><AppIcon name="x" /> ยกเลิกแล้ว</div>
          <dl class="space-y-1.5 text-sm">
            <div class="flex gap-3"><dt class="w-20 shrink-0 text-rose-500">เหตุผล</dt><dd class="min-w-0 break-words">{{ order.cancel.reason }}</dd></div>
            <div class="flex gap-3"><dt class="w-20 shrink-0 text-rose-500">คืนเงิน</dt>
              <dd class="min-w-0">
                <template v-if="refundList(order.cancel).length"><div v-for="(x, i) in refundList(order.cancel)" :key="i">{{ x.label }} {{ money(x.amount) }}<template v-if="x.points != null"> ({{ x.points }} คะแนน)</template></div></template>
                <template v-else>ไม่คืนเงิน</template>
              </dd>
            </div>
            <div v-if="order.cancel.refundNote" class="flex gap-3"><dt class="w-20 shrink-0 text-rose-500">หมายเหตุ</dt><dd class="min-w-0 break-words">{{ order.cancel.refundNote }}</dd></div>
          </dl>
        </section>

        <!-- ประวัติ (คอม) -->
        <section class="card hidden lg:block">
          <div class="card-title"><AppIcon name="history" class="text-brand-600" /> ประวัติ</div>
          <ol class="relative space-y-3 border-l-2 border-stone-100 pl-4">
            <li v-for="(h, i) in order.history.slice().reverse()" :key="i" class="relative">
              <span class="absolute top-1.5 -left-[21px] h-2.5 w-2.5 rounded-full ring-4 ring-white" :class="i === 0 ? 'bg-brand-500' : 'bg-stone-300'" />
              <div class="text-sm break-words text-stone-800">{{ h.text }}</div>
              <div class="text-xs text-stone-400">{{ dateTime(h.at) }} · {{ ROLES[h.by] }}</div>
            </li>
          </ol>
        </section>
      </div>

      <!-- ขวา -->
      <div class="min-w-0 space-y-3 lg:space-y-4">
        <!-- ยอดเงิน -->
        <section class="card">
          <div class="text-xs text-stone-500">ยอดรวม</div>
          <div class="text-3xl font-semibold tracking-tight text-stone-900">{{ money(t.total) }}</div>

          <template v-if="order.status !== 'cancelled'">
            <div class="mt-3 h-2 overflow-hidden rounded-full bg-stone-100">
              <div class="h-full rounded-full bg-emerald-500 transition-all" :style="{ width: paidPct + '%' }" />
            </div>
            <div class="mt-2 grid grid-cols-2 gap-2 text-sm">
              <div class="rounded-xl bg-emerald-50 p-2.5">
                <div class="text-xs text-emerald-700">ยืนยันแล้ว</div>
                <div class="font-semibold text-emerald-800">{{ money(t.paid) }}</div>
              </div>
              <div v-if="t.balance < 0" class="rounded-xl bg-rose-50 p-2.5">
                <div class="text-xs text-rose-600">ชำระเกิน</div>
                <div class="font-semibold text-rose-700">{{ money(-t.balance) }}</div>
              </div>
              <div v-else class="rounded-xl p-2.5" :class="t.balance > 0 ? 'bg-amber-50' : 'bg-stone-50'">
                <div class="text-xs" :class="t.balance > 0 ? 'text-amber-700' : 'text-stone-500'">คงค้าง</div>
                <div class="font-semibold" :class="t.balance > 0 ? 'text-amber-800' : 'text-stone-700'">{{ money(t.balance) }}</div>
              </div>
            </div>
            <div v-if="t.reported" class="mt-2 rounded-xl bg-sky-50 p-2.5 text-sm text-sky-800">แจ้งยอดแล้ว รอลูกค้าชำระ {{ money(t.reported) }}</div>
          </template>

          <dl class="mt-3 space-y-1.5 border-t border-stone-100 pt-3 text-sm">
            <div v-if="t.discountTotal" class="flex items-start justify-between gap-2 rounded-xl bg-emerald-50/60 p-2.5">
              <dt class="text-stone-600">ราคาเต็ม → ยอดสุทธิ</dt>
              <dd><DiscountDetail :full="t.fullAll" :final="t.total" :lines="t.discountLines" /></dd>
            </div>
            <div class="flex justify-between gap-2"><dt class="text-stone-500">ค่าสินค้า</dt><dd>{{ money(t.subtotal) }}</dd></div>
            <div v-if="order.fulfillment === 'delivery'" class="flex justify-between gap-2"><dt class="text-stone-500">ค่าส่ง</dt><dd>{{ money(t.shipping) }}</dd></div>
            <div v-if="t.adjustment" class="flex justify-between gap-2">
              <dt class="min-w-0 text-stone-500">ปรับราคา <span class="break-words text-stone-400">({{ order.adjustment.reason }})</span></dt>
              <dd class="shrink-0">{{ money(t.adjustment) }}</dd>
            </div>
            <div v-if="t.pointsDiscount" class="flex justify-between gap-2"><dt class="text-stone-500">ใช้ {{ order.pointsUsed.points }} คะแนน</dt><dd class="text-rose-600">−{{ money(t.pointsDiscount) }}</dd></div>
            <div v-for="u in order.couponsUsed" :key="u.couponId" class="flex justify-between gap-2"><dt class="min-w-0 break-words text-stone-500">คูปอง {{ u.name }}</dt><dd class="shrink-0 text-rose-600">−{{ money(u.amount) }}</dd></div>
            <div v-if="t.vatMode === 'exclusive'" class="flex justify-between gap-2"><dt class="text-stone-500">VAT {{ t.vatRate }}% (บวกเพิ่ม)</dt><dd>+{{ money(t.vat) }}</dd></div>
            <div v-else-if="t.vatMode === 'inclusive'" class="flex justify-between gap-2 text-xs text-stone-400"><dt>รวม VAT {{ t.vatRate }}% แล้ว (ก่อน VAT {{ money(t.beforeVat) }})</dt><dd>{{ money(t.vat) }}</dd></div>
          </dl>
          <dl v-if="can('viewProfit')" class="mt-3 space-y-1.5 border-t border-stone-100 pt-3 text-sm">
            <div class="flex justify-between gap-2"><dt class="text-stone-500">ต้นทุนวัตถุดิบ</dt><dd>{{ money(matCost) }}</dd></div>
            <div v-if="shipCost > 0" class="flex justify-between gap-2"><dt class="text-stone-500">ค่าส่งที่จ่ายคนส่ง (เท่ากับค่าส่งที่เก็บ)</dt><dd>{{ money(shipCost) }}</dd></div>
            <div class="flex justify-between gap-2 font-semibold"><dt>กำไร <span v-if="t.vatMode" class="text-xs font-normal text-stone-400">(ก่อน VAT)</span></dt><dd :class="t.beforeVat - cost >= 0 ? 'text-emerald-700' : 'text-rose-600'">{{ money(t.beforeVat - cost) }}</dd></div>
          </dl>
          <button v-if="can('adjustPrice') && !closed" class="btn-soft mt-3 w-full" @click="openAdj"><AppIcon name="tag" :size="16" /> ปรับราคา / ส่วนลด</button>
        </section>

        <!-- คะแนน / คูปอง -->
        <section v-if="customer" class="card">
          <div class="card-title"><AppIcon name="tag" class="text-brand-600" /> คะแนน / คูปอง</div>
          <div class="text-sm text-stone-600">คะแนนของลูกค้า <b class="text-stone-900">{{ num(points) }}</b> คะแนน</div>
          <div v-if="order.loyalty" class="mt-1 text-sm text-emerald-700">ได้จากออร์เดอร์นี้ {{ order.loyalty.points }} คะแนน<span v-if="order.loyalty.spins"> + หมุน {{ order.loyalty.spins }} ครั้ง</span></div>

          <div v-if="order.pointsUsed" class="mt-3 flex items-center justify-between gap-2 rounded-xl bg-brand-50 p-2.5 text-sm">
            <span>ใช้ {{ order.pointsUsed.points }} คะแนน (−{{ money(order.pointsUsed.amount) }})</span>
            <button v-if="canLoyalty" class="text-rose-600 underline" @click="doRemovePoints">ยกเลิก</button>
          </div>
          <button v-else-if="canLoyalty && ptMax > 0" class="btn-soft mt-3 w-full" @click="openPoints"><AppIcon name="tag" :size="16" /> ใช้คะแนนเป็นส่วนลด</button>

          <div v-for="u in order.couponsUsed" :key="u.couponId" class="mt-2 flex items-center justify-between gap-2 rounded-xl bg-brand-50 p-2.5 text-sm">
            <span class="min-w-0 break-words">คูปอง {{ u.name }} (−{{ money(u.amount) }})</span>
            <button v-if="canLoyalty" class="shrink-0 text-rose-600 underline" @click="doRemoveCoupon(u)">ยกเลิก</button>
          </div>
          <div v-if="canLoyalty && coupons.length" class="mt-3">
            <div class="label">คูปองส่วนลดที่ใช้ได้</div>
            <div class="flex flex-wrap gap-2">
              <button v-for="c in coupons" :key="c.id" type="button" class="chip chip-off" @click="doApplyCoupon(c)">
                <AppIcon name="plus" :size="14" /> {{ c.name }}
              </button>
            </div>
          </div>
        </section>

        <!-- การชำระเงิน -->
        <section class="card">
          <div class="mb-3 flex items-center justify-between gap-2">
            <div class="flex items-center gap-2 text-[15px] font-semibold text-stone-900"><AppIcon name="wallet" class="text-brand-600" /> การชำระเงิน</div>
            <div class="flex flex-wrap justify-end gap-2">
            <button
              v-if="can('reportPayment') && order.status !== 'draft' && order.status !== 'cancelled' && t.balance > 0"
              class="btn-soft h-9 px-3"
              @click="openPay('new')"
            ><AppIcon name="plus" :size="16" /> แจ้งยอดชำระ</button>
            <button
              v-if="can('confirmPayment') && order.status !== 'draft' && order.status !== 'cancelled' && t.balance > 0"
              class="btn-primary h-9 px-3"
              @click="openPay('direct')"
            ><AppIcon name="check" :size="16" /> รับชำระทันที</button>
            </div>
          </div>
          <p v-if="!order.payments.length" class="rounded-xl bg-stone-50 p-3 text-center text-sm text-stone-500">ยังไม่มีการชำระ</p>
          <ul class="space-y-2">
            <li v-for="(p, i) in order.payments" :key="p.id" class="rounded-xl border border-stone-200/70 p-3" :class="p.status === 'cancelled' ? 'opacity-60' : ''">
              <div class="flex items-center justify-between gap-2">
                <span class="font-semibold text-stone-900">งวด {{ i + 1 }} · {{ money(p.status === 'confirmed' ? p.amount : (p.requested ?? p.amount)) }}</span>
                <span class="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold" :class="PAY_BADGE[p.status]?.cls">
                  <AppIcon v-if="p.status === 'confirmed'" name="check" :size="12" />
                  {{ PAY_BADGE[p.status]?.t }}
                </span>
              </div>
              <div v-if="p.status === 'confirmed' && p.requested != null && p.requested !== p.amount" class="text-xs text-stone-500">แจ้งไป {{ money(p.requested) }} · ได้รับจริง {{ money(p.amount) }}</div>
              <div v-if="p.customerSubmitted && p.status === 'reported'" class="mt-1 inline-flex items-center rounded-full bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-700">ลูกค้าแจ้งโอนเอง · รอตรวจสลิป{{ p.source === 'customer' ? '' : ' (ตามที่ร้านแจ้ง)' }}</div>
              <div v-if="dueState(p) !== 'none'" class="mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold" :class="dueState(p) === 'overdue' ? 'bg-rose-50 text-rose-600' : 'bg-amber-50 text-amber-700'">
                <AppIcon name="alert" :size="12" /> ชำระก่อน {{ dateTime(p.dueAt) }} · {{ remainingText(p) }}
              </div>
              <div v-if="p.extension?.status === 'pending' && p.status === 'reported'" class="mt-2 rounded-lg bg-amber-50 p-2.5 text-sm text-amber-800">
                ลูกค้าขอขยายเวลา<span v-if="p.extension.note"> · {{ p.extension.note }}</span>
                <div v-if="can('reportPayment')" class="mt-2 flex gap-2">
                  <button class="btn-primary h-9 flex-1 px-3" @click="openExt(p)">ขยายเวลา</button>
                  <button class="btn-outline h-9 px-3" @click="doDenyExt(p)">ไม่อนุมัติ</button>
                </div>
              </div>
              <div v-else-if="p.status === 'reported' && p.dueAt && can('reportPayment') && order.status !== 'cancelled'" class="mt-1"><button class="text-xs text-brand-700 underline" @click="openExt(p)">เปลี่ยนกำหนดชำระ</button></div>
              <div class="mt-0.5 text-sm text-stone-500">{{ p.method }} · {{ dateTime(p.paidAt) }}</div>
              <div v-if="p.note" class="text-sm break-words text-stone-500">{{ p.note }}</div>
              <a v-if="p.slip" :href="p.slip" target="_blank" class="mt-2 block"><img :src="p.slip" class="h-24 w-auto rounded-lg object-cover" /></a>
              <div v-if="p.status === 'confirmed' && !closed && can('cancelConfirmedPayment')" class="mt-2.5 flex justify-end">
                <button class="btn-danger h-9 px-3" @click="doCancelConfirmed(p)"><AppIcon name="x" :size="16" /> ยกเลิกยอด</button>
              </div>
              <div v-if="p.status === 'reported' && order.status !== 'cancelled'" class="mt-2.5 flex flex-wrap gap-2">
                <button v-if="can('reportPayment')" class="btn-outline h-9 px-3" @click="openPay('edit', p)"><AppIcon name="edit" :size="16" /> แก้ยอด</button>
                <button v-if="can('reportPayment')" class="btn-danger h-9 px-3" @click="doCancelRequest(p)"><AppIcon name="x" :size="16" /> ยกเลิก</button>
                <button v-if="can('confirmPayment')" class="btn-primary h-9 flex-1 px-3" @click="openPay('confirm', p)"><AppIcon name="check" :size="16" /> ยืนยันยอดชำระ</button>
              </div>
            </li>
          </ul>
        </section>

        <!-- ข้อความที่ส่ง (จำลอง) -->
        <section v-if="messages.length && can('manage')" class="card">
          <div class="card-title"><AppIcon name="phone" class="text-brand-600" /> ข้อความแจ้งเตือน <span class="text-xs font-normal text-stone-400">จำลอง · ยังไม่ส่งจริง</span></div>
          <ul class="space-y-2">
            <li v-for="m in messages" :key="m.id" class="rounded-xl bg-stone-50 p-2.5">
              <div class="flex flex-wrap items-center gap-1.5 text-xs">
                <span class="rounded-full px-2 py-0.5 font-semibold" :class="m.channel ? 'bg-brand-50 text-brand-800' : 'bg-rose-50 text-rose-600'">{{ m.channel ? CHANNELS[m.channel].label : 'ไม่มีช่องทาง' }}</span>
                <span class="text-stone-600">{{ NOTIFY_EVENTS[m.event]?.label }}</span>
                <span class="ml-auto text-stone-400">{{ dateTime(m.at) }}</span>
              </div>
              <div class="mt-1 text-sm break-words text-stone-800">{{ m.text }}</div>
            </li>
          </ul>
        </section>

        <!-- ประวัติ (มือถือ) -->
        <section class="card lg:hidden">
          <div class="card-title"><AppIcon name="history" class="text-brand-600" /> ประวัติ</div>
          <ol class="relative space-y-3 border-l-2 border-stone-100 pl-4">
            <li v-for="(h, i) in order.history.slice().reverse()" :key="i" class="relative">
              <span class="absolute top-1.5 -left-[21px] h-2.5 w-2.5 rounded-full ring-4 ring-white" :class="i === 0 ? 'bg-brand-500' : 'bg-stone-300'" />
              <div class="text-sm break-words text-stone-800">{{ h.text }}</div>
              <div class="text-xs text-stone-400">{{ dateTime(h.at) }} · {{ ROLES[h.by] }}</div>
            </li>
          </ol>
        </section>
      </div>
    </div>

    <!-- ปุ่มเปลี่ยนสถานะ: มือถือติดล่าง / คอมอยู่ท้ายหน้า -->
    <div v-if="hasActions" class="action-bar lg:static lg:mt-4 lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none">
      <p v-if="shipAction === 'deliver' && t.balance > 0" class="mx-auto mb-2 flex max-w-5xl items-center gap-1.5 text-sm font-medium text-amber-700">
        <AppIcon name="alert" :size="16" /> ยังค้างชำระ {{ money(t.balance) }} ส่งมอบไม่ได้
      </p>
      <div class="mx-auto flex max-w-5xl gap-2">
        <button v-if="canRevertUi" class="btn-outline px-3 sm:px-4" aria-label="ย้อนสถานะ" @click="openRevert"><AppIcon name="back" :size="16" /> <span class="hidden sm:inline">ย้อนสถานะ</span></button>
        <button v-if="can('cancel') && !closed" class="btn-danger px-3 sm:px-4" @click="openCancel">
          <AppIcon name="x" :size="16" /> <span :class="primaryAction ? 'hidden sm:inline' : ''">ยกเลิกออร์เดอร์</span>
        </button>
        <button
          v-if="order.status === 'draft' && can('sendToPayment')"
          class="btn-primary flex-1 sm:ml-auto sm:flex-none sm:px-8"
          @click="doStatus('awaiting_payment', 'ส่งไปรอชำระ', 'ส่งไปรอชำระ')"
        >ส่งไปรอชำระ</button>
        <button
          v-if="unpaidStage(order.status) && can('confirmUnpaid')"
          class="btn-outline flex-1 sm:ml-auto sm:flex-none sm:px-6"
          @click="doConfirmUnpaid"
        >ยืนยันสั่งซื้อ (ยังไม่ชำระ)</button>
        <button
          v-else-if="unpaidStage(order.status) && can('requestConfirmUnpaid') && order.approval?.status !== 'pending'"
          class="btn-outline flex-1 sm:ml-auto sm:flex-none sm:px-6"
          @click="doRequestUnpaid"
        >ขออนุมัติยืนยัน (ยังไม่ชำระ)</button>
        <button
          v-if="startable(order.status) && can('startPreparing')"
          class="btn-primary flex-1 sm:ml-auto sm:flex-none sm:px-8"
          @click="doStatus('preparing', 'เริ่มเตรียมสินค้า', 'เริ่มเตรียมสินค้า')"
        >เริ่มเตรียมสินค้า</button>
        <button
          v-if="order.status === 'preparing' && can('markPrepared')"
          class="btn-primary flex-1 sm:ml-auto sm:flex-none sm:px-8"
          @click="doStatus('prepared', 'เตรียมสินค้าเสร็จแล้ว', 'เตรียมสินค้าเสร็จแล้ว')"
        ><AppIcon name="check" :size="18" /> เตรียมสินค้าเสร็จ</button>
        <button
          v-if="shipAction === 'ready'"
          class="btn-primary flex-1 sm:ml-auto sm:flex-none sm:px-8"
          @click="doStatus('ready_to_ship', 'พร้อมจัดส่ง', 'พร้อมจัดส่ง')"
        ><AppIcon name="truck" :size="18" /> พร้อมจัดส่ง</button>
        <button
          v-if="shipAction === 'ship'"
          class="btn-primary flex-1 sm:ml-auto sm:flex-none sm:px-8"
          @click="doStatus('shipping', 'เริ่มจัดส่ง (กำลังจัดส่ง)', 'กำลังจัดส่ง')"
        ><AppIcon name="truck" :size="18" /> เริ่มจัดส่ง</button>
        <button
          v-if="shipAction === 'deliver'"
          class="btn-primary flex-1 sm:ml-auto sm:flex-none sm:px-8"
          :disabled="t.balance > 0"
          @click="doStatus('delivered', 'ส่งมอบแล้ว', 'ส่งมอบแล้ว')"
        ><AppIcon name="check" :size="18" /> ส่งมอบแล้ว</button>
      </div>
    </div>

    <AppModal v-if="rv.open" title="ย้อนสถานะ" @close="rv.open = false">
      <div class="space-y-3 text-sm">
        <p class="rounded-xl bg-amber-50 p-3 text-amber-800">จะย้อนจาก <b>{{ STATUS[order.status]?.label }}</b> → <b>{{ STATUS[revTo]?.label }}</b></p>
        <ul class="list-disc space-y-1 pl-5 text-xs text-stone-600">
          <li v-if="order.status === 'delivered'">ถอนคะแนน/สิทธิ์หมุนที่ให้ตอนส่งมอบ และกลับรายการรับรู้รายได้ในบัญชี</li>
          <li v-if="order.status === 'payment_confirmed'">ยกเลิกยอดที่ยืนยันล่าสุด</li>
          <li v-if="order.status === 'payment_reported'">ยกเลิกยอดที่แจ้งลูกค้าไว้</li>
          <li v-if="order.status === 'cancelled'">ยกเลิกการยกเลิก (เฉพาะที่ไม่มีเงินคืน/ไม่ใช้คะแนน-คูปอง)</li>
          <li>ไม่ส่งข้อความถึงลูกค้า · บันทึกประวัติพร้อมเหตุผล</li>
        </ul>
        <div><label class="label">เหตุผล <span class="text-rose-500">*</span></label><input v-model="rv.reason" class="input" maxlength="200" aria-label="เหตุผลย้อนสถานะ" /></div>
        <p v-if="rv.error" class="text-rose-600" role="alert">{{ rv.error }}</p>
      </div>
      <template #footer>
        <button class="btn-outline flex-1 sm:flex-none" @click="rv.open = false">ไม่ย้อน</button>
        <button class="btn-primary flex-1 sm:flex-none" @click="saveRevert">ย้อนสถานะ</button>
      </template>
    </AppModal>

    <!-- modal ใช้คะแนน -->
    <AppModal v-if="ptOpen" title="ใช้คะแนนเป็นส่วนลด" @close="ptOpen = false">
      <div class="space-y-4">
        <div class="rounded-xl bg-brand-50 p-3 text-sm text-brand-800">มี {{ points }} คะแนน · 1 คะแนน = {{ money(db.loyalty.pointValue) }} · ใช้ได้สูงสุด {{ ptMax }} คะแนน</div>
        <div><label class="label">จำนวนคะแนน</label><input v-model.number="ptUse" type="text" v-num min="1" :max="ptMax" class="input text-lg font-semibold" /></div>
        <div class="text-sm text-stone-600">ลด {{ money((Number(ptUse) || 0) * db.loyalty.pointValue) }}</div>
        <p v-if="ptError" class="text-sm text-rose-600">{{ ptError }}</p>
      </div>
      <template #footer>
        <button class="btn-outline flex-1 sm:flex-none" @click="ptOpen = false">ยกเลิก</button>
        <button class="btn-primary flex-1 sm:flex-none" @click="savePoints">ใช้คะแนน</button>
      </template>
    </AppModal>

    <!-- modal แจ้งยอด / แก้ยอด / ยืนยันยอดจริง -->
    <AppModal v-if="dvOpen" title="ข้อมูลจัดส่ง" @close="dvOpen = false">
      <DeliveryFields :form="dv" :customer-id="order.customerId" />
      <p v-if="dvError" class="mt-3 text-sm text-rose-600">{{ dvError }}</p>
      <template #footer>
        <button class="btn-outline flex-1 sm:flex-none" @click="dvOpen = false">ยกเลิก</button>
        <button class="btn-primary flex-1 sm:flex-none" @click="saveDelivery">บันทึก</button>
      </template>
    </AppModal>

    <AppModal v-if="extFor" title="ขยายเวลาชำระ" @close="extFor = null">
      <div class="space-y-4">
        <div class="flex flex-wrap gap-2">
          <button v-for="q in QUICK_DUE" :key="q.m" type="button" class="chip chip-off" @click="extAt = quickDue(q.m)">อีก {{ q.label }}</button>
        </div>
        <div><label class="label">ต้องชำระก่อน</label><input v-model="extAt" type="datetime-local" class="input" /></div>
      </div>
      <template #footer>
        <button class="btn-outline flex-1 sm:flex-none" @click="extFor = null">ยกเลิก</button>
        <button class="btn-primary flex-1 sm:flex-none" @click="saveExt">ขยายเวลา</button>
      </template>
    </AppModal>

    <AppModal v-if="payOpen" :title="PAY_TITLE[payMode]" @close="payOpen = false">
      <div class="space-y-4">
        <div v-if="payMode === 'confirm'" class="rounded-xl bg-sky-50 p-3 text-sm text-sky-800">
          ยอดที่แจ้งไป <b>{{ money(payTarget.requested ?? payTarget.amount) }}</b> · ใส่ยอดที่ได้รับจริง
        </div>
        <div v-else class="rounded-xl p-3 text-sm" :class="payMode === 'direct' ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'">
          <template v-if="payMode === 'direct'">ลูกค้าชำระแล้ว ไม่ต้องแจ้งยอด/กำหนดชำระ · </template>คงค้าง <b>{{ money(t.balance) }}</b><span v-if="t.reported"> · แจ้งยอดแล้ว {{ money(t.reported) }}</span>
        </div>
        <div><label class="label">{{ payMode === 'confirm' || payMode === 'direct' ? 'ยอดที่ได้รับจริง (บาท)' : 'ยอดที่แจ้งลูกค้า (บาท)' }}</label><input v-model.number="pay.amount" type="text" v-num.dec min="0" class="input text-lg font-semibold" /></div>
        <div v-if="showDeposit" class="flex flex-wrap gap-2">
          <button type="button" class="chip" :class="pay.amount === depositAmount ? 'chip-on' : 'chip-off'" @click="pay.amount = depositAmount">มัดจำ {{ db.shop.depositPercent }}% · {{ money(depositAmount) }}</button>
          <button type="button" class="chip" :class="pay.amount === fullAmount ? 'chip-on' : 'chip-off'" @click="pay.amount = fullAmount">เต็มจำนวน · {{ money(fullAmount) }}</button>
        </div>
        <div>
          <div class="label">ช่องทาง</div>
          <div class="flex flex-wrap gap-2">
            <button v-for="m in PAYMENT_METHODS" :key="m" type="button" class="chip" :class="pay.method === m ? 'chip-on' : 'chip-off'" @click="pay.method = m">{{ m }}</button>
          </div>
        </div>
        <label v-if="customer && order.channel !== 'pos' && payMode !== 'edit'" class="flex items-center gap-2 text-sm text-stone-700"><input v-model="pay.notify" type="checkbox" class="h-4 w-4" aria-label="แจ้งลูกค้า" /> {{ payMode === 'new' ? 'แจ้งยอดชำระให้ลูกค้าทราบ' : 'แจ้งลูกค้าว่าได้รับชำระแล้ว' }}</label>
        <div v-if="payMode === 'new' || payMode === 'edit'">
          <div class="label">ต้องชำระก่อน</div>
          <div class="mb-2 flex flex-wrap gap-2">
            <button v-for="q in QUICK_DUE" :key="q.m" type="button" class="chip chip-off" @click="pay.dueAt = quickDue(q.m)">{{ q.label }}</button>
          </div>
          <div class="mb-1 text-xs text-stone-500">ก่อนเวลานัด</div>
          <div class="mb-2 flex flex-wrap items-center gap-2">
            <button v-for="o in beforeOpts" :key="o.h" type="button" class="chip" :class="[o.disabled ? 'chip-off cursor-not-allowed opacity-40' : 'chip-off']" :disabled="o.disabled" :aria-label="`ก่อนนัด ${o.h} ชั่วโมง`" @click="pay.dueAt = o.dueAt">{{ o.h }} ชม.</button>
            <span class="flex items-center gap-1">
              <input v-model.number="dueHours" type="text" v-num min="1" max="720" class="input h-9 w-16 px-2 text-center" aria-label="ชั่วโมงก่อนนัด" />
              <button type="button" class="chip chip-off" :class="beforeCustom.disabled ? 'cursor-not-allowed opacity-40' : ''" :disabled="beforeCustom.disabled" @click="pay.dueAt = beforeCustom.dueAt">ชม. ก่อนนัด</button>
            </span>
          </div>
          <div class="mb-1 text-xs text-stone-500">ล่วงหน้า ก่อนเวลา</div>
          <div class="mb-2 flex flex-wrap items-center gap-2">
            <button v-for="o in daysOpts" :key="o.d" type="button" class="chip chip-off" :class="o.disabled ? 'cursor-not-allowed opacity-40' : ''" :disabled="o.disabled" :aria-label="`ล่วงหน้า ${o.d} วัน ก่อน ${dueTime}`" @click="pay.dueAt = o.dueAt">{{ o.d }} วัน ก่อน {{ dueTime }}</button>
            <span class="flex items-center gap-1">
              <input v-model.number="dueDays" type="text" v-num min="0" max="30" class="input h-9 w-14 px-2 text-center" aria-label="จำนวนวันล่วงหน้า" />
              <span class="text-xs text-stone-500">วัน ก่อน</span>
              <input v-model="dueTime" type="time" class="input h-9 w-28 px-2" aria-label="เวลาก่อน" />
              <button type="button" class="chip chip-off" :class="daysCustom.disabled ? 'cursor-not-allowed opacity-40' : ''" :disabled="daysCustom.disabled" @click="pay.dueAt = daysCustom.dueAt">ตั้ง</button>
            </span>
          </div>
          <p v-for="(r, i) in dueReasons" :key="i" class="mb-1 text-xs text-rose-600">{{ r }}</p>
          <input v-model="pay.dueAt" type="datetime-local" class="input" aria-label="กำหนดชำระ" />
        </div>
        <div><label class="label">วันเวลาที่ชำระ</label><input v-model="pay.paidAt" type="datetime-local" class="input" /></div>
        <div>
          <div class="label">สลิป <span class="font-normal text-stone-400">(ไม่บังคับ)</span></div>
          <label class="flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed border-stone-200 p-3 text-sm text-stone-500 hover:border-brand-300">
            <img v-if="pay.slip" :src="pay.slip" class="h-14 w-14 rounded-lg object-cover" />
            <AppIcon v-else name="image" :size="22" />
            <span>{{ pay.slip ? 'เปลี่ยนรูปสลิป' : 'แนบรูปสลิป' }}</span>
            <input type="file" accept="image/*" class="hidden" @change="onSlip" />
          </label>
        </div>
        <div><label class="label">หมายเหตุ</label><input v-model="pay.note" class="input" /></div>
        <p v-if="payError" class="text-sm text-rose-600">{{ payError }}</p>
      </div>
      <template #footer>
        <button class="btn-outline flex-1 sm:flex-none" @click="payOpen = false">ยกเลิก</button>
        <button class="btn-primary flex-1 sm:flex-none" @click="savePay">{{ payMode === 'confirm' || payMode === 'direct' ? 'ยืนยัน' : 'บันทึก' }}</button>
      </template>
    </AppModal>

    <!-- modal ปรับราคา -->
    <AppModal v-if="adjOpen" title="ปรับราคา / ส่วนลด" @close="adjOpen = false">
      <div class="space-y-4">
        <div>
          <div class="mb-3 grid grid-cols-2 gap-1 seg-grid">
            <button
              v-for="k in [{ v: -1, l: 'ส่วนลด' }, { v: 1, l: 'เพิ่มราคา' }]"
              :key="k.v"
              type="button"
              class="h-9 rounded-lg text-sm font-medium transition"
              :class="adj.sign === k.v ? 'bg-white text-brand-800 shadow-sm' : 'text-stone-600'"
              @click="adj.sign = k.v"
            >{{ k.l }}</button>
          </div>
          <label class="label">จำนวนเงิน (บาท)</label>
          <input v-model.number="adj.amount" type="text" v-num.dec class="input text-lg font-semibold" />
        </div>
        <div><label class="label">เหตุผล <span class="text-rose-500">*</span></label><input v-model="adj.reason" class="input" /></div>
        <p v-if="adjError" class="text-sm text-rose-600">{{ adjError }}</p>
      </div>
      <template #footer>
        <button class="btn-outline flex-1 sm:flex-none" @click="adjOpen = false">ยกเลิก</button>
        <button class="btn-primary flex-1 sm:flex-none" @click="saveAdj">บันทึก</button>
      </template>
    </AppModal>

    <!-- modal ยกเลิก -->
    <AppModal v-if="cancelOpen" title="ยกเลิกออร์เดอร์" @close="cancelOpen = false">
      <div class="space-y-4">
        <p v-if="invoiceOfOrder(order.id)" class="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">ออร์เดอร์นี้ออกใบกำกับภาษีไว้แล้ว ({{ invoiceOfOrder(order.id).no }}) · เมื่อยกเลิกระบบจะออกใบลดหนี้ให้อัตโนมัติ</p>
        <div><label class="label">เหตุผล <span class="text-rose-500">*</span></label><textarea v-model="cxl.reason" rows="2" class="input" /></div>
        <div>
          <div class="label">คืนเงินให้ลูกค้า</div>
          <RefundEditor v-model="cxl.refunds" :paid="t.paid" :can-points="!!customer && !customer.deleted" :default-method="defaultRefundMethod(order.payments.filter((p) => p.status === 'confirmed').at(-1)?.method)" />
        </div>
        <div><label class="label">หมายเหตุการคืนเงิน</label><input v-model="cxl.refundNote" class="input" /></div>
        <label v-if="customer && order.channel !== 'pos'" class="flex items-center gap-2 text-sm text-stone-700"><input v-model="cxl.notify" type="checkbox" class="h-4 w-4" aria-label="แจ้งลูกค้าว่ายกเลิก" /> แจ้งลูกค้าว่ายกเลิกออร์เดอร์</label>
        <p v-if="cxlError" class="text-sm text-rose-600">{{ cxlError }}</p>
      </div>
      <template #footer>
        <button class="btn-outline flex-1 sm:flex-none" @click="cancelOpen = false">ปิด</button>
        <button class="btn flex-1 bg-rose-600 text-white hover:bg-rose-700 sm:flex-none" @click="saveCancel">ยืนยันยกเลิก</button>
      </template>
    </AppModal>
  </div>

  <ChangeBuyerModal v-if="buyerOpen && order" :order="order" @close="buyerOpen = false" />
  <OrderLinkModal v-if="linkOpen && order" :order="order" @close="linkOpen = false" />
  <TaxInvoiceModal v-if="taxOpen && order" :order="order" @close="taxOpen = false" />
  <ItemEditor v-if="editing" :item="editing.item || null" :price-date="orderDate(order)" @save="onSaveItem" @close="editing = null" />
  <PickupModal v-if="pickupOpen && order" :order="order" @close="pickupOpen = false" />
  <AppModal v-if="bdOpen" title="วันเกิด" @close="bdOpen = false">
    <BirthdayFields v-model="bd" />
    <p v-if="bdError" class="mt-3 text-sm text-rose-600">{{ bdError }}</p>
    <template #footer>
      <button v-if="order.birthday" class="btn-danger flex-1 sm:mr-auto sm:flex-none" @click="setBirthday(order, null); bdOpen = false">ลบ</button>
      <button class="btn-outline flex-1 sm:flex-none" @click="bdOpen = false">ยกเลิก</button>
      <button class="btn-primary flex-1 sm:flex-none" @click="saveBirthday">บันทึก</button>
    </template>
  </AppModal>
</template>
