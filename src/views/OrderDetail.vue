<script setup>
import { computed, reactive, ref } from 'vue'
import {
  can, findOrder, findCustomer, setStatus, reportPayment, confirmPayment, setAdjustment, cancelOrder, countPickups,
  updatePaymentRequest, cancelPaymentRequest,
  saveOrderItem, removeOrderItem, orderDate,
  db, customerPoints, usableDiscountCoupons, applyPoints, removePoints, applyCoupon, removeCoupon,
} from '../data/store'
import { orderTotals } from '../lib/pricing'
import { askConfirm } from '../lib/confirm'
import { money, dateTime, toDateStr, pad } from '../lib/format'
import { PAYMENT_METHODS, ROLES } from '../lib/constants'
import StatusBadge from '../components/StatusBadge.vue'
import ItemCard from '../components/ItemCard.vue'
import ItemEditor from '../components/ItemEditor.vue'
import AppModal from '../components/AppModal.vue'
import AppIcon from '../components/AppIcon.vue'

const props = defineProps({ id: { type: String, required: true } })
const order = computed(() => findOrder(props.id))
const customer = computed(() => order.value && findCustomer(order.value.customerId))
const t = computed(() => orderTotals(order.value))
const load = computed(() => countPickups(order.value.pickupAt, order.value.id))
const closed = computed(() => ['delivered', 'cancelled'].includes(order.value.status))

const canDeliver = computed(() =>
  order.value.fulfillment === 'delivery' ? can('deliverShipping') : can('deliverPickup'),
)

const primaryAction = computed(() => {
  const s = order.value.status
  return (s === 'draft' && can('sendToPayment'))
    || (s === 'payment_confirmed' && can('startPreparing'))
    || (s === 'preparing' && canDeliver.value)
})

const hasActions = computed(() => {
  const s = order.value.status
  return (can('cancel') && !closed.value)
    || (s === 'draft' && can('sendToPayment'))
    || (s === 'payment_confirmed' && can('startPreparing'))
    || (s === 'preparing' && canDeliver.value)
})

const paidPct = computed(() => (t.value.total > 0 ? Math.min(100, Math.round((t.value.paid / t.value.total) * 100)) : 0))
const initial = (n) => (n || '').replace(/^คุณ/, '').trim().charAt(0)

const nowLocal = () => {
  const d = new Date()
  return `${toDateStr(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ---------- แจ้งยอดชำระ / แก้ยอดที่แจ้ง / ยืนยันยอดจริง ----------
const payOpen = ref(false)
const payMode = ref('new') // new | edit | confirm
const payTarget = ref(null)
const pay = reactive({ amount: 0, method: PAYMENT_METHODS[0], paidAt: '', slip: '', note: '' })
const payError = ref('')
const PAY_TITLE = { new: 'แจ้งยอดชำระ', edit: 'แก้ยอดที่แจ้ง', confirm: 'ยืนยันยอดชำระ' }
function openPay(mode = 'new', p = null) {
  payMode.value = mode
  payTarget.value = p
  Object.assign(pay, p
    ? { amount: p.requested ?? p.amount, method: p.method, paidAt: p.paidAt, slip: p.slip, note: p.note }
    : { amount: Math.max(t.value.balance - t.value.reported, 0), method: PAYMENT_METHODS[0], paidAt: nowLocal(), slip: '', note: '' })
  payError.value = ''
  payOpen.value = true
}
function onSlip(e) {
  const f = e.target.files[0]
  if (f) pay.slip = URL.createObjectURL(f)
}
async function savePay() {
  if (!(pay.amount > 0)) return (payError.value = 'กรอกยอดเงิน')
  if (payMode.value === 'confirm' && !(await askConfirm({ title: 'ยืนยันยอดชำระ', message: `ได้รับจริง ${money(pay.amount)}`, okText: 'ยืนยัน' }))) return
  if (payMode.value === 'confirm') confirmPayment(order.value, payTarget.value.id, { ...pay })
  else if (payMode.value === 'edit') updatePaymentRequest(order.value, payTarget.value.id, { ...pay })
  else reportPayment(order.value, { ...pay })
  payOpen.value = false
}
const PAY_BADGE = {
  reported: { t: 'รอลูกค้าชำระ', cls: 'bg-sky-50 text-sky-700' },
  confirmed: { t: 'ยืนยันแล้ว', cls: 'bg-emerald-50 text-emerald-700' },
  cancelled: { t: 'ยกเลิกแล้ว', cls: 'bg-stone-100 text-stone-500' },
}

// ---------- ปรับราคา ----------
const adjOpen = ref(false)
const adj = reactive({ amount: 0, reason: '' })
const adjError = ref('')
function openAdj() {
  Object.assign(adj, { amount: order.value.adjustment.amount, reason: order.value.adjustment.reason })
  adjError.value = ''
  adjOpen.value = true
}
function saveAdj() {
  if (!adj.reason.trim()) return (adjError.value = 'ใส่เหตุผล')
  setAdjustment(order.value, adj.amount, adj.reason.trim())
  adjOpen.value = false
}

// ---------- popup ยืนยัน ----------
async function doStatus(status, text, title) {
  if (await askConfirm({ title, message: `ออร์เดอร์ ${order.value.code}`, okText: title })) setStatus(order.value, status, text)
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
const cxl = reactive({ reason: '', refundAmount: 0, refundMethod: PAYMENT_METHODS[0], refundNote: '' })
const cxlError = ref('')
function openCancel() {
  Object.assign(cxl, { reason: '', refundAmount: t.value.paid, refundMethod: PAYMENT_METHODS[0], refundNote: '' })
  cxlError.value = ''
  cancelOpen.value = true
}
async function saveCancel() {
  if (!cxl.reason.trim()) return (cxlError.value = 'ใส่เหตุผลการยกเลิก')
  if (cxl.refundAmount < 0 || cxl.refundAmount > t.value.paid) return (cxlError.value = `คืนเงินได้ 0 – ${money(t.value.paid)}`)
  if (!(await askConfirm({ title: 'ยกเลิกออร์เดอร์', message: `ออร์เดอร์ ${order.value.code}\nเหตุผล: ${cxl.reason}`, okText: 'ยกเลิกออร์เดอร์', danger: true }))) return
  cancelOrder(order.value, cxl)
  cancelOpen.value = false
}
</script>

<template>
  <div v-if="!order" class="card flex flex-col items-center gap-3 py-12 text-center">
    <div class="font-semibold text-stone-800">ไม่พบออร์เดอร์</div>
    <RouterLink to="/orders" class="btn-soft">กลับไปหน้าออร์เดอร์</RouterLink>
  </div>

  <div v-else class="mx-auto max-w-5xl" :class="hasActions ? 'pb-[calc(env(safe-area-inset-bottom)+6rem)] lg:pb-0' : ''">
    <!-- หัว -->
    <div class="mb-4 flex items-center gap-2">
      <RouterLink to="/orders" class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-stone-700 shadow-sm ring-1 ring-stone-200/70" aria-label="กลับ">
        <AppIcon name="back" :size="20" />
      </RouterLink>
      <div class="min-w-0 flex-1">
        <h1 class="truncate text-xl font-bold tracking-tight text-stone-900">{{ order.code }}</h1>
      </div>
      <StatusBadge :status="order.status" />
    </div>

    <div class="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-4">
      <!-- ซ้าย -->
      <div class="min-w-0 space-y-3 lg:space-y-4">
        <!-- ลูกค้า + นัดรับ -->
        <section class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div class="card flex min-w-0 gap-3">
            <span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-600 text-lg font-bold text-white">{{ initial(customer?.name) }}</span>
            <div class="min-w-0 flex-1">
              <div class="text-xs text-stone-500">ลูกค้า</div>
              <div class="truncate font-semibold text-stone-900">{{ customer?.name }}</div>
              <div v-if="customer?.line" class="truncate text-sm text-stone-500">LINE {{ customer.line }}</div>
              <div v-if="customer?.note" class="mt-1 text-sm break-words text-stone-500">{{ customer.note }}</div>
            </div>
            <a
              v-if="customer?.phone"
              :href="`tel:${customer.phone}`"
              class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700"
              :aria-label="`โทร ${customer.phone}`"
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
                <span class="min-w-0 break-words">{{ order.address }}</span>
              </div>
              <div class="mt-1.5 text-xs text-stone-400">วันเดียวกันมีอีก {{ load.day }} · ชั่วโมงเดียวกัน {{ load.hour }}</div>
            </div>
          </div>
        </section>

        <!-- สินค้า -->
        <section class="card">
          <div class="card-title"><AppIcon name="cake" class="text-brand-600" /> สินค้า <span class="font-normal text-stone-400">{{ order.items.length }}</span></div>
          <div class="space-y-2.5">
            <ItemCard v-for="it in order.items" :key="it.id" :item="it" class="bg-stone-50/50">
              <template v-if="can('editItems')">
                <button class="btn-outline h-9 px-3" @click="editing = { item: it }"><AppIcon name="edit" :size="16" /> แก้ไข</button>
                <button v-if="order.items.length > 1" class="btn-danger h-9 px-3" @click="doRemoveItem(it)"><AppIcon name="trash" :size="16" /> ลบ</button>
              </template>
            </ItemCard>
          </div>
          <button v-if="can('editItems')" class="btn-soft mt-3 w-full" @click="editing = {}"><AppIcon name="plus" :size="16" /> เพิ่มสินค้า</button>
        </section>

        <!-- ยกเลิก -->
        <section v-if="order.cancel" class="card border-rose-200 bg-rose-50/70">
          <div class="card-title text-rose-700"><AppIcon name="x" /> ยกเลิกแล้ว</div>
          <dl class="space-y-1.5 text-sm">
            <div class="flex gap-3"><dt class="w-20 shrink-0 text-rose-500">เหตุผล</dt><dd class="min-w-0 break-words">{{ order.cancel.reason }}</dd></div>
            <div class="flex gap-3"><dt class="w-20 shrink-0 text-rose-500">คืนเงิน</dt><dd>{{ money(order.cancel.refundAmount) }} · {{ order.cancel.refundMethod }}</dd></div>
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
          <div class="text-3xl font-bold tracking-tight text-stone-900">{{ money(t.total) }}</div>

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
            <div class="flex justify-between gap-2"><dt class="text-stone-500">ค่าสินค้า</dt><dd>{{ money(t.subtotal) }}</dd></div>
            <div v-if="order.fulfillment === 'delivery'" class="flex justify-between gap-2"><dt class="text-stone-500">ค่าส่ง</dt><dd>{{ money(t.shipping) }}</dd></div>
            <div v-if="t.adjustment" class="flex justify-between gap-2">
              <dt class="min-w-0 text-stone-500">ปรับราคา <span class="break-words text-stone-400">({{ order.adjustment.reason }})</span></dt>
              <dd class="shrink-0">{{ money(t.adjustment) }}</dd>
            </div>
            <div v-if="t.pointsDiscount" class="flex justify-between gap-2"><dt class="text-stone-500">ใช้ {{ order.pointsUsed.points }} คะแนน</dt><dd class="text-rose-600">−{{ money(t.pointsDiscount) }}</dd></div>
            <div v-for="u in order.couponsUsed" :key="u.couponId" class="flex justify-between gap-2"><dt class="min-w-0 break-words text-stone-500">คูปอง {{ u.name }}</dt><dd class="shrink-0 text-rose-600">−{{ money(u.amount) }}</dd></div>
          </dl>
          <button v-if="can('adjustPrice') && !closed" class="btn-soft mt-3 w-full" @click="openAdj"><AppIcon name="tag" :size="16" /> ปรับราคา / ส่วนลด</button>
        </section>

        <!-- คะแนน / คูปอง -->
        <section v-if="customer" class="card">
          <div class="card-title"><AppIcon name="tag" class="text-brand-600" /> คะแนน / คูปอง</div>
          <div class="text-sm text-stone-600">คะแนนของลูกค้า <b class="text-stone-900">{{ points.toLocaleString('th-TH') }}</b> คะแนน</div>
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
            <button
              v-if="can('reportPayment') && order.status !== 'draft' && order.status !== 'cancelled' && t.balance > 0"
              class="btn-soft h-9 px-3"
              @click="openPay('new')"
            ><AppIcon name="plus" :size="16" /> แจ้งยอดชำระ</button>
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
              <div class="mt-0.5 text-sm text-stone-500">{{ p.method }} · {{ dateTime(p.paidAt) }}</div>
              <div v-if="p.note" class="text-sm break-words text-stone-500">{{ p.note }}</div>
              <a v-if="p.slip" :href="p.slip" target="_blank" class="mt-2 block"><img :src="p.slip" class="h-24 w-auto rounded-lg object-cover" /></a>
              <div v-if="p.status === 'reported' && order.status !== 'cancelled'" class="mt-2.5 flex flex-wrap gap-2">
                <button v-if="can('reportPayment')" class="btn-outline h-9 px-3" @click="openPay('edit', p)"><AppIcon name="edit" :size="16" /> แก้ยอด</button>
                <button v-if="can('reportPayment')" class="btn-danger h-9 px-3" @click="doCancelRequest(p)"><AppIcon name="x" :size="16" /> ยกเลิก</button>
                <button v-if="can('confirmPayment')" class="btn-primary h-9 flex-1 px-3" @click="openPay('confirm', p)"><AppIcon name="check" :size="16" /> ยืนยันยอดชำระ</button>
              </div>
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
      <div class="mx-auto flex max-w-5xl gap-2">
        <button v-if="can('cancel') && !closed" class="btn-danger px-3 sm:px-4" @click="openCancel">
          <AppIcon name="x" :size="16" /> <span :class="primaryAction ? 'hidden sm:inline' : ''">ยกเลิกออร์เดอร์</span>
        </button>
        <button
          v-if="order.status === 'draft' && can('sendToPayment')"
          class="btn-primary flex-1 sm:ml-auto sm:flex-none sm:px-8"
          @click="doStatus('awaiting_payment', 'ส่งไปรอชำระ', 'ส่งไปรอชำระ')"
        >ส่งไปรอชำระ</button>
        <button
          v-if="order.status === 'payment_confirmed' && can('startPreparing')"
          class="btn-primary flex-1 sm:ml-auto sm:flex-none sm:px-8"
          @click="doStatus('preparing', 'เริ่มเตรียมสินค้า', 'เริ่มเตรียมสินค้า')"
        >เริ่มเตรียมสินค้า</button>
        <button
          v-if="order.status === 'preparing' && canDeliver"
          class="btn-primary flex-1 sm:ml-auto sm:flex-none sm:px-8"
          @click="doStatus('delivered', 'ส่งมอบแล้ว', 'ส่งมอบแล้ว')"
        ><AppIcon name="check" :size="18" /> ส่งมอบแล้ว</button>
      </div>
    </div>

    <!-- modal ใช้คะแนน -->
    <AppModal v-if="ptOpen" title="ใช้คะแนนเป็นส่วนลด" @close="ptOpen = false">
      <div class="space-y-4">
        <div class="rounded-xl bg-brand-50 p-3 text-sm text-brand-800">มี {{ points }} คะแนน · 1 คะแนน = {{ money(db.loyalty.pointValue) }} · ใช้ได้สูงสุด {{ ptMax }} คะแนน</div>
        <div><label class="label">จำนวนคะแนน</label><input v-model.number="ptUse" type="number" inputmode="numeric" min="1" :max="ptMax" class="input text-lg font-semibold" /></div>
        <div class="text-sm text-stone-600">ลด {{ money((Number(ptUse) || 0) * db.loyalty.pointValue) }}</div>
        <p v-if="ptError" class="text-sm text-rose-600">{{ ptError }}</p>
      </div>
      <template #footer>
        <button class="btn-outline flex-1 sm:flex-none" @click="ptOpen = false">ยกเลิก</button>
        <button class="btn-primary flex-1 sm:flex-none" @click="savePoints">ใช้คะแนน</button>
      </template>
    </AppModal>

    <!-- modal แจ้งยอด / แก้ยอด / ยืนยันยอดจริง -->
    <AppModal v-if="payOpen" :title="PAY_TITLE[payMode]" @close="payOpen = false">
      <div class="space-y-4">
        <div v-if="payMode === 'confirm'" class="rounded-xl bg-sky-50 p-3 text-sm text-sky-800">
          ยอดที่แจ้งไป <b>{{ money(payTarget.requested ?? payTarget.amount) }}</b> · ใส่ยอดที่ได้รับจริง
        </div>
        <div v-else class="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
          คงค้าง <b>{{ money(t.balance) }}</b><span v-if="t.reported"> · แจ้งยอดแล้ว {{ money(t.reported) }}</span>
        </div>
        <div><label class="label">{{ payMode === 'confirm' ? 'ยอดที่ได้รับจริง (บาท)' : 'ยอดที่แจ้งลูกค้า (บาท)' }}</label><input v-model.number="pay.amount" type="number" inputmode="decimal" min="0" class="input text-lg font-semibold" /></div>
        <div>
          <div class="label">ช่องทาง</div>
          <div class="flex flex-wrap gap-2">
            <button v-for="m in PAYMENT_METHODS" :key="m" type="button" class="chip" :class="pay.method === m ? 'chip-on' : 'chip-off'" @click="pay.method = m">{{ m }}</button>
          </div>
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
        <button class="btn-primary flex-1 sm:flex-none" @click="savePay">{{ payMode === 'confirm' ? 'ยืนยัน' : 'บันทึก' }}</button>
      </template>
    </AppModal>

    <!-- modal ปรับราคา -->
    <AppModal v-if="adjOpen" title="ปรับราคา / ส่วนลด" @close="adjOpen = false">
      <div class="space-y-4">
        <div>
          <label class="label">จำนวนเงิน <span class="font-normal text-stone-400">(ติดลบ = ส่วนลด)</span></label>
          <input v-model.number="adj.amount" type="number" inputmode="numeric" class="input text-lg font-semibold" />
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
        <div><label class="label">เหตุผล <span class="text-rose-500">*</span></label><textarea v-model="cxl.reason" rows="2" class="input" /></div>
        <div class="rounded-xl bg-stone-50 p-3 text-sm text-stone-600">ชำระแล้ว <b>{{ money(t.paid) }}</b></div>
        <div><label class="label">ยอดคืนเงิน (บาท)</label><input v-model.number="cxl.refundAmount" type="number" inputmode="decimal" min="0" class="input" /></div>
        <div>
          <div class="label">ช่องทางคืนเงิน</div>
          <div class="flex flex-wrap gap-2">
            <button v-for="m in PAYMENT_METHODS" :key="m" type="button" class="chip" :class="cxl.refundMethod === m ? 'chip-on' : 'chip-off'" @click="cxl.refundMethod = m">{{ m }}</button>
          </div>
        </div>
        <div><label class="label">หมายเหตุการคืนเงิน</label><input v-model="cxl.refundNote" class="input" /></div>
        <p v-if="cxlError" class="text-sm text-rose-600">{{ cxlError }}</p>
      </div>
      <template #footer>
        <button class="btn-outline flex-1 sm:flex-none" @click="cancelOpen = false">ปิด</button>
        <button class="btn flex-1 bg-rose-600 text-white hover:bg-rose-700 sm:flex-none" @click="saveCancel">ยืนยันยกเลิก</button>
      </template>
    </AppModal>
  </div>

  <ItemEditor v-if="editing" :item="editing.item || null" :price-date="orderDate(order)" @save="onSaveItem" @close="editing = null" />
</template>
