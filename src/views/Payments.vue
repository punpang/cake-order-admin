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
const customerOf = (o) => findCustomer(o.customerId)
// หัววันสั้น ๆ ใต้เวลานัด: วันนี้ / พรุ่งนี้ / เมื่อวาน / ส. 14-11
const dayShort = (o) => {
  const [a, b = ''] = dayLabel(o.pickupAt.slice(0, 10)).split(' ')
  return ['วันนี้', 'พรุ่งนี้', 'เมื่อวาน'].includes(a) ? a : `${a} ${b.slice(0, 5)}`
}
// เปอร์เซ็นต์ที่ชำระแล้ว (สุทธิหลังคืนเงิน) ของยอดรวม
const paidPct = (t) => (t.total > 0 ? Math.min(100, Math.max(0, Math.round((t.paidNet / t.total) * 100))) : 0)
// สรุปยอดด้านบนของแท็บ: รอตรวจ = ยอดที่ลูกค้า/พนักงานแจ้งไว้ · ค้างชำระ = ยอดคงค้างรวม + จำนวนที่เกินกำหนด
const summary = computed(() => {
  if (tab.value === 'refund') return null
  let amount = 0
  let count = 0
  let overdue = 0
  for (const r of rows.value) {
    if (tab.value === 'review') {
      for (const { p } of reported(r.o)) { amount += Number(p.requested ?? p.amount) || 0; count++ }
    } else {
      amount += Math.max(r.t.balance, 0)
      count++
      if (r.due?.state === 'overdue') overdue++
    }
  }
  return { amount, count, overdue }
})
</script>

<template>
  <div>
    <div class="mb-3 min-w-0">
      <h1 class="page-title">ชำระเงิน</h1>
      <p class="text-sm text-stone-500">เฉพาะออร์เดอร์ · ไม่รวมบิล POS</p>
    </div>

    <div class="mb-3 grid grid-cols-3 gap-1 seg-grid md:max-w-xl" role="group" aria-label="กรองการชำระเงิน">
      <button v-for="t in tabs" :key="t.v" type="button" class="seg-item h-auto min-h-10 px-1 py-1.5 text-center leading-tight" :class="tab === t.v ? 'seg-on' : ''" :aria-pressed="tab === t.v" @click="tab = t.v">
        {{ t.l }} <span class="font-normal tabular-nums">{{ counts[t.v] }}</span>
      </button>
    </div>

    <!-- สรุปยอดของแท็บ: ตอบคำถามแรกของคนหน้าร้านได้ทันที (ต้องรับเงินเท่าไร · กี่รายการ · เกินกำหนดกี่รายการ) -->
    <section v-if="summary && rows.length" class="mb-3 grid grid-cols-3 divide-x divide-stone-200/80 overflow-hidden rounded-2xl border shadow-sm md:max-w-xl" :class="tab === 'review' ? 'border-sky-200 bg-sky-50' : 'border-amber-200 bg-amber-50'" aria-label="สรุปยอด">
      <div class="col-span-3 min-w-0 px-4 pt-3 sm:col-span-1 sm:pb-3" :class="tab === 'review' ? 'text-sky-900' : 'text-amber-900'">
        <div class="text-xs font-medium opacity-80">{{ tab === 'review' ? 'ยอดที่แจ้งรอตรวจ' : 'ยอดค้างรับทั้งหมด' }}{{ q.trim() ? ' (ตามที่ค้นหา)' : '' }}</div>
        <div class="mt-0.5 text-2xl leading-tight font-semibold tabular-nums">{{ money(summary.amount) }}</div>
      </div>
      <div class="px-4 py-3" :class="tab === 'review' ? 'text-sky-900' : 'text-amber-900'">
        <div class="text-xs font-medium opacity-80">{{ tab === 'review' ? 'งวดที่รอตรวจ' : 'ออร์เดอร์' }}</div>
        <div class="mt-0.5 text-lg leading-tight font-semibold tabular-nums">{{ summary.count.toLocaleString('th-TH') }}</div>
      </div>
      <div class="px-4 py-3" :class="summary.overdue ? 'text-rose-700' : tab === 'review' ? 'text-sky-900' : 'text-amber-900'">
        <div class="text-xs font-medium opacity-80">เกินกำหนด</div>
        <div class="mt-0.5 text-lg leading-tight font-semibold tabular-nums">{{ tab === 'review' ? '—' : summary.overdue.toLocaleString('th-TH') }}</div>
      </div>
    </section>

    <label class="relative mb-3 block md:max-w-xl">
      <span class="sr-only">ค้นหา</span>
      <AppIcon name="search" class="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-stone-400" />
      <input v-model="q" type="search" class="input bg-white pl-10" placeholder="ค้นหา เลขออร์เดอร์ ชื่อ หรือเบอร์" />
    </label>

    <template v-if="tab !== 'refund'">
      <div v-if="!rows.length" class="empty py-12">
        <span class="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-600"><AppIcon name="wallet" :size="28" /></span>
        <div class="font-semibold text-stone-800">{{ q.trim() ? 'ไม่พบออร์เดอร์' : EMPTY[tab] }}</div>
      </div>

      <ul v-else class="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3" aria-label="รายการชำระเงิน">
        <li v-for="r in rows" :key="r.o.id" class="card flex min-w-0 flex-col gap-3 p-3.5" :data-order="r.o.code">
          <!-- หัว: เวลานัด · ลูกค้า · สถานะ -->
          <div class="flex items-start gap-3">
            <div class="flex w-14 shrink-0 flex-col items-center rounded-xl py-2" :class="r.due?.state === 'overdue' ? 'bg-rose-50 text-rose-700' : 'bg-brand-50 text-brand-800'">
              <span class="text-base leading-none font-semibold tabular-nums">{{ r.o.pickupAt.slice(11, 16) }}</span>
              <span class="mt-1 text-[11px] leading-none opacity-80">{{ dayShort(r.o) }}</span>
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0">
                  <div class="truncate font-semibold text-stone-900">{{ customerOf(r.o)?.name || 'ไม่ระบุลูกค้า' }}</div>
                  <div class="truncate text-xs text-stone-500 tabular-nums">{{ r.o.code }}<template v-if="customerOf(r.o)?.phone"> · {{ formatPhone(customerOf(r.o).phone) }}</template></div>
                </div>
                <RouterLink :to="`/admin/orders/${r.o.id}`" class="-mt-1 -mr-1 flex h-10 shrink-0 items-center gap-0.5 rounded-lg px-2 text-sm font-medium text-brand-700 hover:bg-brand-50" :aria-label="`เปิดออร์เดอร์ ${r.o.code}`">
                  เปิด<AppIcon name="next" :size="14" />
                </RouterLink>
              </div>
              <div class="mt-1.5 flex flex-wrap items-center gap-1.5">
                <StatusBadge :status="r.o.status" />
                <PayDueBadge :due="r.due" short />
                <span v-if="r.pending.length" class="inline-flex items-center rounded-full bg-sky-50 px-2 py-0.5 text-xs font-semibold whitespace-nowrap text-sky-700">ลูกค้าแจ้งโอน</span>
              </div>
            </div>
          </div>

          <!-- ยอด: คงค้างเป็นตัวเด่น · ยอดรวม/ชำระแล้วเป็นรอง · แถบความคืบหน้า -->
          <div class="rounded-2xl bg-stone-50 p-3">
            <div class="flex items-end justify-between gap-3">
              <div class="min-w-0">
                <div class="text-xs text-stone-500">คงค้าง</div>
                <div class="text-xl leading-tight font-semibold tabular-nums" :class="r.t.balance > 0 ? 'text-amber-800' : 'text-stone-500'">{{ r.t.balance > 0 ? money(r.t.balance) : 'ไม่มียอดค้าง' }}</div>
              </div>
              <div class="shrink-0 text-right text-xs leading-relaxed text-stone-500">
                <div>ยอดรวม <b class="font-semibold text-stone-700 tabular-nums">{{ money(r.t.total) }}</b></div>
                <div>ชำระแล้ว <b class="font-semibold text-emerald-700 tabular-nums">{{ money(r.t.paidNet) }}</b></div>
              </div>
            </div>
            <div class="mt-2.5 h-1.5 overflow-hidden rounded-full bg-stone-200" role="progressbar" :aria-valuenow="paidPct(r.t)" aria-valuemin="0" aria-valuemax="100" aria-label="ชำระแล้ว">
              <div class="h-full rounded-full bg-emerald-500 transition-all" :style="{ width: paidPct(r.t) + '%' }" />
            </div>
            <p v-if="r.t.returned" class="mt-2 text-xs text-rose-600">คืนเงินแล้ว −{{ money(r.t.returned) }}</p>
          </div>

          <!-- งวดที่แจ้งไว้ (รอตรวจ/รอรับเงิน): การกระทำหลักของแท็บรอตรวจ -->
          <div v-for="x in reported(r.o)" :key="x.p.id" class="rounded-2xl border border-sky-200 bg-sky-50/60 p-3" :aria-label="`งวด ${x.n} ${r.o.code}`">
            <div class="flex gap-3">
              <div class="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white text-sky-500">
                <SecureImg v-if="x.p.slip" :src="x.p.slip" alt="สลิป" img-class="h-full w-full object-cover" />
                <AppIcon v-else name="image" :size="22" />
              </div>
              <div class="min-w-0 flex-1">
                <div class="text-xs font-medium text-sky-700">งวด {{ x.n }} · {{ x.p.customerSubmitted ? 'ลูกค้าแจ้งโอนแล้ว' : 'แจ้งยอดไว้ รอรับเงิน' }}</div>
                <div class="text-lg leading-tight font-semibold text-stone-900 tabular-nums">{{ money(x.p.requested ?? x.p.amount) }}</div>
                <div class="truncate text-xs text-stone-600">{{ x.p.method }}<template v-if="x.p.paidAt"> · {{ dateTime(x.p.paidAt) }}</template></div>
                <p v-if="x.p.note" class="mt-0.5 truncate text-xs text-stone-500">{{ x.p.note }}</p>
              </div>
            </div>

            <div v-if="x.p.extension?.status === 'pending'" class="mt-3 rounded-xl bg-amber-50 p-2.5 text-sm text-amber-900">
              <div>ลูกค้าขอขยายเวลา<span v-if="x.p.extension.note"> · {{ x.p.extension.note }}</span></div>
              <div v-if="canReport" class="mt-2 grid grid-cols-2 gap-2">
                <button type="button" class="btn-primary h-11 px-3" @click="ext = { order: r.o, payment: x.p }">ขยายเวลา</button>
                <button type="button" class="btn-outline h-11 px-3" @click="doDenyExt(r.o, x.p)">ไม่อนุมัติ</button>
              </div>
            </div>

            <div class="mt-3 space-y-2">
              <button v-if="canConfirm" type="button" class="btn-primary h-11 w-full" @click="openPay(r.o, 'confirm', x.p)">
                <AppIcon name="check" :size="16" /> ยืนยันยอด {{ money(x.p.requested ?? x.p.amount) }}
              </button>
              <div v-if="canReport" class="grid gap-2" :class="x.p.dueAt && !(x.p.extension?.status === 'pending') ? 'grid-cols-3' : 'grid-cols-2'">
                <button type="button" class="btn-outline h-11 px-2 text-sm" @click="openPay(r.o, 'edit', x.p)"><AppIcon name="edit" :size="14" /> แก้ยอด</button>
                <button v-if="x.p.dueAt && !(x.p.extension?.status === 'pending')" type="button" class="btn-outline h-11 px-2 text-sm" @click="ext = { order: r.o, payment: x.p }">เปลี่ยนกำหนด</button>
                <button type="button" class="btn-danger h-11 px-2 text-sm" @click="doCancelRequest(r.o, x.p)"><AppIcon name="x" :size="14" /> ยกเลิกยอด</button>
              </div>
            </div>
          </div>

          <!-- การกระทำของออร์เดอร์: แท็บค้างชำระเน้น "รับชำระทันที" · แท็บรอตรวจให้ยืนยันงวดที่แจ้งก่อน -->
          <div v-if="r.t.balance > 0 && (canConfirm || canReport)" class="mt-auto flex gap-2">
            <button v-if="canConfirm" type="button" class="h-11 flex-1 px-3" :class="tab === 'due' && !reported(r.o).length ? 'btn-primary' : 'btn-outline'" @click="openPay(r.o, 'direct')"><AppIcon name="check" :size="16" /> รับชำระทันที</button>
            <button v-if="canReport" type="button" class="btn-outline h-11 flex-1 px-3" @click="openPay(r.o, 'new')"><AppIcon name="plus" :size="16" /> แจ้งยอดชำระ</button>
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
        <li v-for="r in refundRows" :key="r.o.id" class="card flex min-w-0 flex-col gap-3 p-3.5" :data-order="r.o.code">
          <div class="flex items-start gap-3">
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span class="font-semibold text-stone-900 tabular-nums">{{ r.o.code }}</span>
                <StatusBadge :status="r.o.status" />
              </div>
              <div class="truncate text-sm text-stone-600">{{ r.c?.name || 'ไม่ระบุลูกค้า' }}<template v-if="r.c?.phone"> · {{ formatPhone(r.c.phone) }}</template></div>
            </div>
            <RouterLink :to="`/admin/orders/${r.o.id}`" class="-mt-1 -mr-1 flex h-10 shrink-0 items-center gap-0.5 rounded-lg px-2 text-sm font-medium text-brand-700 hover:bg-brand-50" :aria-label="`เปิดออร์เดอร์ ${r.o.code}`">
              เปิด<AppIcon name="next" :size="14" />
            </RouterLink>
          </div>
          <div class="rounded-2xl bg-emerald-50 p-3">
            <div class="text-xs text-emerald-700">ชำระแล้ว (สุทธิ · คืนได้)</div>
            <div class="text-xl leading-tight font-semibold text-emerald-800 tabular-nums">{{ money(r.t.paidNet) }}</div>
            <div class="mt-1 text-xs text-stone-600">ยอดรวม {{ money(r.t.total) }}<template v-if="r.t.returned"> · คืนแล้ว −{{ money(r.t.returned) }}</template></div>
          </div>
          <button v-if="canRefund" type="button" class="btn-primary mt-auto h-11 w-full" @click="refund = r.o"><AppIcon name="wallet" :size="16" /> คืนเงิน</button>
        </li>
      </ul>
    </template>

    <OrderPayModal v-if="pay" :order="pay.order" :mode="pay.mode" :target="pay.target" @close="pay = null" />
    <PayExtendModal v-if="ext" :order="ext.order" :payment="ext.payment" @close="ext = null" />
    <RefundPartialDialog v-if="refund" :order="refund" @close="refund = null" />
  </div>
</template>
