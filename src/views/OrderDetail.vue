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
import { showToast } from '../lib/toast'
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
import RefundPartialDialog from '../components/RefundPartialDialog.vue'
import RefundCancelDialog from '../components/RefundCancelDialog.vue'
import OrderPayModal from '../components/OrderPayModal.vue'
import PayExtendModal from '../components/PayExtendModal.vue'
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
const msgOpen = ref(false) // ซ่อนไว้ก่อน กดแสดงเมื่ออยากดู
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

// ---------- แจ้งยอดชำระ / แก้ยอดที่แจ้ง / ยืนยันยอดจริง / รับชำระทันที (โมดัลอยู่ที่ OrderPayModal) ----------
const payOpen = ref(false)
const payMode = ref('new') // new | edit | confirm | direct
const payTarget = ref(null)
function openPay(mode = 'new', p = null) {
  payMode.value = mode
  payTarget.value = p
  payOpen.value = true
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
  if (r.ok) { setStatus(order.value, status, text, { notify: tells ? r.checked : true }); showToast(`${title} แล้ว · ${order.value.code}`) }
}
async function doConfirmUnpaid() {
  const r = await askConfirmEx({ title: 'ยืนยันการสั่งซื้อ (ยังไม่ชำระ)', message: `ออร์เดอร์ ${order.value.code} · คงค้าง ${money(t.value.balance)} ชำระได้ภายหลัง`, okText: 'ยืนยัน', checkbox: { label: 'แจ้งลูกค้า', value: true } })
  if (r.ok) { confirmUnpaid(order.value, { notify: r.checked }); showToast(`ยืนยันสั่งซื้อ ${order.value.code} แล้ว (ยังไม่ชำระ)`) }
}
async function doRequestUnpaid() {
  if (await askConfirm({ title: 'ขออนุมัติยืนยันการสั่งซื้อ', message: 'ส่งคำขอให้แอดมินอนุมัติ (ยังไม่ชำระ)', okText: 'ส่งคำขอ' })) requestConfirmUnpaid(order.value)
}
async function doRejectUnpaid() {
  if (await askConfirm({ title: 'ไม่อนุมัติ', message: `ปฏิเสธคำขอยืนยันของ ${order.value.code}`, okText: 'ไม่อนุมัติ', danger: true })) rejectConfirmUnpaid(order.value)
}
// ---------- ขยายเวลาชำระ (โมดัลอยู่ที่ PayExtendModal) ----------
const extFor = ref(null) // งวดที่กำลังขยาย
const openExt = (p) => { extFor.value = p }
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
// คืนเงินบางส่วนโดยไม่ยกเลิก (ออร์เดอร์: refundPartial · บิล POS: posVoid)
const refundOpen = ref(false)
const rcFor = ref(null) // รายการคืนที่กำลังจะยกเลิก
const canCancelRefund = computed(() => !!order.value && can(order.value.channel === 'pos' ? 'posVoid' : 'refundPartial') && order.value.status !== 'cancelled')
const canRefund = computed(() => !!order.value && can(order.value.channel === 'pos' ? 'posVoid' : 'refundPartial') && !['draft', 'cancelled'].includes(order.value.status) && t.value.paidNet > 0)
const returnedNet = computed(() => (t.value.total > 0 ? Math.round(t.value.returned * (1 - t.value.vat / t.value.total) * 100) / 100 : t.value.returned))
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
  Object.assign(cxl, { reason: '', refunds: t.value.paidNet > 0 ? [{ method: defaultRefundMethod(last?.method), amount: t.value.paidNet }] : [], refundNote: '', notify: true })
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

  <div v-else :class="hasActions ? 'pb-[calc(env(safe-area-inset-bottom)+6rem)]' : ''">
    <!-- หัว -->
    <div class="mb-4 flex items-center gap-2">
      <RouterLink to="/admin/orders" class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-stone-700 shadow-sm ring-1 ring-stone-200/70" aria-label="กลับ">
        <AppIcon name="back" :size="20" />
      </RouterLink>
      <div class="min-w-0 flex-1">
        <h1 class="page-title truncate">{{ order.code }}</h1>
      </div>
      <span v-if="customerPending(order).length" class="inline-flex shrink-0 items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-xs font-semibold whitespace-nowrap text-sky-700">ลูกค้าแจ้งโอน รอตรวจสลิป</span>
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

    <div class="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-4 2xl:grid-cols-[minmax(0,1fr)_440px]">
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
              <button v-else-if="canEditBirthday" class="mt-1 text-sm text-brand-700 underline lg:py-1.5" @click="openBirthday">+ เพิ่มวันเกิด</button>
              <button v-if="can('changeBuyer') && order.status !== 'cancelled'" class="mt-1 block text-sm text-brand-700 underline lg:py-1.5" @click="buyerOpen = true">เปลี่ยนผู้ซื้อ</button>
              <button v-if="can('createOrder') && order.status !== 'draft' && order.channel !== 'pos'" class="mt-1 block text-sm text-brand-700 underline lg:py-1.5" @click="linkOpen = true">ส่งลิงก์ให้ลูกค้า</button>
              <button v-if="can('taxInvoice') && t.vatMode && order.status !== 'draft' && order.status !== 'cancelled'" class="mt-1 block text-sm text-brand-700 underline lg:py-1.5" @click="taxOpen = true">ใบกำกับภาษีเต็มรูป</button>
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
              <button v-if="canEditDelivery" class="mt-1 block text-sm text-brand-700 underline lg:py-1.5" @click="openDelivery">แก้ข้อมูลจัดส่ง</button>
              <div class="mt-1.5 text-xs text-stone-400">วันเดียวกันมีอีก {{ load.day }} · ชั่วโมงเดียวกัน {{ load.hour }}</div>
            </div>
            <button v-if="canEditPickup" class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700" aria-label="แก้วันเวลานัด" @click="pickupOpen = true"><AppIcon name="edit" /></button>
          </div>
        </section>

        <!-- สินค้า -->
        <section class="card">
          <div class="card-title"><AppIcon name="cake" class="text-brand-600" /> สินค้า <span class="font-normal text-stone-400">{{ order.items.length }}</span></div>
          <div class="space-y-4">
            <div v-for="(it, n) in order.items" :key="it.id" role="group" :aria-label="`รายการที่ ${n + 1} ${it.name}`" data-item-box class="overflow-hidden rounded-2xl border border-l-[6px] border-stone-300 bg-white shadow-sm" :class="it.promoGift ? 'border-l-emerald-600' : it.kind === 'custom' ? 'border-l-brand-500' : 'border-l-amber-500'">
              <ItemCard :item="it" :index="n + 1" bare>
                <template v-if="can('editItems') && !it.promoGift">
                  <button class="btn-outline h-9 px-3" @click="editing = { item: it }"><AppIcon name="edit" :size="16" /> แก้ไข</button>
                  <button v-if="order.items.filter((x) => !x.promoGift).length > 1" class="btn-danger h-9 px-3" @click="doRemoveItem(it)"><AppIcon name="trash" :size="16" /> ลบ</button>
                </template>
              </ItemCard>
              <div v-if="!it.promoGift" class="empty:hidden border-t border-stone-200 bg-stone-50 px-3 pb-3"><WorkPhotos :order="order" :item="it" /></div>
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
            <div v-if="t.returned" class="mt-2 rounded-xl bg-rose-50 p-2.5 text-sm text-rose-700">คืนเงินแล้ว −{{ money(t.returned) }} · ชำระสุทธิ {{ money(t.paidNet) }}</div>
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
            <div v-if="t.returned" class="flex justify-between gap-2"><dt class="text-stone-500">คืนเงินบางส่วน (ก่อน VAT)</dt><dd class="text-rose-600">−{{ money(returnedNet) }}</dd></div>
            <div class="flex justify-between gap-2 font-semibold"><dt>กำไร <span v-if="t.vatMode" class="text-xs font-normal text-stone-400">(ก่อน VAT)</span></dt><dd :class="t.beforeVat - cost - returnedNet >= 0 ? 'text-emerald-700' : 'text-rose-600'">{{ money(t.beforeVat - cost - returnedNet) }}</dd></div>
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
              class="btn-soft h-9 px-3" title="ส่งยอดให้ลูกค้าโอน (ยังไม่ได้รับเงิน)"
              @click="openPay('new')"
            ><AppIcon name="plus" :size="16" /> แจ้งยอดชำระ</button>
            <button
              v-if="can('confirmPayment') && order.status !== 'draft' && order.status !== 'cancelled' && t.balance > 0"
              class="btn-primary h-9 px-3" title="ลูกค้าจ่ายแล้วที่ร้าน/โอนแล้ว บันทึกยอดที่ได้รับจริง"
              @click="openPay('direct')"
            ><AppIcon name="check" :size="16" /> รับชำระทันที</button>
            <button v-if="canRefund" class="btn-outline h-9 px-3" @click="refundOpen = true"><AppIcon name="wallet" :size="16" /> คืนเงิน</button>
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
              <div v-if="dueState(p) !== 'none'" class="mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold" :class="dueState(p) === 'overdue' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700'">
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
              <div v-if="p.status === 'confirmed' && !closed && !t.returned && can('cancelConfirmedPayment')" class="mt-2.5 flex justify-end">
                <button class="btn-danger h-9 px-3" @click="doCancelConfirmed(p)"><AppIcon name="x" :size="16" /> ยกเลิกยอด</button>
              </div>
              <div v-if="p.status === 'reported' && order.status !== 'cancelled'" class="mt-2.5 flex flex-wrap gap-2">
                <button v-if="can('reportPayment')" class="btn-outline h-9 px-3" @click="openPay('edit', p)"><AppIcon name="edit" :size="16" /> แก้ยอด</button>
                <button v-if="can('reportPayment')" class="btn-danger h-9 px-3" @click="doCancelRequest(p)"><AppIcon name="x" :size="16" /> ยกเลิก</button>
                <button v-if="can('confirmPayment')" class="btn-primary h-9 flex-1 px-3" @click="openPay('confirm', p)"><AppIcon name="check" :size="16" /> ยืนยันยอดชำระ</button>
              </div>
            </li>
          </ul>
          <div v-if="order.returns?.length" class="mt-3 space-y-2" aria-label="รายการคืนเงิน">
            <div class="text-xs font-semibold text-stone-500">คืนเงินแล้ว</div>
            <div v-for="r in order.returns" :key="r.id" class="rounded-xl border p-3 text-sm" :class="r.cancelled ? 'border-stone-200 bg-stone-50' : 'border-rose-200 bg-rose-50/60'" data-return>
              <div class="flex items-center justify-between gap-2"><span class="font-semibold" :class="r.cancelled ? 'text-stone-400 line-through' : 'text-rose-700'">−{{ money(r.amount) }}</span><span class="text-xs text-stone-500">{{ dateTime(r.at) }} · {{ ROLES[r.by] }}</span></div>
              <div v-for="(x, i) in refundList({ refunds: r.refunds })" :key="i" class="text-stone-700">{{ x.label }} {{ money(x.amount) }}<template v-if="x.points != null"> ({{ x.points }} คะแนน)</template></div>
              <div class="break-words text-stone-600">เหตุผล: {{ r.reason }}<template v-if="r.note"> · {{ r.note }}</template></div>
              <div v-if="r.cancelled" class="mt-1 break-words text-xs text-stone-500"><span class="rounded-full bg-stone-200 px-2 py-0.5 font-semibold text-stone-600">ยกเลิกแล้ว</span> {{ dateTime(r.cancelled.at) }} · {{ ROLES[r.cancelled.by] }} · {{ r.cancelled.reason }}</div>
              <button v-else-if="canCancelRefund" type="button" class="btn-outline mt-2 h-9 px-3" @click="rcFor = r"><AppIcon name="x" :size="16" /> ยกเลิกการคืน</button>
            </div>
          </div>
        </section>

        <!-- ข้อความที่ส่ง (จำลอง) -->
        <section v-if="messages.length && can('manage')" class="card">
          <button type="button" class="card-title mb-0 w-full text-left" :aria-expanded="msgOpen" aria-controls="order-messages" @click="msgOpen = !msgOpen">
            <AppIcon name="phone" class="text-brand-600" /> ข้อความแจ้งเตือน <span class="font-normal text-stone-400">{{ messages.length }}</span> <span class="text-xs font-normal text-stone-400">จำลอง · ยังไม่ส่งจริง</span>
            <span class="ml-auto inline-flex items-center gap-1 text-sm font-medium text-brand-700">{{ msgOpen ? 'ซ่อน' : 'แสดง' }} <AppIcon name="next" :size="14" class="transition" :class="msgOpen ? 'rotate-90' : ''" /></span>
          </button>
          <ul v-show="msgOpen" id="order-messages" class="mt-3 space-y-2">
            <li v-for="m in messages" :key="m.id" class="rounded-xl bg-stone-50 p-2.5">
              <div class="flex flex-wrap items-center gap-1.5 text-xs">
                <span class="rounded-full px-2 py-0.5 font-semibold" :class="m.channel ? 'bg-brand-50 text-brand-800' : 'bg-rose-50 text-rose-700'">{{ m.channel ? CHANNELS[m.channel].label : 'ไม่มีช่องทาง' }}</span>
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
    <div v-if="hasActions" class="action-bar">
      <p v-if="shipAction === 'deliver' && t.balance > 0" class="mx-auto mb-2 flex max-w-page items-center gap-1.5 text-sm font-medium text-amber-700">
        <AppIcon name="alert" :size="16" /> ยังค้างชำระ {{ money(t.balance) }} ส่งมอบไม่ได้
      </p>
      <div class="mx-auto flex max-w-page gap-2 lg:px-4">
        <button v-if="canRevertUi" class="btn-outline px-3 sm:px-4" aria-label="ย้อนสถานะ" title="กลับไปสถานะก่อนหน้า" @click="openRevert"><AppIcon name="back" :size="16" /> <span class="hidden sm:inline">ย้อนสถานะ</span></button>
        <button v-if="can('cancel') && !closed" class="btn-danger px-3 sm:px-4" aria-label="ยกเลิกออร์เดอร์" @click="openCancel">
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

    <OrderPayModal v-if="payOpen" :order="order" :mode="payMode" :target="payTarget" @close="payOpen = false" />
    <PayExtendModal v-if="extFor" :order="order" :payment="extFor" @close="extFor = null" />

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
          <RefundEditor v-model="cxl.refunds" :paid="t.paidNet":can-points="!!customer && !customer.deleted" :default-method="defaultRefundMethod(order.payments.filter((p) => p.status === 'confirmed').at(-1)?.method)" />
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

  <RefundPartialDialog v-if="refundOpen && order" :order="order" @close="refundOpen = false" />
  <RefundCancelDialog v-if="rcFor && order" :order="order" :entry="rcFor" @close="rcFor = null" />
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
