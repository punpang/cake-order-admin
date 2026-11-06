<script setup>
import { computed, reactive, ref } from 'vue'
import {
  db, can, activeListsAt, currentShift, openShift, closeShift, shiftSummary, shiftBills, posItems, posSale, voidPosSale,
  customerPoints, usableDiscountCoupons, findCustomer, modsOf, modsText, lineKey,
} from '../data/store'
import { orderTotals, productPrice } from '../lib/pricing'
import { POS_METHODS, ROLES } from '../lib/constants'
import { askConfirm } from '../lib/confirm'
import { money, dateTime, timeOnly, phoneDigits, formatPhone } from '../lib/format'
import AppIcon from '../components/AppIcon.vue'
import AppModal from '../components/AppModal.vue'
import DiscountDetail from '../components/DiscountDetail.vue'
import Receipt from '../components/Receipt.vue'

// POS หน้าร้าน: เปิดกะ → ขาย (ตะกร้า สมาชิก คะแนน/คูปอง ส่วนลด) → ชำระ (เงินสด/โอน/บัตร + ทอน) → ใบเสร็จ · บิล · ปิดกะ
const shift = computed(() => currentShift())
const tab = ref('sell')

// ---------- เปิดกะ ----------
const float = ref('')
function doOpen() {
  openShift(Number(float.value) || 0)
  float.value = ''
}

// ---------- สินค้า ----------
const active = computed(() => activeListsAt())
const catalog = computed(() => [
  ...db.products.filter((p) => p.active !== false).map((p) => ({ kind: 'ready', id: p.id, name: p.name, category: 'เค้กสำเร็จ', price: productPrice(p, db.optionGroups, active.value), stock: p.stock ?? null })),
  ...db.retailItems.filter((r) => r.active !== false).map((r) => ({ kind: 'retail', id: r.id, name: r.name, category: r.category || 'อื่น ๆ', price: r.price, stock: r.stock ?? null, modifierIds: r.modifierIds || [] })),
])
const categories = computed(() => [...new Set(catalog.value.map((x) => x.category))])
const cat = ref('')
const q = ref('')
const shown = computed(() => {
  const s = q.value.trim().toLowerCase()
  return catalog.value.filter((x) => (!cat.value || x.category === cat.value) && (!s || x.name.toLowerCase().includes(s)))
})

// ---------- ตะกร้า ----------
const cart = ref([]) // [{ kind, refId, qty, mods: [{ groupId, optionId }] }] แยกบรรทัดตามชุดตัวเลือก
// จำนวนในตะกร้าของสินค้า (รวมทุกบรรทัด ใช้ตรวจสต็อก)
const inCart = (x) => cart.value.filter((l) => l.kind === x.kind && l.refId === x.id).reduce((s, l) => s + l.qty, 0)
const canAdd = (x, n = 1) => x.stock == null || inCart(x) + n <= x.stock
const itemOf = (l) => catalog.value.find((c) => c.kind === l.kind && c.id === l.refId)
const groupsOf = (x) => (x.modifierIds || []).map((id) => db.posModifiers.find((m) => m.id === id)).filter((g) => g && g.active !== false && g.options.length)
const linePrice = (l) => (itemOf(l)?.price || 0) + modsOf(l.mods).reduce((s, m) => s + m.price, 0)
function addLine(x, mods, qty) {
  const key = lineKey({ kind: x.kind, refId: x.id, mods })
  const l = cart.value.find((y) => lineKey(y) === key)
  if (l) l.qty += qty
  else cart.value.push({ kind: x.kind, refId: x.id, qty, mods })
}
function add(x) {
  if (!canAdd(x)) return
  if (groupsOf(x).length) return openMods(x)
  addLine(x, [], 1)
}
function step(l, d) {
  const x = itemOf(l)
  if (d > 0 && x && !canAdd(x)) return
  l.qty += d
  if (l.qty <= 0) cart.value.splice(cart.value.indexOf(l), 1)
}

// ---------- เลือกตัวเลือกสินค้า (เช่น หวานน้อย แยกน้ำแข็ง) ----------
const modFor = ref(null) // { x, line (แก้บรรทัดเดิม), sel: { [groupId]: optionId | [optionId] }, qty }
function openMods(x, line = null) {
  const sel = {}
  for (const g of groupsOf(x)) {
    const cur = (line?.mods || []).filter((m) => m.groupId === g.id).map((m) => m.optionId)
    sel[g.id] = g.type === 'multi' ? cur : cur[0] || (g.required ? g.options[0].id : null)
  }
  modFor.value = { x, line, sel, qty: line?.qty || 1 }
}
function pickMod(g, o) {
  const s = modFor.value.sel
  if (g.type === 'multi') s[g.id] = s[g.id].includes(o.id) ? s[g.id].filter((v) => v !== o.id) : [...s[g.id], o.id]
  else s[g.id] = s[g.id] === o.id && !g.required ? null : o.id
}
const isPicked = (g, o) => (g.type === 'multi' ? modFor.value.sel[g.id].includes(o.id) : modFor.value.sel[g.id] === o.id)
const modSel = computed(() =>
  modFor.value ? Object.entries(modFor.value.sel).flatMap(([gid, v]) => (Array.isArray(v) ? v : v ? [v] : []).map((oid) => ({ groupId: gid, optionId: oid }))) : [],
)
const modPrice = computed(() => (modFor.value ? (modFor.value.x.price + modsOf(modSel.value).reduce((s, m) => s + m.price, 0)) * modFor.value.qty : 0))
const modMissing = computed(() => (modFor.value ? groupsOf(modFor.value.x).filter((g) => g.required && !modFor.value.sel[g.id]).map((g) => g.name) : []))
const modQtyMax = computed(() => (modFor.value?.x.stock == null ? 99 : modFor.value.x.stock - inCart(modFor.value.x) + (modFor.value.line?.qty || 0)))
function saveMods() {
  const f = modFor.value
  if (modMissing.value.length || f.qty < 1 || f.qty > modQtyMax.value) return
  if (f.line) cart.value.splice(cart.value.indexOf(f.line), 1)
  addLine(f.x, modSel.value, f.qty)
  modFor.value = null
}
const count = computed(() => cart.value.reduce((s, l) => s + l.qty, 0))
const cartOpen = ref(false) // มือถือ: แผงตะกร้าแบบ bottom sheet

// สมาชิก / คะแนน / คูปอง / ส่วนลด
const memberQ = ref('')
const member = ref(null)
const memberMatches = computed(() => {
  const s = memberQ.value.trim().toLowerCase()
  if (s.length < 2) return []
  const d = phoneDigits(s)
  return db.customers.filter((c) => c.active !== false && (c.name.toLowerCase().includes(s) || (d.length >= 3 && c.phone?.includes(d)))).slice(0, 5)
})
const usePoints = ref('')
const couponIds = ref([])
const discount = ref('')
function pickMember(c) {
  member.value = c
  memberQ.value = ''
  usePoints.value = ''
  couponIds.value = []
}
const coupons = computed(() => (member.value ? usableDiscountCoupons(member.value) : []))
const toggleCoupon = (id) => (couponIds.value = couponIds.value.includes(id) ? couponIds.value.filter((x) => x !== id) : [...couponIds.value, id])

// ราคา (ตัวอย่างก่อนบันทึก)
const preview = computed(() => {
  const items = posItems(cart.value)
  const pts = member.value ? Math.max(0, Math.floor(Number(usePoints.value) || 0)) : 0
  const cps = coupons.value.filter((c) => couponIds.value.includes(c.id))
  return orderTotals({
    items, fulfillment: 'pickup', payments: [],
    adjustment: { amount: -(Number(discount.value) || 0), reason: 'ส่วนลดหน้าร้าน' },
    pointsUsed: pts ? { points: pts, amount: pts * db.loyalty.pointValue } : null,
    couponsUsed: cps.map((c) => ({ couponId: c.id, name: c.name, amount: c.amount })),
  })
})
const total = computed(() => Math.max(preview.value.total, 0))
const maxPoints = computed(() => (member.value ? Math.min(customerPoints(member.value), Math.floor((preview.value.total + (preview.value.pointsDiscount || 0)) / db.loyalty.pointValue)) : 0))
const pointsError = computed(() => (Number(usePoints.value) > maxPoints.value ? `ใช้ได้สูงสุด ${maxPoints.value} คะแนน` : ''))

// ---------- ชำระเงิน ----------
const payOpen = ref(false)
const pay = reactive({ method: 'cash', received: '' })
function openPay() {
  if (!cart.value.length || pointsError.value) return
  Object.assign(pay, { method: 'cash', received: '' })
  payOpen.value = true
}
const quick = computed(() => {
  const t = total.value
  return [...new Set([t, Math.ceil(t / 100) * 100, Math.ceil(t / 500) * 500, Math.ceil(t / 1000) * 1000])].filter((v) => v >= t)
})
const change = computed(() => (Number(pay.received) || 0) - total.value)
const canConfirm = computed(() => pay.method !== 'cash' || change.value >= 0)
const receipt = ref(null)
function confirmPay() {
  if (!canConfirm.value) return
  const o = posSale({
    cart: cart.value, customerId: member.value?.id || null, points: Number(usePoints.value) || 0, couponIds: couponIds.value,
    discount: can('adjustPrice') ? Number(discount.value) || 0 : 0, method: pay.method, received: pay.method === 'cash' ? Number(pay.received) : null,
  })
  if (!o) return
  payOpen.value = false
  cartOpen.value = false
  receipt.value = o
  cart.value = []
  member.value = null
  usePoints.value = ''
  couponIds.value = []
  discount.value = ''
}
const print = () => window.print()

// ---------- บิลของกะ ----------
const bills = computed(() => (shift.value ? shiftBills(shift.value.id) : []))
async function doVoid(o) {
  if (await askConfirm({ title: 'ยกเลิกบิล', message: `${o.code} · ${money(orderTotals(o).total)} (คืนสต็อก + คะแนน)`, okText: 'ยกเลิกบิล', danger: true })) voidPosSale(o)
}

// ---------- ปิดกะ ----------
const summary = computed(() => (shift.value ? shiftSummary(shift.value) : null))
const counted = ref('')
async function doClose() {
  const diff = (Number(counted.value) || 0) - summary.value.expectedCash
  if (await askConfirm({ title: 'ปิดกะ', message: `เงินสดนับได้ ${money(Number(counted.value) || 0)} · ส่วนต่าง ${money(diff)}`, okText: 'ปิดกะ' })) {
    closeShift(Number(counted.value) || 0)
    counted.value = ''
    tab.value = 'sell'
  }
}
const closedShifts = computed(() => db.shifts.filter((s) => s.closedAt).slice(0, 10))
</script>

<template>
  <div v-if="!can('pos')" class="card py-10 text-center text-stone-500">บทบาทนี้ใช้ POS ไม่ได้</div>

  <div v-else class="mx-auto max-w-6xl">
    <!-- หัว -->
    <div class="mb-3 flex flex-wrap items-center gap-2">
      <RouterLink to="/admin/orders" class="flex h-10 w-10 items-center justify-center rounded-xl border border-stone-200 bg-white text-stone-700 md:hidden" aria-label="กลับ"><AppIcon name="back" :size="20" /></RouterLink>
      <h1 class="text-xl font-semibold text-stone-900">POS หน้าร้าน</h1>
      <span v-if="shift" class="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">กะเปิด {{ timeOnly(shift.openedAt) }} · {{ ROLES[shift.openedBy] }}</span>
      <div v-if="shift" class="ml-auto grid grid-cols-3 gap-1 rounded-xl bg-stone-100 p-1">
        <button v-for="t in [{ v: 'sell', l: 'ขาย' }, { v: 'bills', l: `บิล ${bills.length}` }, { v: 'shift', l: 'ปิดกะ' }]" :key="t.v" type="button" class="h-9 rounded-lg px-3 text-sm font-medium" :class="tab === t.v ? 'bg-white text-brand-800 shadow-sm' : 'text-stone-600'" @click="tab = t.v">{{ t.l }}</button>
      </div>
    </div>

    <!-- เปิดกะ -->
    <section v-if="!shift" class="card mx-auto max-w-md">
      <div class="card-title"><AppIcon name="pos" class="text-brand-600" /> เปิดกะก่อนขาย</div>
      <label class="label">เงินทอนตั้งต้นในลิ้นชัก (บาท)</label>
      <input v-model="float" type="text" v-num.dec class="input text-lg font-semibold" placeholder="0" />
      <button type="button" class="btn-primary mt-3 w-full" @click="doOpen">เปิดกะ</button>
      <div v-if="closedShifts.length" class="mt-5 border-t border-stone-100 pt-4">
        <div class="label">กะที่ผ่านมา</div>
        <ul class="space-y-1.5 text-sm">
          <li v-for="s in closedShifts" :key="s.id" class="flex justify-between gap-2 rounded-lg bg-stone-50 px-3 py-2">
            <span>{{ dateTime(s.openedAt) }} – {{ timeOnly(s.closedAt) }}</span>
            <span :class="s.counted - s.summary.expectedCash === 0 ? 'text-stone-600' : 'text-amber-700'">{{ money(s.summary.total) }} · ต่าง {{ money(s.counted - s.summary.expectedCash) }}</span>
          </li>
        </ul>
      </div>
    </section>

    <!-- ขาย -->
    <div v-else-if="tab === 'sell'" class="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
      <section class="min-w-0 pb-24 lg:pb-0">
        <div class="mb-3 flex gap-2">
          <label class="relative min-w-0 flex-1">
            <span class="sr-only">ค้นหาสินค้า</span>
            <AppIcon name="search" class="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-stone-400" />
            <input v-model="q" type="search" class="input bg-white pl-10" placeholder="ค้นหาสินค้า" />
          </label>
        </div>
        <div class="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
          <button type="button" class="chip" :class="!cat ? 'chip-on' : 'chip-off'" @click="cat = ''">ทั้งหมด</button>
          <button v-for="c in categories" :key="c" type="button" class="chip whitespace-nowrap" :class="cat === c ? 'chip-on' : 'chip-off'" @click="cat = c">{{ c }}</button>
        </div>
        <div class="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          <button
            v-for="x in shown"
            :key="x.kind + x.id"
            type="button"
            class="relative flex min-h-24 flex-col justify-between rounded-2xl border bg-white p-3 text-left transition active:scale-[0.98] disabled:opacity-50"
            :class="inCart(x) ? 'border-brand-500 ring-1 ring-brand-500' : 'border-stone-200 hover:border-brand-300'"
            :disabled="!canAdd(x)"
            @click="add(x)"
          >
            <span class="line-clamp-2 text-sm font-medium break-words text-stone-900">{{ x.name }}</span>
            <span v-if="groupsOf(x).length" class="mt-0.5 text-[11px] text-brand-700">มีตัวเลือก</span>
            <span class="mt-2 flex items-end justify-between gap-1">
              <span class="text-base font-semibold text-stone-900">{{ money(x.price) }}</span>
              <span v-if="x.stock != null" class="text-[11px]" :class="x.stock - inCart(x) <= 0 ? 'font-semibold text-rose-600' : 'text-stone-400'">{{ x.stock - inCart(x) <= 0 ? 'หมด' : `เหลือ ${x.stock - inCart(x)}` }}</span>
            </span>
            <span v-if="inCart(x)" class="absolute -top-2 -right-2 flex h-6 min-w-6 items-center justify-center rounded-full bg-brand-600 px-1 text-xs font-semibold text-white">{{ inCart(x) }}</span>
          </button>
        </div>
        <p v-if="!shown.length" class="card py-8 text-center text-sm text-stone-500">ไม่พบสินค้า</p>
      </section>

      <!-- ตะกร้า (คอม = แผงขวา · มือถือ = bottom sheet) -->
      <div v-if="cartOpen" class="fixed inset-0 z-40 bg-stone-900/40 lg:hidden" @click="cartOpen = false" />
      <aside
        class="z-50 flex-col rounded-t-3xl border border-stone-200 bg-white lg:sticky lg:top-20 lg:flex lg:max-h-[calc(100dvh-7rem)] lg:rounded-2xl"
        :class="cartOpen ? 'fixed inset-x-0 bottom-0 flex max-h-[88dvh] pb-[env(safe-area-inset-bottom)]' : 'hidden'"
      >
        <div class="flex items-center justify-between border-b border-stone-100 px-4 py-3">
          <span class="font-semibold text-stone-900">ตะกร้า <span class="text-stone-400">{{ count }}</span></span>
          <button type="button" class="text-sm text-stone-500 lg:hidden" @click="cartOpen = false">ปิด</button>
        </div>
        <div class="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          <p v-if="!cart.length" class="py-6 text-center text-sm text-stone-400">แตะสินค้าเพื่อเพิ่ม</p>
          <ul class="space-y-2">
            <li v-for="l in cart" :key="lineKey(l)" class="flex items-center gap-2">
              <button type="button" class="min-w-0 flex-1 text-left" :disabled="!groupsOf(itemOf(l) || {}).length" @click="openMods(itemOf(l), l)">
                <span class="block truncate text-sm font-medium text-stone-900">{{ itemOf(l)?.name }}</span>
                <span v-if="l.mods?.length" class="block truncate text-xs text-brand-700">{{ modsText(modsOf(l.mods)) }}</span>
                <span class="block text-xs text-stone-500">{{ money(linePrice(l)) }}</span>
              </button>
              <span class="flex h-9 items-center rounded-xl border border-stone-200">
                <button type="button" class="h-full w-9 text-stone-600" aria-label="ลด" @click="step(l, -1)"><AppIcon name="minus" :size="16" class="mx-auto" /></button>
                <span class="w-7 text-center text-sm font-semibold">{{ l.qty }}</span>
                <button type="button" class="h-full w-9 text-stone-600" aria-label="เพิ่ม" @click="step(l, 1)"><AppIcon name="plus" :size="16" class="mx-auto" /></button>
              </span>
            </li>
          </ul>

          <!-- สมาชิก -->
          <div class="border-t border-stone-100 pt-3">
            <div class="label">สมาชิก (ไม่บังคับ)</div>
            <div v-if="member" class="rounded-xl bg-brand-50 p-2.5">
              <div class="flex items-center justify-between gap-2">
                <span class="min-w-0">
                  <span class="block truncate text-sm font-semibold text-brand-900">{{ member.name }}</span>
                  <span class="block text-xs text-brand-800">{{ member.phone ? formatPhone(member.phone) : '' }} · {{ customerPoints(member) }} คะแนน</span>
                </span>
                <button type="button" class="text-xs text-stone-500 underline" @click="member = null">เอาออก</button>
              </div>
              <div v-if="customerPoints(member) > 0" class="mt-2">
                <label class="text-xs text-stone-600">ใช้คะแนน (1 คะแนน = {{ money(db.loyalty.pointValue) }})</label>
                <input v-model="usePoints" type="text" v-num class="input mt-1 h-10 bg-white" :placeholder="`สูงสุด ${maxPoints}`" />
                <p v-if="pointsError" class="mt-1 text-xs text-rose-600">{{ pointsError }}</p>
              </div>
              <div v-if="coupons.length" class="mt-2 flex flex-wrap gap-1.5">
                <button v-for="c in coupons" :key="c.id" type="button" class="chip" :class="couponIds.includes(c.id) ? 'chip-on' : 'chip-off'" @click="toggleCoupon(c.id)">{{ c.name }} −{{ money(c.amount) }}</button>
              </div>
            </div>
            <template v-else>
              <input v-model="memberQ" type="search" class="input h-10" placeholder="ค้นหาเบอร์ / ชื่อ" />
              <div v-if="memberMatches.length" class="mt-1.5 space-y-1">
                <button v-for="c in memberMatches" :key="c.id" type="button" class="flex w-full justify-between gap-2 rounded-lg border border-stone-200 px-3 py-2 text-left text-sm hover:border-brand-300" @click="pickMember(c)">
                  <span class="truncate">{{ c.name }}</span><span class="shrink-0 text-stone-500">{{ c.phone ? formatPhone(c.phone) : '' }}</span>
                </button>
              </div>
            </template>
          </div>

          <div v-if="can('adjustPrice')">
            <label class="label">ส่วนลดบิล (บาท)</label>
            <input v-model="discount" type="text" v-num.dec class="input h-10" placeholder="0" />
          </div>
        </div>
        <div class="border-t border-stone-100 p-4">
          <div class="mb-3 flex items-start justify-between gap-2">
            <span class="text-sm text-stone-500">ยอดชำระ</span>
            <DiscountDetail :full="preview.full" :final="total" :lines="preview.discountLines" size="lg" />
          </div>
          <button type="button" class="btn-primary h-12 w-full text-base" :disabled="!cart.length || !!pointsError" @click="openPay">ชำระเงิน</button>
        </div>
      </aside>

      <!-- แถบล่างมือถือ -->
      <div v-if="!cartOpen" class="fixed inset-x-0 bottom-0 z-30 border-t border-stone-200 bg-white/95 p-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] backdrop-blur lg:hidden">
        <button type="button" class="btn-primary h-12 w-full justify-between px-5 text-base" @click="cartOpen = true">
          <span>ตะกร้า {{ count }} ชิ้น</span><span>{{ money(total) }}</span>
        </button>
      </div>
    </div>

    <!-- บิลของกะ -->
    <section v-else-if="tab === 'bills'" class="card">
      <p v-if="!bills.length" class="py-8 text-center text-sm text-stone-500">ยังไม่มีบิลในกะนี้</p>
      <ul class="divide-y divide-stone-100">
        <li v-for="o in bills" :key="o.id" class="flex items-center gap-3 py-3" :class="o.status === 'cancelled' ? 'opacity-60' : ''">
          <button type="button" class="min-w-0 flex-1 text-left" @click="receipt = o">
            <span class="block font-medium text-stone-900">{{ o.code }} <span class="text-xs font-normal text-stone-500">{{ timeOnly(o.createdAt) }}</span></span>
            <span class="block truncate text-xs text-stone-500">{{ o.items.map((i) => `${i.name}${i.mods?.length ? ` (${modsText(i.mods)})` : ''} ×${i.qty}`).join(', ') }}<template v-if="o.customerId"> · {{ findCustomer(o.customerId)?.name }}</template></span>
          </button>
          <span class="shrink-0 text-right text-sm">
            <b class="block text-stone-900">{{ money(orderTotals(o).total) }}</b>
            <span class="text-xs text-stone-500">{{ o.status === 'cancelled' ? 'ยกเลิกแล้ว' : o.payments[0]?.method }}</span>
          </span>
          <button v-if="can('posVoid') && o.status !== 'cancelled'" type="button" class="btn-danger h-9 shrink-0 px-2.5" aria-label="ยกเลิกบิล" @click="doVoid(o)"><AppIcon name="x" :size="16" /></button>
        </li>
      </ul>
    </section>

    <!-- ปิดกะ -->
    <section v-else-if="tab === 'shift' && summary" class="card mx-auto max-w-md">
      <div class="card-title">สรุปกะ</div>
      <dl class="space-y-1.5 text-sm">
        <div class="flex justify-between"><dt class="text-stone-500">เปิดกะ</dt><dd>{{ dateTime(shift.openedAt) }}</dd></div>
        <div class="flex justify-between"><dt class="text-stone-500">บิล</dt><dd>{{ summary.bills }}<template v-if="summary.cancelled"> (ยกเลิก {{ summary.cancelled }})</template></dd></div>
        <div v-for="(label, k) in POS_METHODS" :key="k" class="flex justify-between"><dt class="text-stone-500">{{ label }}</dt><dd>{{ money(summary.byMethod[k] || 0) }}</dd></div>
        <div class="flex justify-between border-t border-stone-100 pt-1.5 font-semibold"><dt>ยอดขายรวม</dt><dd>{{ money(summary.total) }}</dd></div>
        <div class="flex justify-between"><dt class="text-stone-500">เงินทอนตั้งต้น</dt><dd>{{ money(shift.float) }}</dd></div>
        <div class="flex justify-between font-semibold"><dt>เงินสดที่ควรมีในลิ้นชัก</dt><dd>{{ money(summary.expectedCash) }}</dd></div>
      </dl>
      <label class="label mt-4">เงินสดที่นับได้ (บาท)</label>
      <input v-model="counted" type="text" v-num.dec class="input text-lg font-semibold" placeholder="0" />
      <p v-if="counted !== ''" class="mt-1 text-sm" :class="Number(counted) - summary.expectedCash === 0 ? 'text-emerald-700' : 'text-amber-700'">ส่วนต่าง {{ money(Number(counted) - summary.expectedCash) }}</p>
      <button type="button" class="btn-primary mt-3 w-full" :disabled="counted === ''" @click="doClose">ปิดกะ</button>
    </section>

    <!-- ตัวเลือกสินค้า -->
    <AppModal v-if="modFor" :title="modFor.x.name" @close="modFor = null">
      <div class="space-y-4">
        <div v-for="g in groupsOf(modFor.x)" :key="g.id">
          <div class="label">{{ g.name }} <span v-if="g.required" class="text-rose-500">*</span><span v-else-if="g.type === 'multi'" class="font-normal text-stone-400">(เลือกได้หลายอย่าง)</span></div>
          <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <button
              v-for="o in g.options"
              :key="o.id"
              type="button"
              class="flex min-h-12 flex-col items-center justify-center rounded-xl border px-2 py-1.5 text-sm font-medium"
              :class="isPicked(g, o) ? 'border-brand-500 bg-brand-50 text-brand-800 ring-1 ring-brand-500' : 'border-stone-200 text-stone-700'"
              @click="pickMod(g, o)"
            >
              {{ o.name }}<span v-if="o.price" class="text-xs font-normal text-stone-500">+{{ money(o.price) }}</span>
            </button>
          </div>
        </div>
        <div class="flex items-center justify-between">
          <span class="label mb-0">จำนวน</span>
          <span class="flex h-11 items-center rounded-xl border border-stone-200">
            <button type="button" class="h-full w-11" aria-label="ลด" @click="modFor.qty = Math.max(1, modFor.qty - 1)"><AppIcon name="minus" :size="18" class="mx-auto" /></button>
            <span class="w-10 text-center text-lg font-semibold">{{ modFor.qty }}</span>
            <button type="button" class="h-full w-11" aria-label="เพิ่ม" :disabled="modFor.qty >= modQtyMax" @click="modFor.qty++"><AppIcon name="plus" :size="18" class="mx-auto" /></button>
          </span>
        </div>
        <p v-if="modMissing.length" class="text-sm text-rose-600">เลือก {{ modMissing.join(', ') }}</p>
      </div>
      <template #footer>
        <button class="btn-outline flex-1 sm:flex-none" @click="modFor = null">ยกเลิก</button>
        <button class="btn-primary flex-[1.6] sm:flex-none" :disabled="!!modMissing.length" @click="saveMods">{{ modFor.line ? 'บันทึก' : 'ใส่ตะกร้า' }} · {{ money(modPrice) }}</button>
      </template>
    </AppModal>

    <!-- ชำระเงิน -->
    <AppModal v-if="payOpen" title="ชำระเงิน" @close="payOpen = false">
      <div class="space-y-4">
        <div class="rounded-2xl bg-brand-50 p-4 text-center">
          <div class="text-sm text-brand-800">ยอดชำระ</div>
          <div class="text-3xl font-semibold text-brand-900">{{ money(total) }}</div>
        </div>
        <div class="grid grid-cols-3 gap-2">
          <button v-for="(label, k) in POS_METHODS" :key="k" type="button" class="h-12 rounded-xl border text-sm font-semibold" :class="pay.method === k ? 'border-brand-500 bg-brand-50 text-brand-800 ring-1 ring-brand-500' : 'border-stone-200 text-stone-600'" @click="pay.method = k">{{ label }}</button>
        </div>
        <template v-if="pay.method === 'cash'">
          <div>
            <label class="label">รับเงินมา (บาท)</label>
            <input v-model="pay.received" type="text" v-num.dec class="input h-12 text-xl font-semibold" placeholder="0" />
          </div>
          <div class="flex flex-wrap gap-2">
            <button v-for="v in quick" :key="v" type="button" class="chip chip-off" @click="pay.received = String(v)">{{ v === total ? 'พอดี' : money(v) }}</button>
          </div>
          <div class="flex items-center justify-between rounded-xl p-3" :class="change >= 0 ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-700'">
            <span class="text-sm">{{ change >= 0 ? 'เงินทอน' : 'ยังขาด' }}</span>
            <span class="text-2xl font-semibold">{{ money(Math.abs(change)) }}</span>
          </div>
        </template>
      </div>
      <template #footer>
        <button class="btn-outline flex-1 sm:flex-none" @click="payOpen = false">ยกเลิก</button>
        <button class="btn-primary flex-1 sm:flex-none" :disabled="!canConfirm" @click="confirmPay"><AppIcon name="check" :size="18" /> ยืนยันรับเงิน</button>
      </template>
    </AppModal>

    <!-- ใบเสร็จ -->
    <AppModal v-if="receipt" :title="`ใบเสร็จ ${receipt.code}`" @close="receipt = null">
      <Receipt :order="receipt" />
      <template #footer>
        <button class="btn-outline flex-1 sm:flex-none" @click="print"><AppIcon name="printer" :size="18" /> พิมพ์</button>
        <button class="btn-primary flex-1 sm:flex-none" @click="receipt = null">ขายต่อ</button>
      </template>
    </AppModal>
  </div>
</template>
