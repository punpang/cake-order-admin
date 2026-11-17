<script setup>
// บิล POS ที่ปิดแล้วย้อนหลัง · ดูบิล · ใบเสร็จ · ใบกำกับภาษี · ยกเลิกบิล (ใช้ระบบยกเลิกบิล POS เดิม: คืนสต็อก/คะแนน/คูปอง และใบลดหนี้)
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { db, can, findOrder, findCustomer, voidPosSale } from '../data/store'
import { getSupabase } from '../lib/supabase'
import { loadOrdersInRange } from '../lib/ordersSync'
import { orderTotals } from '../lib/pricing'
import { money, dateTime, toDateStr, orderNo } from '../lib/format'
import { closedPosBillsInRange } from '../lib/posBills'
import { defaultRefundMethod } from '../lib/refund'
import { invoiceOfOrder } from '../data/acct'
import { showToast } from '../lib/toast'
import AppModal from '../components/AppModal.vue'
import AppIcon from '../components/AppIcon.vue'
import Receipt from '../components/Receipt.vue'
import TaxInvoiceModal from '../components/TaxInvoiceModal.vue'
import RefundEditor from '../components/RefundEditor.vue'

const today = toDateStr(new Date())
const from = ref(today)
const to = ref(today)
const items = ref([])
const loading = ref(false)
const error = ref('')
const receipt = ref(null)
const taxFor = ref(null)
let seq = 0

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

const live = computed(() => items.value.filter((o) => o.status !== 'cancelled'))
const totalMoney = computed(() => live.value.reduce((s, o) => s + (orderTotals(o).total || 0), 0))
const cancelledCount = computed(() => items.value.length - live.value.length)
const taxable = (o) => can('taxInvoice') && o.status !== 'cancelled' && orderTotals(o).vat > 0
const canVoid = (o) => can('posVoid') && o.status !== 'cancelled'

// ---------- ยกเลิกบิล ----------
const voidFor = ref(null)
const vd = reactive({ reason: 'ยกเลิกบิล', refunds: [], note: '', error: '' })
const voidPaid = computed(() => (voidFor.value ? orderTotals(voidFor.value).paidNet : 0))
const voidDefault = computed(() => defaultRefundMethod(voidFor.value?.payments.find((p) => p.status === 'confirmed')?.posMethod))
function openVoid(o) {
  const target = findOrder(o.id)
  if (!target) return showToast('บิลนี้ยังไม่อยู่ในข้อมูลเครื่อง ลองรีเฟรชหน้าแล้วทำใหม่', 6000, 'error')
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
  <div class="mx-auto max-w-3xl space-y-4 px-4 py-4">
    <header class="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h1 class="text-xl font-bold text-stone-900">บิล POS ที่ปิดแล้ว</h1>
        <p class="text-sm text-stone-500">ดูย้อนหลังทุกกะ · ยกเลิกบิลได้</p>
      </div>
      <RouterLink to="/admin/pos" class="btn-outline h-10 px-3 text-sm">← กลับ POS</RouterLink>
    </header>

    <section class="card space-y-3">
      <div class="flex flex-wrap gap-2">
        <button type="button" class="btn-outline h-9 px-3 text-sm" @click="setRange('today')">วันนี้</button>
        <button type="button" class="btn-outline h-9 px-3 text-sm" @click="setRange('week')">7 วันล่าสุด</button>
        <button type="button" class="btn-outline h-9 px-3 text-sm" @click="setRange('month')">เดือนนี้</button>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <label class="block text-sm">
          <span class="mb-1 block text-stone-600">ตั้งแต่วันที่</span>
          <input v-model="from" type="date" class="input" aria-label="ตั้งแต่วันที่" />
        </label>
        <label class="block text-sm">
          <span class="mb-1 block text-stone-600">ถึงวันที่</span>
          <input v-model="to" type="date" :min="from" class="input" aria-label="ถึงวันที่" />
        </label>
      </div>
    </section>

    <section class="card grid grid-cols-2 gap-3 text-center sm:grid-cols-3">
      <div>
        <div class="text-xs text-stone-500">จำนวนบิล</div>
        <div class="text-lg font-bold tabular-nums">{{ live.length }}</div>
      </div>
      <div>
        <div class="text-xs text-stone-500">ยอดรวม (ไม่รวมยกเลิก)</div>
        <div class="text-lg font-bold tabular-nums">{{ money(totalMoney) }}</div>
      </div>
      <div>
        <div class="text-xs text-stone-500">ยกเลิก</div>
        <div class="text-lg font-bold tabular-nums">{{ cancelledCount }}</div>
      </div>
    </section>

    <section class="card">
      <p v-if="loading" class="py-8 text-center text-sm text-stone-500">กำลังโหลด…</p>
      <p v-else-if="error" class="py-8 text-center text-sm text-rose-700">โหลดบิลไม่สำเร็จ: {{ error }}</p>
      <p v-else-if="!items.length" class="py-8 text-center text-sm text-stone-500">ไม่มีบิลที่ปิดแล้วในช่วงวันที่นี้</p>
      <ul v-else class="divide-y divide-stone-100">
        <li v-for="o in items" :key="o.id" class="flex flex-wrap items-center gap-x-3 gap-y-2 py-3" :class="o.status === 'cancelled' ? 'opacity-60' : ''">
          <div class="min-w-0 flex-1 basis-48">
            <span class="block font-medium text-stone-900">{{ orderNo(o.code) }} <span class="text-xs font-normal text-stone-500">{{ dateTime(o.createdAt) }}</span></span>
            <span class="block truncate text-xs text-stone-500">{{ o.items.map((i) => `${i.name} ×${i.qty}`).join(', ') }}</span>
          </div>
          <span class="shrink-0 text-right text-sm">
            <b class="block text-stone-900">{{ money(orderTotals(o).total) }}</b>
            <span class="text-xs text-stone-500">{{ o.status === 'cancelled' ? 'ยกเลิกแล้ว' : (o.payments?.[0]?.method || '') }}</span>
          </span>
          <button type="button" class="btn-outline h-9 shrink-0 px-2.5 text-xs" @click="receipt = o">ใบเสร็จ</button>
          <button v-if="taxable(o)" type="button" class="btn-outline h-9 shrink-0 px-2.5 text-xs" @click="taxFor = o">ใบกำกับภาษี</button>
          <button v-if="canVoid(o)" type="button" class="btn-danger h-9 shrink-0 px-2.5 text-xs" @click="openVoid(o)">ยกเลิกบิล</button>
        </li>
      </ul>
    </section>

    <AppModal v-if="receipt" title="ใบเสร็จรับเงิน" @close="receipt = null">
      <Receipt :order="receipt" />
      <template #footer><button class="btn-primary flex-1 sm:flex-none" @click="receipt = null">ปิด</button></template>
    </AppModal>
    <TaxInvoiceModal v-if="taxFor" :order="taxFor" @close="taxFor = null" />

    <AppModal v-if="voidFor" :title="`ยกเลิกบิล ${orderNo(voidFor.code)}`" @close="voidFor = null">
      <div class="space-y-4">
        <p v-if="invoiceOfOrder(voidFor.id)" class="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">ออร์เดอร์นี้ออกใบกำกับภาษีไว้แล้ว ({{ invoiceOfOrder(voidFor.id).no }}) · เมื่อยกเลิกระบบจะออกใบลดหนี้ให้อัตโนมัติ</p>
        <p class="text-sm text-stone-500">ยกเลิกแล้วจะคืนสต็อก คืนคูปองที่ใช้ และตัดคะแนนที่ได้จากบิลนี้ · ยอดคืนเงินจะกระทบยอดของกะที่ปิดไปแล้ว</p>
        <div><label class="label">เหตุผล <span class="text-rose-600">*</span></label><input v-model="vd.reason" class="input" maxlength="120" /></div>
        <div>
          <div class="label">คืนเงินให้ลูกค้า</div>
          <RefundEditor v-model="vd.refunds" :paid="voidPaid" :can-points="!!voidFor.customerId && !!findCustomer(voidFor.customerId) && !findCustomer(voidFor.customerId).deleted" :default-method="voidDefault" />
        </div>
        <div><label class="label">หมายเหตุการคืนเงิน</label><input v-model="vd.note" class="input" maxlength="120" /></div>
        <p v-if="vd.error" class="flex items-center gap-2 text-sm text-rose-700"><AppIcon name="alert" :size="16" /> {{ vd.error }}</p>
      </div>
      <template #footer>
        <button class="btn-outline flex-1 sm:flex-none" @click="voidFor = null">ปิด</button>
        <button class="btn-danger flex-1 sm:flex-none" @click="doVoid">ยืนยันยกเลิกบิล</button>
      </template>
    </AppModal>
  </div>
</template>
