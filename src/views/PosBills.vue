<script setup>
import ThaiDateField from '../components/ThaiDateField.vue'
// บิล POS ที่ปิดแล้วย้อนหลัง · ค้นหา/กรอง · สรุปยอดแยกวิธีชำระ · ดูบิล · พิมพ์ซ้ำ · ใบเสร็จ · ใบกำกับภาษี
// คืนเงินบางส่วน · เปลี่ยนผู้ซื้อ · ยกเลิกบิล (ใช้ระบบเดิมของ POS ทั้งหมด)
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { db, can, findOrder, findCustomer, voidPosSale } from '../data/store'
import { getSupabase } from '../lib/supabase'
import { loadOrdersInRange } from '../lib/ordersSync'
import { orderTotals } from '../lib/pricing'
import { money, dateTime, toDateStr, orderNo } from '../lib/format'
import { POS_METHODS } from '../lib/constants'
import { closedPosBillsInRange, filterPosBills, payMethodsOf, posMethodTotals } from '../lib/posBills'
import { defaultRefundMethod } from '../lib/refund'
import { hasPrinter } from '../lib/nativeDevices'
import { printOrderReceipt } from '../lib/receiptRaster'
import { invoiceOfOrder } from '../data/acct'
import { showToast } from '../lib/toast'
import AppModal from '../components/AppModal.vue'
import AppIcon from '../components/AppIcon.vue'
import Receipt from '../components/Receipt.vue'
import TaxInvoiceModal from '../components/TaxInvoiceModal.vue'
import RefundEditor from '../components/RefundEditor.vue'
import RefundPartialDialog from '../components/RefundPartialDialog.vue'
import ChangeBuyerModal from '../components/ChangeBuyerModal.vue'

const PRESETS = [
  { v: 'today', l: 'วันนี้' },
  { v: 'week', l: '7 วันล่าสุด' },
  { v: 'month', l: 'เดือนนี้' },
]
const STATUS_OPTS = [
  { v: 'all', l: 'ทั้งหมด' },
  { v: 'closed', l: 'ปิดแล้ว' },
  { v: 'cancelled', l: 'ยกเลิก' },
]
const METHOD_OPTS = [{ v: '', l: 'ทุกวิธี' }, ...Object.entries(POS_METHODS).map(([v, l]) => ({ v, l }))]
const NOT_IN_DEVICE = 'บิลนี้ยังไม่อยู่ในข้อมูลเครื่อง ลองรีเฟรชหน้าแล้วทำใหม่'

const today = toDateStr(new Date())
const from = ref(today)
const to = ref(today)
const items = ref([])
const loading = ref(false)
const error = ref('')
const receipt = ref(null)
const taxFor = ref(null)
const refundFor = ref(null)
const buyerFor = ref(null)
let seq = 0

// ตัวกรองในหน้า (ไม่กระทบการโหลดจากฐานข้อมูล)
const q = ref('')
const status = ref('all')
const method = ref('')

// ใช้อินสแตนซ์ใน db.orders เสมอ เพื่อให้การแก้ไขถูกซิงก์ขึ้นฐานข้อมูล
const toLocal = (rows) => rows.map((x) => findOrder(x.id) || x)

async function load() {
  const my = ++seq
  loading.value = true
  error.value = ''
  const client = await getSupabase()
  let list = []
  if (!client) {
    // โหมดสาธิต (ไม่มีฐานข้อมูล): ใช้ข้อมูลในเครื่อง
    list = closedPosBillsInRange(db.orders, from.value, to.value)
  } else {
    const r = await loadOrdersInRange(client, { from: from.value, to: to.value, onlyPos: true })
    if (my !== seq) return
    if (r.error) {
      error.value = r.error
      items.value = []
      loading.value = false
      return
    }
    list = closedPosBillsInRange(toLocal(r.items), from.value, to.value)
  }
  if (my !== seq) return
  items.value = list
  loading.value = false
}

// ปุ่มช่วงเวลาด่วน
function setRange(kind) {
  const now = new Date()
  const end = toDateStr(now)
  if (kind === 'today') { from.value = end; to.value = end }
  if (kind === 'week') { const d = new Date(now); d.setDate(d.getDate() - 6); from.value = toDateStr(d); to.value = end }
  if (kind === 'month') { from.value = toDateStr(new Date(now.getFullYear(), now.getMonth(), 1)); to.value = end }
}

// ช่วงที่เลือกตรงกับปุ่มด่วนไหน (ว่าง = กำหนดเอง)
const preset = computed(() => {
  const now = new Date()
  const end = toDateStr(now)
  if (to.value !== end) return ''
  if (from.value === end) return 'today'
  const w = new Date(now)
  w.setDate(w.getDate() - 6)
  if (from.value === toDateStr(w)) return 'week'
  if (from.value === toDateStr(new Date(now.getFullYear(), now.getMonth(), 1))) return 'month'
  return ''
})

const live = computed(() => items.value.filter((o) => o.status !== 'cancelled'))
const totalMoney = computed(() => live.value.reduce((s, o) => s + (orderTotals(o).total || 0), 0))
const cancelledCount = computed(() => items.value.length - live.value.length)
const methodSum = computed(() => posMethodTotals(items.value))

const nameOf = (o) => findCustomer(o.customerId)?.name || ''
const textOf = (o) => [orderNo(o.code), o.code, nameOf(o), ...(o.items || []).map((i) => i.name)].join(' ')
const shown = computed(() => filterPosBills(items.value, { q: q.value, status: status.value, method: method.value, textOf }))
const filtering = computed(() => !!q.value.trim() || status.value !== 'all' || !!method.value)
function clearFilters() { q.value = ''; status.value = 'all'; method.value = '' }

const taxable = (o) => can('taxInvoice') && o.status !== 'cancelled' && orderTotals(o).vat > 0
const canVoid = (o) => can('posVoid') && o.status !== 'cancelled'
const canRefund = (o) => can('posVoid') && o.status !== 'cancelled' && (orderTotals(o).paidNet > 0 || (o.returns || []).some((r) => !r.cancelled))
const canBuyer = (o) => can('changeBuyer') && o.status !== 'cancelled'
const canPrint = (o) => o.status !== 'cancelled' && hasPrinter('orderReceipt')
const itemsText = (o) => o.items.map((i) => `${i.name} ×${i.qty}`).join(', ')
const payLabel = (o) => payMethodsOf(o).map((m) => POS_METHODS[m] || m).join(' + ') || 'ชำระแล้ว'

// ---------- พิมพ์ซ้ำ ----------
async function reprint(o) {
  try {
    await printOrderReceipt(findOrder(o.id) || o, { section: 'orderReceipt' })
    showToast('ส่งคำสั่งพิมพ์แล้ว')
  } catch (e) {
    showToast(`พิมพ์ไม่สำเร็จ: ${e.message || e}`, 6000, 'error')
  }
}

// ---------- คืนเงินบางส่วน / เปลี่ยนผู้ซื้อ (แก้ในอินสแตนซ์ของเครื่อง แล้วโหลดใหม่เมื่อเสร็จ) ----------
function openRefund(o) {
  const target = findOrder(o.id)
  if (!target) return showToast(NOT_IN_DEVICE, 6000, 'error')
  refundFor.value = target
}
function openBuyer(o) {
  const target = findOrder(o.id)
  if (!target) return showToast(NOT_IN_DEVICE, 6000, 'error')
  buyerFor.value = target
}

// ---------- ยกเลิกบิล ----------
const voidFor = ref(null)
const vd = reactive({ reason: 'ยกเลิกบิล', refunds: [], note: '', error: '' })
const voidPaid = computed(() => (voidFor.value ? orderTotals(voidFor.value).paidNet : 0))
const voidDefault = computed(() => defaultRefundMethod(voidFor.value?.payments.find((p) => p.status === 'confirmed')?.posMethod))
function openVoid(o) {
  const target = findOrder(o.id)
  if (!target) return showToast(NOT_IN_DEVICE, 6000, 'error')
  const paid = orderTotals(target).paidNet
  Object.assign(vd, {
    reason: 'ยกเลิกบิล',
    refunds: paid > 0 ? [{ method: defaultRefundMethod(target.payments.find((p) => p.status === 'confirmed')?.posMethod), amount: paid }] : [],
    note: '',
    error: '',
  })
  voidFor.value = target
}
function doVoid() {
  if (!vd.reason.trim()) return (vd.error = 'ใส่เหตุผลการยกเลิก')
  const r = voidPosSale(voidFor.value, vd.reason.trim(), vd.refunds.map((x) => ({ method: x.method, amount: Number(x.amount) })), vd.note)
  if (r.error) return (vd.error = r.error)
  showToast('ยกเลิกบิลแล้ว')
  voidFor.value = null
  load()
}

watch([from, to], () => load())
onMounted(() => load())
</script>

<template>
  <div class="mx-auto max-w-2xl space-y-4 px-4 pb-10 pt-4 lg:max-w-3xl">
    <header class="head-safe flex items-start justify-between gap-3">
      <div class="min-w-0">
        <h1 class="page-title">บิล POS ที่ปิดแล้ว</h1>
        <p class="meta mt-0.5 text-stone-500">ทุกกะ · ค้นหา ดูย้อนหลัง และจัดการบิล</p>
      </div>
      <RouterLink to="/admin/pos" class="btn-outline h-10 shrink-0 px-3 text-sm">← กลับ POS</RouterLink>
    </header>

    <!-- ตัวกรองช่วงวันที่ + ค้นหา + สถานะ + วิธีชำระ -->
    <section class="card space-y-4">
      <div class="seg" role="group" aria-label="ช่วงเวลาด่วน">
        <button
          v-for="p in PRESETS"
          :key="p.v"
          type="button"
          class="seg-item"
          :class="preset === p.v ? 'seg-on' : ''"
          :aria-pressed="preset === p.v"
          @click="setRange(p.v)"
        >{{ p.l }}</button>
      </div>
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label class="label" for="pb-from">ตั้งแต่วันที่</label>
          <ThaiDateField id="pb-from" v-model="from" :past="3" label="ตั้งแต่วันที่" />
        </div>
        <div>
          <label class="label" for="pb-to">ถึงวันที่</label>
          <ThaiDateField id="pb-to" v-model="to" :min="from" :past="3" label="ถึงวันที่" />
        </div>
      </div>

      <div class="space-y-3 border-t border-stone-100 pt-4">
        <div>
          <label class="label" for="pb-q">ค้นหา</label>
          <input id="pb-q" v-model="q" type="search" class="input" maxlength="60" placeholder="เลขบิล ชื่อลูกค้า หรือสินค้า" />
        </div>
        <div class="seg" role="group" aria-label="สถานะบิล">
          <button
            v-for="s in STATUS_OPTS"
            :key="s.v"
            type="button"
            class="seg-item"
            :class="status === s.v ? 'seg-on' : ''"
            :aria-pressed="status === s.v"
            @click="status = s.v"
          >{{ s.l }}</button>
        </div>
        <div class="chip-row" role="group" aria-label="วิธีชำระ">
          <button
            v-for="m in METHOD_OPTS"
            :key="m.v || 'all'"
            type="button"
            class="chip h-9"
            :class="method === m.v ? 'chip-on' : 'chip-off'"
            :aria-pressed="method === m.v"
            @click="method = m.v"
          >{{ m.l }}</button>
        </div>
      </div>
    </section>

    <!-- สรุปยอด -->
    <section class="card">
      <div class="text-sm text-stone-500">ยอดรวม (ไม่รวมบิลที่ยกเลิก)</div>
      <div class="mt-1 text-3xl font-bold tabular-nums tracking-tight text-stone-900">{{ money(totalMoney) }}</div>
      <div class="mt-4 grid grid-cols-2 divide-x divide-stone-100 border-t border-stone-100 pt-3 text-center">
        <div>
          <div class="text-xs text-stone-500">จำนวนบิล</div>
          <div class="text-lg font-semibold tabular-nums text-stone-900">{{ live.length }}</div>
        </div>
        <div>
          <div class="text-xs text-stone-500">ยกเลิก</div>
          <div class="text-lg font-semibold tabular-nums" :class="cancelledCount ? 'text-danger-700' : 'text-stone-900'">{{ cancelledCount }}</div>
        </div>
      </div>
      <div class="mt-4 border-t border-stone-100 pt-3">
        <div class="text-xs text-stone-500">เงินรับสุทธิแยกตามวิธีชำระ (หักคืนเงินแล้ว)</div>
        <dl class="mt-2 grid grid-cols-3 gap-2 text-center">
          <div v-for="m in METHOD_OPTS.slice(1)" :key="m.v" class="rounded-xl bg-stone-50 py-2">
            <dt class="text-xs text-stone-500">{{ m.l }}</dt>
            <dd class="text-sm font-semibold tabular-nums text-stone-900">{{ money(methodSum[m.v]) }}</dd>
          </div>
        </dl>
      </div>
    </section>

    <!-- รายการบิล -->
    <section class="space-y-3">
      <div class="flex items-center justify-between px-1">
        <h2 class="text-sm font-semibold text-stone-700">รายการบิล</h2>
        <span v-if="items.length" class="meta text-xs text-stone-500">
          {{ filtering ? `แสดง ${shown.length} จาก ${items.length}` : `${items.length} รายการ` }}
        </span>
      </div>

      <div v-if="loading" class="card py-10 text-center text-sm text-stone-500">กำลังโหลดบิล…</div>

      <div v-else-if="error" class="card flex items-start gap-2 border-danger-200 bg-danger-50 text-sm text-danger-700">
        <AppIcon name="alert" :size="18" class="mt-0.5 shrink-0" />
        <span>โหลดบิลไม่สำเร็จ: {{ error }}</span>
      </div>

      <div v-else-if="!items.length" class="empty">
        <AppIcon name="history" :size="28" class="text-stone-400" />
        <p class="font-medium text-stone-800">ไม่มีบิลที่ปิดแล้ว</p>
        <p class="text-sm text-stone-500">ลองเลือกช่วงวันที่อื่น</p>
      </div>

      <div v-else-if="!shown.length" class="empty">
        <AppIcon name="search" :size="28" class="text-stone-400" />
        <p class="font-medium text-stone-800">ไม่พบบิลที่ตรงกับตัวกรอง</p>
        <button type="button" class="btn-outline h-9 px-3 text-sm" @click="clearFilters">ล้างตัวกรอง</button>
      </div>

      <ul v-else class="space-y-3">
        <li
          v-for="o in shown"
          :key="o.id"
          class="card space-y-3"
          :class="o.status === 'cancelled' ? 'bg-stone-50' : ''"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <span class="font-semibold text-stone-900">{{ orderNo(o.code) }}</span>
                <span
                  v-if="o.status === 'cancelled'"
                  class="rounded-full bg-danger-100 px-2 py-0.5 text-xs font-medium text-danger-700"
                >ยกเลิกแล้ว</span>
                <span
                  v-else
                  class="rounded-full bg-success-50 px-2 py-0.5 text-xs font-medium text-success-700"
                >{{ payLabel(o) }}</span>
              </div>
              <div class="meta mt-1 text-xs text-stone-500">{{ dateTime(o.createdAt) }}</div>
              <div v-if="nameOf(o)" class="meta mt-0.5 text-xs text-stone-500">ลูกค้า: {{ nameOf(o) }}</div>
            </div>
            <div
              class="shrink-0 text-right text-base font-bold tabular-nums"
              :class="o.status === 'cancelled' ? 'text-stone-400 line-through' : 'text-stone-900'"
            >{{ money(orderTotals(o).total) }}</div>
          </div>

          <p class="line-clamp-2 text-sm text-stone-600">{{ itemsText(o) }}</p>

          <div class="flex flex-wrap gap-2 border-t border-stone-100 pt-3">
            <button type="button" class="btn-outline h-9 px-3 text-sm" @click="receipt = o">ใบเสร็จ</button>
            <button v-if="canPrint(o)" type="button" class="btn-outline h-9 px-3 text-sm" @click="reprint(o)">พิมพ์ซ้ำ</button>
            <button v-if="taxable(o)" type="button" class="btn-soft h-9 px-3 text-sm" @click="taxFor = o">ใบกำกับภาษี</button>
            <button v-if="canRefund(o)" type="button" class="btn-outline h-9 px-3 text-sm" @click="openRefund(o)">คืนเงิน</button>
            <button v-if="canBuyer(o)" type="button" class="btn-outline h-9 px-3 text-sm" @click="openBuyer(o)">เปลี่ยนผู้ซื้อ</button>
            <button v-if="canVoid(o)" type="button" class="btn-danger ml-auto h-9 px-3 text-sm" @click="openVoid(o)">ยกเลิกบิล</button>
          </div>
        </li>
      </ul>
    </section>

    <AppModal v-if="receipt" title="ใบเสร็จรับเงิน" @close="receipt = null">
      <Receipt :order="receipt" section="orderReceipt" />
      <template #footer><button class="btn-primary flex-1 sm:flex-none" @click="receipt = null">ปิด</button></template>
    </AppModal>
    <TaxInvoiceModal v-if="taxFor" :order="taxFor" @close="taxFor = null" />
    <RefundPartialDialog v-if="refundFor" :order="refundFor" @close="refundFor = null" @done="load()" />
    <ChangeBuyerModal v-if="buyerFor" :order="buyerFor" @close="buyerFor = null" @done="load()" />

    <AppModal v-if="voidFor" split :title="`ยกเลิกบิล ${orderNo(voidFor.code)}`" @close="voidFor = null">
      <template #left>
      <div class="space-y-4">
        <p v-if="invoiceOfOrder(voidFor.id)" class="rounded-xl bg-warning-50 p-3 text-sm text-warning-800">ออร์เดอร์นี้ออกใบกำกับภาษีไว้แล้ว ({{ invoiceOfOrder(voidFor.id).no }}) · เมื่อยกเลิกระบบจะออกใบลดหนี้ให้อัตโนมัติ</p>
        <p class="text-sm text-stone-500">ยกเลิกแล้วจะคืนสต็อก คืนคูปองที่ใช้ และตัดคะแนนที่ได้จากบิลนี้ · ยอดคืนเงินจะกระทบยอดของกะที่ปิดไปแล้ว</p>
        <div><label class="label">เหตุผล <span class="text-danger-700">*</span></label><input v-model="vd.reason" class="input" maxlength="120" /></div>
      </div>
      </template>
      <template #right>
      <div class="space-y-4">
        <div>
          <div class="label">คืนเงินให้ลูกค้า</div>
          <RefundEditor v-model="vd.refunds" :paid="voidPaid" :can-credit="!!voidFor.customerId && !!findCustomer(voidFor.customerId) && !findCustomer(voidFor.customerId).deleted" :default-method="voidDefault" />
        </div>
        <div><label class="label">หมายเหตุการคืนเงิน</label><input v-model="vd.note" class="input" maxlength="120" /></div>
        <p v-if="vd.error" class="flex items-center gap-2 text-sm text-danger-700"><AppIcon name="alert" :size="16" /> {{ vd.error }}</p>
      </div>
      </template>
      <template #footer>
        <button class="btn-outline flex-1 sm:flex-none" @click="voidFor = null">ปิด</button>
        <button class="btn-danger flex-1 sm:flex-none" @click="doVoid">ยืนยันยกเลิกบิล</button>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
/* ช่องวันที่ของ iOS/Android: ให้ข้อความอยู่กึ่งกลางแนวตั้งและสูงเท่าช่องอื่น */
.input-date {
  -webkit-appearance: none;
  appearance: none;
  line-height: 2.75rem;
  padding-block: 0;
  font-size: 0.9375rem;
}
</style>
