<script setup>
// รายการออร์เดอร์สั่งล่วงหน้าสำหรับร้าน: ยืนยันเงินสด · จัดส่ง · รับแล้ว · ตีกลับ · ตัดสินคืนเงินหรือจัดส่งใหม่ · ขยายเวลา
// ทุกการกระทำเรียก preorder-admin และฐานข้อมูลเป็นผู้ตรวจกฎ (ยอด สถานะ) หน้านี้แค่ส่งข้อมูลที่กรอก
import { computed, onMounted, reactive, ref } from 'vue'
import { shippableOrders, splitPaste, applyPaste, postageValue, validateBatch } from '../../lib/preorderShipBatch'
import { preorderAdminCall } from '../../lib/preorderAdminRemote'
import { buildIssuePayload, EMPTY_ISSUE_FORM } from '../../lib/preorderIssueForm'

const orders = ref([])
const loading = ref(true)
const msg = ref('')
const f = reactive({}) // orderId → ค่าที่กรอกของแต่ละออร์เดอร์

const STATUS = { awaiting_payment: 'รอชำระมัดจำ', payment_confirmed: 'ชำระมัดจำแล้ว', shipped: 'ส่งแล้ว', delivered: 'ได้รับแล้ว', returned: 'ตีกลับ/รับคืน', expired: 'หมดเวลา', cancelled: 'ยกเลิก' }
const METHOD = { cash: 'เงินสด', bank: 'โอนบัญชี', points: 'คะแนน' }
// ตัวกรองตามสถานะ: แต่ละกลุ่มรวมสถานะที่ต้องจัดการแบบเดียวกัน
const FILTERS = [
  { key: 'all', label: 'ทั้งหมด', match: () => true },
  { key: 'awaiting', label: 'รอชำระมัดจำ', match: (o) => o.status === 'awaiting_payment' },
  { key: 'paid', label: 'ชำระมัดจำแล้ว', match: (o) => o.status === 'payment_confirmed' },
  { key: 'shipped', label: 'ส่งแล้ว', match: (o) => o.status === 'shipped' },
  { key: 'delivered', label: 'ได้รับแล้ว', match: (o) => o.status === 'delivered' },
  { key: 'returned', label: 'ตีกลับ/รับคืน', match: (o) => o.status === 'returned' },
  { key: 'ended', label: 'ยกเลิกหรือหมดเวลา', match: (o) => o.status === 'cancelled' || o.status === 'expired' },
]
const filter = ref('all')
const countOf = (key) => orders.value.filter(FILTERS.find((x) => x.key === key).match).length
const shown = computed(() => orders.value.filter(FILTERS.find((x) => x.key === filter.value).match))

async function load() {
  loading.value = true
  const r = await preorderAdminCall('list')
  loading.value = false
  if (r.error) { msg.value = r.error; return }
  orders.value = r.orders || []
}

// กรอกการส่งทั้งชุด: เลือกออร์เดอร์ที่พร้อมส่ง วางเลขพัสดุทั้งชุดแล้วจับคู่ตามแถว · บันทึกทีละรายการ และเก็บแถวที่ไม่สำเร็จไว้พร้อมเหตุผล
const CARRIER_KEY = 'punpang_ship_carrier'
const batch = reactive({ open: false, carrier: '', postageAll: '', paste: '', rows: [], errors: { carrierError: '', rowErrors: {} }, results: {}, saving: false })
const trackRefs = []
function savedCarrier() { try { return localStorage.getItem(CARRIER_KEY) || '' } catch { return '' } }
function rememberCarrier(c) { try { localStorage.setItem(CARRIER_KEY, c) } catch { /* ไม่มีที่เก็บในเครื่อง ข้าม */ } }
function openBatch() {
  batch.open = true
  batch.carrier = savedCarrier()
  batch.rows = shippableOrders(orders.value).map((o) => ({ orderId: o.id, code: o.code, customer: o.customerName || '', tracking: '', postage: '' }))
  batch.paste = ''
  batch.errors = { carrierError: '', rowErrors: {} }
  batch.results = {}
}
function applyPasteToRows() {
  const r = applyPaste(batch.rows, splitPaste(batch.paste))
  batch.rows = r.rows
  if (r.leftover) msg.value = `มีเลขพัสดุเกินจำนวนแถว ${r.leftover} รายการ ไม่ได้ใช้`
}
function fillPostageAll() { batch.rows.forEach((r) => { r.postage = batch.postageAll }) }
function focusNext(i) { trackRefs[i + 1]?.focus() }
async function saveBatch() {
  batch.errors = validateBatch(batch.rows, batch.carrier)
  if (batch.errors.carrierError || Object.keys(batch.errors.rowErrors).length) { msg.value = 'กรอกข้อมูลให้ถูกต้องก่อนบันทึก'; return }
  const carrier = batch.carrier.trim()
  rememberCarrier(carrier)
  batch.saving = true
  batch.results = {}
  const left = []
  let ok = 0
  for (const r of batch.rows) {
    const res = await preorderAdminCall('set_shipping', { orderId: r.orderId, carrier, trackingNo: r.tracking.trim().toUpperCase(), postage: postageValue(r.postage) })
    if (res.error) { left.push(r); batch.results[r.orderId] = res.error } else ok += 1
  }
  batch.saving = false
  batch.rows = left
  msg.value = `บันทึกการส่งสำเร็จ ${ok} รายการ${left.length ? ` · ไม่สำเร็จ ${left.length} รายการ (ดูเหตุผลในแถว)` : ''}`
  if (!left.length) batch.open = false
  await load()
}

// สรุปรายการที่โหลดแล้ว: ยอดรับแล้ว/คงค้าง (ไม่นับยกเลิกและหมดเวลา) และจำนวนตามสถานะ
const summary = computed(() => {
  const by = {}
  let paid = 0
  let due = 0
  let value = 0
  let postage = 0
  for (const o of orders.value) {
    by[o.status] = (by[o.status] || 0) + 1
    postage += Number(o.shipping?.postage) || 0
    if (o.status === 'cancelled' || o.status === 'expired') continue
    paid += Number(o.paid) || 0
    value += Number(o.total) || 0
    due += Math.max(0, (Number(o.total) || 0) - (Number(o.paid) || 0))
  }
  const r2 = (n) => Math.round(n * 100) / 100
  return { count: orders.value.length, by, paid: r2(paid), due: r2(due), value: r2(value), postage: r2(postage) }
})

function box(id) {
  if (!f[id]) f[id] = { amount: '', method: 'cash', carrier: '', tracking: '', postage: '', reason: '', fee: '', newDue: '' }
  return f[id]
}

// ฟอร์มผู้ซื้อของใบกำกับภาษี (แยกคีย์จากฟอร์มอื่นของออร์เดอร์เดียวกัน)
function invoiceBox(id) {
  const k = `inv:${id}`
  if (!f[k]) f[k] = { ...EMPTY_ISSUE_FORM }
  return f[k]
}
async function issueInvoice(o) {
  msg.value = ''
  const built = buildIssuePayload(o.id, invoiceBox(o.id))
  if (built.error) { msg.value = `${o.code}: ${built.error}`; return }
  const r = await preorderAdminCall('issue_invoice', built.payload)
  if (r.error) { msg.value = `${o.code}: ${r.error}`; return }
  msg.value = `${o.code}: ออกใบกำกับภาษีเลขที่ ${r.result?.no || ''} แล้ว`
  await load()
}

async function act(o, action, payload, okText) {
  msg.value = ''
  const r = await preorderAdminCall(action, { orderId: o.id, ...payload })
  if (r.error) { msg.value = `${o.code}: ${r.error}`; return }
  msg.value = `${o.code}: ${okText}`
  await load()
}

// ปุ่มหลักของออร์เดอร์ = ขั้นถัดไปตามสถานะ (ขึ้นบนสุด) · ปุ่มอื่นซ่อนไว้จนกด "ตัวเลือกเพิ่มเติม"
const more = reactive({})
const isReady = (o) => !!o.pickupRound && !o.readyAt && !['cancelled', 'expired', 'delivered', 'returned'].includes(o.status)
const isShip = (o) => o.status === 'payment_confirmed' && o.fulfillment === 'delivery' && !o.shipping
const blocksOf = (o) => {
  const k = []
  if (['awaiting_payment', 'payment_confirmed', 'expired'].includes(o.status)) k.push('cash')
  if (isReady(o)) k.push('ready')
  if (isShip(o)) k.push('ship')
  if (o.status === 'shipped') k.push('shipped')
  if (o.status === 'delivered') k.push('received')
  if (o.status === 'returned' && lastDecidable(o)) k.push('refund')
  if (o.status === 'expired') k.push('extend')
  return k
}
const primaryOf = (o) => {
  if (o.status === 'expired') return 'extend'
  if (isReady(o)) return 'ready'
  if (isShip(o)) return 'ship'
  if (o.status === 'shipped') return 'shipped'
  if (o.status === 'returned' && lastDecidable(o)) return 'refund'
  if (o.status === 'delivered') return 'received'
  if (['awaiting_payment', 'payment_confirmed'].includes(o.status)) return 'cash'
  return null
}
const hiddenFor = (o, k) => blocksOf(o).includes(k) && primaryOf(o) !== k && !more[o.id]
const blockClass = (o, k) => ({ 'order-first': primaryOf(o) === k, hidden: hiddenFor(o, k) })
const orderOf = (o, k) => ({ 'order-first': primaryOf(o) === k })

const lastDecidable = (o) => {
  const rs = o.returns || []
  return rs.length && rs[rs.length - 1].decision == null
}

onMounted(load)
</script>

<template>
  <section class="card mb-4" data-preorder-orders>
    <h2 class="text-base font-semibold text-stone-800">ออร์เดอร์สั่งล่วงหน้า</h2>
    <p v-if="loading" class="mt-2 text-sm text-stone-500">กำลังโหลด…</p>
    <p v-if="!loading && orders.length" class="mt-2 text-sm text-stone-600" data-preorder-summary>
      ทั้งหมด {{ summary.count }} ออร์เดอร์ · รับแล้ว {{ summary.paid }} บาท · คงค้าง {{ summary.due }} บาท ·
      รอชำระ {{ summary.by.awaiting_payment || 0 }} · ส่งแล้ว {{ summary.by.shipped || 0 }} · ได้รับแล้ว {{ summary.by.delivered || 0 }} ·
      ยกเลิก/หมดเวลา {{ (summary.by.cancelled || 0) + (summary.by.expired || 0) }}
    </p>
    <p v-if="!loading && orders.length" class="mt-1 text-sm text-stone-600" data-preorder-report>
      ยอดออร์เดอร์ {{ summary.value }} บาท · ค่าไปรษณีย์ที่บันทึกแล้ว {{ summary.postage }} บาท
    </p>
    <p v-if="msg" class="mt-2 text-sm text-stone-700" role="status">{{ msg }}</p>
    <div v-if="orders.length" role="group" aria-label="กรองตามสถานะ" class="mt-3 flex flex-wrap gap-2" data-order-filter>
      <button v-for="g in FILTERS" :key="g.key" type="button" class="chip h-11 px-3 text-sm" :class="filter === g.key ? 'chip-on' : 'chip-off'" :aria-pressed="filter === g.key" @click="filter = g.key">{{ g.label }} {{ countOf(g.key) }}</button>
    </div>
    <p v-if="!loading && !orders.length" class="mt-2 text-sm text-stone-500">ยังไม่มีออร์เดอร์</p>
    <p v-if="!loading && orders.length && !shown.length" class="mt-3 text-sm text-stone-500">ไม่มีออร์เดอร์ในสถานะนี้</p>
    <div class="mt-3" data-ship-batch-root>
      <button v-if="!batch.open" type="button" class="btn-primary h-11 px-4" @click="openBatch">กรอกการส่งทั้งชุด</button>
      <div v-else class="space-y-3 rounded-xl border border-stone-200 p-3">
        <div class="flex flex-wrap items-end gap-2">
          <label class="text-sm">ขนส่ง <input v-model="batch.carrier" class="input h-11 w-44" aria-label="ชื่อขนส่งทั้งชุด" placeholder="เช่น ไปรษณีย์ไทย" /></label>
          <label class="text-sm">ค่าไปรษณีย์ <input v-model="batch.postageAll" type="number" min="0" step="0.01" class="input h-11 w-28" aria-label="ค่าไปรษณีย์ที่จะใส่ทุกแถว (บาท)" /></label>
          <button type="button" class="btn-outline h-11 px-3" @click="fillPostageAll">ใส่ค่านี้ทุกแถว</button>
        </div>
        <p v-if="batch.errors.carrierError" class="text-sm text-rose-700" role="alert">{{ batch.errors.carrierError }}</p>
        <label class="block text-sm">วางเลขพัสดุ (หนึ่งบรรทัดต่อหนึ่งออร์เดอร์ เรียงตามแถว)
          <textarea v-model="batch.paste" rows="3" class="input mt-1 w-full" aria-label="วางเลขพัสดุทั้งชุด"></textarea>
        </label>
        <button type="button" class="btn-outline h-11 px-3" @click="applyPasteToRows">จับคู่เลขกับแถว</button>
        <p v-if="!batch.rows.length" class="text-sm text-stone-500">ไม่มีออร์เดอร์ที่พร้อมส่ง</p>
        <div v-else class="space-y-2">
          <div class="hidden grid-cols-4 gap-2 text-xs text-stone-500 md:grid"><span>รหัส / ลูกค้า</span><span>เลขพัสดุ</span><span>ค่าไปรษณีย์ (บาท)</span><span></span></div>
          <div v-for="(r, i) in batch.rows" :key="r.orderId" class="grid grid-cols-1 gap-2 rounded-xl border border-stone-100 p-2 md:grid-cols-4 md:items-start">
            <div class="text-sm"><div class="font-mono">{{ r.code }}</div><div class="text-stone-600">{{ r.customer }}</div></div>
            <div>
              <input :ref="(el) => { trackRefs[i] = el }" v-model="r.tracking" class="input h-11 w-full" :aria-label="`เลขพัสดุ ${r.code}`" @keydown.enter.prevent="focusNext(i)" />
              <div v-if="batch.errors.rowErrors[r.orderId] || batch.results[r.orderId]" class="mt-1 text-xs text-rose-700">{{ batch.errors.rowErrors[r.orderId] || batch.results[r.orderId] }}</div>
            </div>
            <input v-model="r.postage" type="number" min="0" step="0.01" class="input h-11 w-full" :aria-label="`ค่าไปรษณีย์ ${r.code}`" placeholder="ค่าไปรษณีย์" />
            <span></span>
          </div>
        </div>
        <div class="flex flex-wrap gap-2">
          <button type="button" class="btn-primary h-11 px-4" :disabled="batch.saving || !batch.rows.length" @click="saveBatch">{{ batch.saving ? 'กำลังบันทึก…' : `บันทึก ${batch.rows.length} รายการ` }}</button>
          <button type="button" class="btn-outline h-11 px-4" @click="batch.open = false">ปิด</button>
        </div>
      </div>
    </div>
    <ul class="mt-3 space-y-3">
      <li v-for="o in shown" :key="o.id" class="rounded-xl border border-stone-200 p-3 text-sm" :data-order-code="o.code">
        <div class="flex items-center justify-between gap-2">
          <span class="font-medium">{{ o.code }} · {{ o.customerName }}</span>
          <span class="rounded-full bg-stone-100 px-2 py-0.5 text-xs">{{ STATUS[o.status] || o.status }}</span>
        </div>
        <div class="mt-1 text-stone-600">ยอดรวม {{ o.total }} · ชำระแล้ว {{ o.paid }} · ค่าส่ง {{ o.shippingFee }} · รับ {{ o.pickupDate }}</div>
        <div v-if="o.shipping" class="text-stone-600">เลขพัสดุ {{ o.shipping.trackingNo }} ({{ o.shipping.carrier }})</div>

        <div class="mt-3 flex flex-col gap-2" data-actions>
        <!-- ยืนยันเงินสด -->
        <div v-if="blocksOf(o).includes('cash')" data-action="cash" class="flex flex-wrap items-center gap-2" :class="blockClass(o, 'cash')">
          <input v-model="box(o.id).amount" type="number" min="0" step="0.01" class="input h-11 w-36" aria-label="ยอดเงินสด" placeholder="ยอดเงินสด" />
          <button type="button" class="btn-outline h-11 px-3" @click="act(o, 'record_payment', { amount: Number(box(o.id).amount), method: 'cash' }, 'บันทึกเงินสดแล้ว')">รับเงินสด</button>
        </div>

        <!-- เลขพัสดุ -->
        <div v-if="o.pickupRound" class="flex flex-wrap items-center gap-2" :class="orderOf(o, 'ready')">
          <button v-if="isReady(o)" type="button" data-action="ready" class="btn-outline h-11 px-3" :class="{ hidden: hiddenFor(o, 'ready') }" @click="act(o, 'mark_ready', {}, 'บันทึกว่าเตรียมเสร็จแล้ว')">เตรียมเสร็จ (รอบ {{ o.pickupRound }})</button>
          <span v-if="o.readyAt" class="text-xs text-emerald-700">เตรียมเสร็จแล้ว</span>
        </div>
        <div v-if="isShip(o)" data-action="ship" class="flex flex-wrap items-center gap-2" :class="blockClass(o, 'ship')">
          <input v-model="box(o.id).carrier" class="input h-11 w-28" placeholder="ขนส่ง" aria-label="ชื่อขนส่ง" />
          <input v-model="box(o.id).tracking" class="input h-11 w-36" placeholder="เลขพัสดุ" aria-label="เลขพัสดุ" />
          <input v-model="box(o.id).postage" type="number" min="0" step="0.01" class="input h-11 w-36" placeholder="ค่าไปรษณีย์ (บาท)" aria-label="ค่าไปรษณีย์จริง (บาท)" />
          <button type="button" class="btn-primary h-11 px-3" @click="act(o, 'set_shipping', { carrier: box(o.id).carrier, trackingNo: box(o.id).tracking, postage: box(o.id).postage === '' ? 0 : Number(box(o.id).postage) }, 'บันทึกเลขพัสดุแล้ว')">บันทึกการส่ง</button>
        </div>

        <!-- ได้รับแล้ว / ตีกลับ -->
        <div v-if="o.status === 'shipped'" data-action="shipped" class="flex flex-wrap items-center gap-2" :class="blockClass(o, 'shipped')">
          <button type="button" class="btn-outline h-11 px-3" @click="act(o, 'mark_delivered', {}, 'ยืนยันรับแล้ว')">ยืนยันรับแล้ว</button>
          <input v-model="box(o.id).reason" class="input h-11 w-44" placeholder="เหตุผลตีกลับ" aria-label="เหตุผลตีกลับ" />
          <button type="button" class="btn-outline h-11 px-3" @click="act(o, 'record_return', { reason: box(o.id).reason }, 'บันทึกการตีกลับแล้ว')">บันทึกตีกลับ</button>
        </div>
        <div v-if="o.status === 'delivered'" data-action="received" class="flex flex-wrap items-center gap-2" :class="blockClass(o, 'received')">
          <input v-model="box(o.id).reason" class="input h-11 w-44" placeholder="เหตุผลรับคืน" aria-label="เหตุผลรับคืน" />
          <button type="button" class="btn-outline h-11 px-3" @click="act(o, 'record_return', { reason: box(o.id).reason }, 'บันทึกการรับคืนแล้ว')">บันทึกรับคืน</button>
        </div>

        <!-- ใบกำกับภาษีเต็มรูป: ออกได้หลังส่งมอบ · แสดงเสมอ ไม่ซ่อนใต้ตัวเลือกเพิ่มเติม -->
        <div v-if="o.status === 'delivered'" data-action="invoice" class="space-y-2 rounded-lg bg-stone-50 p-2">
          <div class="text-sm font-medium text-stone-700">ใบกำกับภาษีเต็มรูป</div>
          <div class="grid grid-cols-1 gap-2 md:grid-cols-2">
            <input v-model="invoiceBox(o.id).name" class="input h-11" placeholder="ชื่อผู้ซื้อ" aria-label="ชื่อผู้ซื้อ" />
            <input v-model="invoiceBox(o.id).taxId" inputmode="numeric" maxlength="17" class="input h-11" placeholder="เลขประจำตัวผู้เสียภาษี 13 หลัก" aria-label="เลขประจำตัวผู้เสียภาษีผู้ซื้อ" />
            <input v-model="invoiceBox(o.id).branch" inputmode="numeric" maxlength="5" class="input h-11" placeholder="สาขา (00000 = สำนักงานใหญ่)" aria-label="รหัสสาขาผู้ซื้อ" />
            <input v-model="invoiceBox(o.id).address" class="input h-11 md:col-span-2" placeholder="ที่อยู่ผู้ซื้อ" aria-label="ที่อยู่ผู้ซื้อ" />
          </div>
          <button type="button" class="btn-primary h-11 px-3" @click="issueInvoice(o)">ออกใบกำกับภาษี</button>
        </div>

        <!-- ตัดสิน: คืนเงิน (ริบค่าส่ง) หรือจัดส่งใหม่ (ริบค่าส่งเดิม) -->
        <div v-if="o.status === 'returned' && lastDecidable(o)" data-action="refund" class="space-y-2" :class="blockClass(o, 'refund')">
          <div class="flex flex-wrap items-center gap-2">
            <input v-model="box(o.id).amount" type="number" min="0" step="0.01" class="input h-11 w-36" aria-label="ยอดคืนเงิน" placeholder="ยอดคืนเงิน" />
            <select v-model="box(o.id).method" class="input h-11 w-28" aria-label="วิธีคืนเงิน">
              <option value="cash">เงินสด</option>
              <option value="bank">โอนบัญชี</option>
              <option value="points">คะแนน</option>
            </select>
            <button type="button" class="btn-primary h-11 px-3" @click="act(o, 'refund_return', { refunds: [{ amount: Number(box(o.id).amount), method: box(o.id).method }] }, 'คืนเงินแล้ว (ค่าส่งเดิมถูกริบ)')">คืนเงิน</button>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <input v-model="box(o.id).fee" type="number" min="0" step="0.01" class="input h-11 w-36" aria-label="ค่าส่งใหม่" placeholder="ค่าส่งใหม่" />
            <button type="button" class="btn-outline h-11 px-3" @click="act(o, 'reship', { newFee: Number(box(o.id).fee) }, 'ตั้งจัดส่งใหม่แล้ว ลูกค้าต้องชำระค่าส่งใหม่')">จัดส่งใหม่</button>
          </div>
        </div>

        <!-- ขยายเวลา -->
        <div v-if="o.status === 'expired'" data-action="extend" class="flex flex-wrap items-center gap-2" :class="blockClass(o, 'extend')">
          <input v-model="box(o.id).newDue" type="datetime-local" class="input h-11 w-48" aria-label="เวลากำหนดชำระใหม่" />
          <button type="button" class="btn-outline h-11 px-3" @click="act(o, 'extend', { newDue: new Date(box(o.id).newDue).toISOString() }, 'อนุมัติขยายเวลาแล้ว')">อนุมัติขยายเวลา</button>
        </div>
        <button v-if="blocksOf(o).length > 1" type="button" class="btn-outline h-11 self-start px-3 text-sm" :aria-expanded="!!more[o.id]" @click="more[o.id] = !more[o.id]">{{ more[o.id] ? 'ซ่อนตัวเลือกเพิ่มเติม' : 'ตัวเลือกเพิ่มเติม' }}</button>
        </div>
      </li>
    </ul>
  </section>
</template>
