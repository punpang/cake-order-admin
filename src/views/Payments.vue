<script setup>
import { computed, ref } from 'vue'
import { db, can, orderVisible, findCustomer, cancelPaymentRequest, denyPayExtension } from '../data/store'
import { paymentQueue, paymentCounts, PAY_TABS } from '../lib/paymentsQueue'
import { orderTotals } from '../lib/pricing'
import { askConfirm } from '../lib/confirm'
import { money, dateTime, dayLabel, formatPhone } from '../lib/format'
import PayDueBadge from '../components/PayDueBadge.vue'
import StatusBadge from '../components/StatusBadge.vue'
import AppIcon from '../components/AppIcon.vue'
import SecureImg from '../components/SecureImg.vue'
import OrderPayModal from '../components/OrderPayModal.vue'
import PayExtendModal from '../components/PayExtendModal.vue'
import RefundPartialDialog from '../components/RefundPartialDialog.vue'

// จัดการการชำระเงินของออร์เดอร์แบบง่าย (ไม่รวมบิล POS): ตรวจ/ยืนยันยอดที่แจ้ง · รับชำระทันที · แจ้งยอด/ขยายเวลา · คืนเงินบางส่วน โดยไม่ต้องเข้าหน้าออร์เดอร์
const tab = ref('review')
const q = ref('')
const orders = computed(() => db.orders.filter(orderVisible))
const counts = computed(() => paymentCounts(orders.value))
const textOf = (o) => { const c = findCustomer(o.customerId); return [o.code, c?.name, c?.phone, c?.phone && formatPhone(c.phone)].filter(Boolean).join(' ') }
const rows = computed(() => paymentQueue(orders.value, { tab: tab.value, q: q.value, textOf }))
const canConfirm = computed(() => can('confirmPayment'))
const canReport = computed(() => can('reportPayment'))
const canRefund = computed(() => can('refundPartial'))
const EMPTY = { review: 'ไม่มียอดที่รอตรวจ', due: 'ไม่มีออร์เดอร์ค้างชำระ' }
// แท็บคืนเงิน: ต้องค้นหาออร์เดอร์ก่อน แล้วจึงแสดงออร์เดอร์ที่มียอดชำระสุทธิ > 0 ให้คืนเงิน
const tabs = computed(() => PAY_TABS.filter((t) => t.v !== 'refund' || canRefund.value))
const refundRows = computed(() => {
  const s = q.value.trim().toLowerCase()
  if (!s) return []
  return orders.value
    .filter((o) => o.status !== 'cancelled' && orderTotals(o).paidNet > 0 && textOf(o).toLowerCase().includes(s))
    .map((o) => ({ o, t: orderTotals(o), c: findCustomer(o.customerId) }))
})

// โมดัลที่ใช้ร่วมกับหน้ารายละเอียดออร์เดอร์
const pay = ref(null) // { order, mode, target }
const ext = ref(null) // { order, payment }
const refund = ref(null)
const openPay = (order, mode, target = null) => { pay.value = { order, mode, target } }
async function doCancelRequest(o, p) {
  if (await askConfirm({ title: 'ยกเลิกยอดที่แจ้ง', message: money(p.requested ?? p.amount), okText: 'ยกเลิกยอด', danger: true })) cancelPaymentRequest(o, p.id)
}
async function doDenyExt(o, p) {
  if (await askConfirm({ title: 'ไม่อนุมัติขยายเวลา', message: 'ลูกค้าจะยังชำระเองไม่ได้', okText: 'ไม่อนุมัติ', danger: true })) denyPayExtension(o, p.id)
}
const reported = (o) => o.payments.map((p, i) => ({ p, n: i + 1 })).filter((x) => x.p.status === 'reported')
const shortDay = (o) => dayLabel(o.pickupAt.slice(0, 10))
</script>

<template>
  <div>
    <div class="mb-4 min-w-0">
      <h1 class="page-title">ชำระเงิน</h1>
      <p class="text-sm text-stone-500">ออร์เดอร์เท่านั้น (ไม่รวมบิล POS) · รอตรวจ {{ counts.review }} · ค้างชำระ {{ counts.due }}<template v-if="counts.overdue"> · เกินกำหนด {{ counts.overdue }}</template></p>
    </div>

    <label class="relative mb-3 block">
      <span class="sr-only">ค้นหา</span>
      <AppIcon name="search" class="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-stone-400" />
      <input v-model="q" type="search" class="input bg-white pl-10" placeholder="ค้นหา เลขออร์เดอร์ ชื่อ หรือเบอร์" />
    </label>

    <div class="mb-4 grid grid-cols-3 gap-1 seg-grid md:max-w-xl" role="group" aria-label="กรองการชำระเงิน">
      <button v-for="t in tabs" :key="t.v" type="button" class="seg-item h-auto min-h-10 px-1 py-1.5 text-center leading-tight" :class="tab === t.v ? 'seg-on' : ''" :aria-pressed="tab === t.v" @click="tab = t.v">
        {{ t.l }} <span class="font-normal">{{ counts[t.v] }}</span>
      </button>
    </div>

    <template v-if="tab !== 'refund'">
    <div v-if="!rows.length" class="empty py-12">
      <span class="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-600"><AppIcon name="wallet" :size="28" /></span>
      <div class="font-semibold text-stone-800">{{ q.trim() ? 'ไม่พบออร์เดอร์' : EMPTY[tab] }}</div>
    </div>

    <ul class="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3" aria-label="รายการชำระเงิน">
      <li v-for="r in rows" :key="r.o.id" class="card flex min-w-0 flex-col gap-3" :data-order="r.o.code">
        <div class="flex items-start gap-2">
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span class="font-semibold text-stone-900">{{ r.o.code }}</span>
              <StatusBadge :status="r.o.status" />
              <PayDueBadge :due="r.due" />
              <span v-if="r.pending.length" class="inline-flex items-center rounded-full bg-sky-50 px-2 py-0.5 text-xs font-semibold whitespace-nowrap text-sky-700">ลูกค้าแจ้งโอน</span>
            </div>
            <div class="truncate text-sm text-stone-600">{{ findCustomer(r.o.customerId)?.name || 'ไม่ระบุลูกค้า' }}<template v-if="findCustomer(r.o.customerId)?.phone"> · {{ formatPhone(findCustomer(r.o.customerId).phone) }}</template></div>
            <div class="text-xs text-stone-500">นัด{{ r.o.fulfillment === 'delivery' ? 'ส่ง' : 'รับ' }} {{ shortDay(r.o) }} {{ r.o.pickupAt.slice(11, 16) }}</div>
          </div>
          <RouterLink :to="`/admin/orders/${r.o.id}`" class="shrink-0 text-xs text-brand-700 underline" :aria-label="`เปิดออร์เดอร์ ${r.o.code}`">เปิดออร์เดอร์</RouterLink>
        </div>

        <dl class="grid grid-cols-3 gap-2 text-sm">
          <div class="rounded-xl bg-stone-50 p-2"><dt class="text-xs text-stone-500">ยอดรวม</dt><dd class="font-semibold text-stone-900">{{ money(r.t.total) }}</dd></div>
          <div class="rounded-xl bg-emerald-50 p-2"><dt class="text-xs text-emerald-700">ชำระแล้ว<template v-if="r.t.returned"> (สุทธิ)</template></dt><dd class="font-semibold text-emerald-800">{{ money(r.t.paidNet) }}</dd></div>
          <div class="rounded-xl p-2" :class="r.t.balance > 0 ? 'bg-amber-50' : 'bg-stone-50'"><dt class="text-xs" :class="r.t.balance > 0 ? 'text-amber-700' : 'text-stone-500'">คงค้าง</dt><dd class="font-semibold" :class="r.t.balance > 0 ? 'text-amber-800' : 'text-stone-700'">{{ money(Math.max(r.t.balance, 0)) }}</dd></div>
        </dl>
        <p v-if="r.t.returned" class="text-xs text-rose-600">คืนเงินแล้ว −{{ money(r.t.returned) }}</p>

        <!-- งวดที่แจ้งไว้ (รอตรวจ/รอรับเงิน) -->
        <div v-for="x in reported(r.o)" :key="x.p.id" class="space-y-2 rounded-xl border border-sky-200 bg-sky-50/50 p-3" :aria-label="`งวด ${x.n} ${r.o.code}`">
          <div class="flex items-center justify-between gap-2">
            <span class="font-semibold text-stone-900">งวด {{ x.n }} · {{ money(x.p.requested ?? x.p.amount) }}</span>
            <span class="text-xs text-stone-600">{{ x.p.method }}<template v-if="x.p.paidAt"> · {{ dateTime(x.p.paidAt) }}</template></span>
          </div>
          <SecureImg v-if="x.p.slip" :src="x.p.slip" alt="สลิป" link class="block w-fit" img-class="h-24 w-auto rounded-lg object-cover" />
          <p v-if="x.p.note" class="text-sm break-words text-stone-600">{{ x.p.note }}</p>
          <div v-if="x.p.extension?.status === 'pending'" class="rounded-lg bg-amber-50 p-2.5 text-sm text-amber-800">
            ลูกค้าขอขยายเวลา<span v-if="x.p.extension.note"> · {{ x.p.extension.note }}</span>
            <div v-if="canReport" class="mt-2 flex gap-2">
              <button type="button" class="btn-primary h-9 flex-1 px-3" @click="ext = { order: r.o, payment: x.p }">ขยายเวลา</button>
              <button type="button" class="btn-outline h-9 px-3" @click="doDenyExt(r.o, x.p)">ไม่อนุมัติ</button>
            </div>
          </div>
          <div class="flex flex-wrap gap-2">
            <button v-if="canConfirm" type="button" class="btn-primary h-9 flex-1 px-3" @click="openPay(r.o, 'confirm', x.p)"><AppIcon name="check" :size="16" /> ยืนยันยอด</button>
            <button v-if="canReport" type="button" class="btn-outline h-9 px-3" @click="openPay(r.o, 'edit', x.p)"><AppIcon name="edit" :size="16" /> แก้ยอด</button>
            <button v-if="canReport" type="button" class="btn-danger h-9 px-3" @click="doCancelRequest(r.o, x.p)"><AppIcon name="x" :size="16" /> ยกเลิก</button>
            <button v-if="canReport && !(x.p.extension?.status === 'pending') && x.p.dueAt" type="button" class="btn-soft h-9 px-3 text-xs" @click="ext = { order: r.o, payment: x.p }">เปลี่ยนกำหนดชำระ</button>
          </div>
        </div>

        <div v-if="r.o.status !== 'cancelled'" class="mt-auto flex flex-wrap gap-2">
          <button v-if="canConfirm && r.t.balance > 0" type="button" class="btn-primary h-9 px-3" @click="openPay(r.o, 'direct')"><AppIcon name="check" :size="16" /> รับชำระทันที</button>
          <button v-if="canReport && r.t.balance > 0" type="button" class="btn-outline h-9 px-3" @click="openPay(r.o, 'new')"><AppIcon name="plus" :size="16" /> แจ้งยอดชำระ</button>
        </div>
      </li>
    </ul>
    </template>

    <template v-else>
      <div v-if="!q.trim()" class="empty py-12">
        <span class="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-600"><AppIcon name="search" :size="28" /></span>
        <div class="font-semibold text-stone-800">ค้นหาออร์เดอร์ก่อน</div>
        <div class="text-sm text-stone-500">พิมพ์เลขออร์เดอร์ ชื่อ หรือเบอร์ เพื่อดำเนินการคืนเงิน</div>
      </div>
      <div v-else-if="!refundRows.length" class="empty py-12">
        <div class="font-semibold text-stone-800">ไม่พบออร์เดอร์ที่คืนเงินได้</div>
      </div>
      <ul v-else class="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3" aria-label="ออร์เดอร์ที่คืนเงินได้">
        <li v-for="r in refundRows" :key="r.o.id" class="card flex min-w-0 flex-col gap-3" :data-order="r.o.code">
          <div class="flex items-start gap-2">
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span class="font-semibold text-stone-900">{{ r.o.code }}</span>
                <StatusBadge :status="r.o.status" />
              </div>
              <div class="truncate text-sm text-stone-600">{{ r.c?.name || 'ไม่ระบุลูกค้า' }}<template v-if="r.c?.phone"> · {{ formatPhone(r.c.phone) }}</template></div>
            </div>
            <RouterLink :to="`/admin/orders/${r.o.id}`" class="shrink-0 text-xs text-brand-700 underline" :aria-label="`เปิดออร์เดอร์ ${r.o.code}`">เปิดออร์เดอร์</RouterLink>
          </div>
          <dl class="grid grid-cols-2 gap-2 text-sm">
            <div class="rounded-xl bg-stone-50 p-2"><dt class="text-xs text-stone-500">ยอดรวม</dt><dd class="font-semibold text-stone-900">{{ money(r.t.total) }}</dd></div>
            <div class="rounded-xl bg-emerald-50 p-2"><dt class="text-xs text-emerald-700">ชำระแล้ว (สุทธิ)</dt><dd class="font-semibold text-emerald-800">{{ money(r.t.paidNet) }}</dd></div>
          </dl>
          <p v-if="r.t.returned" class="text-xs text-rose-600">คืนเงินแล้ว −{{ money(r.t.returned) }}</p>
          <div class="mt-auto flex flex-wrap gap-2">
            <button v-if="canRefund" type="button" class="btn-primary h-9 px-3" @click="refund = r.o"><AppIcon name="wallet" :size="16" /> คืนเงิน</button>
          </div>
        </li>
      </ul>
    </template>

    <OrderPayModal v-if="pay" :order="pay.order" :mode="pay.mode" :target="pay.target" @close="pay = null" />
    <PayExtendModal v-if="ext" :order="ext.order" :payment="ext.payment" @close="ext = null" />
    <RefundPartialDialog v-if="refund" :order="refund" @close="refund = null" />
  </div>
</template>
