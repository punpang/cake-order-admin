<script setup>
import ThaiDateField from '../components/ThaiDateField.vue'
import { orderNo } from '../lib/format'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { db, can, orderVisible, findCustomer, upcomingBirthdays } from '../data/store'
import { STATUS } from '../lib/constants'
import { orderTotals, describeSelections } from '../lib/pricing'
import { money, timeOnly, dayLabel, formatPhone, toDateStr } from '../lib/format'
import StatusBadge from '../components/StatusBadge.vue'
import PayDueBadge from '../components/PayDueBadge.vue'
import { customerPending } from '../lib/payDue'
import AppIcon from '../components/AppIcon.vue'
import AppModal from '../components/AppModal.vue'
import BirthdayList from '../components/BirthdayList.vue'
import { getSupabase } from '../lib/supabase'
import { loadOrdersInRange, searchOrdersRemote, countOrders } from '../lib/ordersSync'
import { fetchPendingPosHoldIds, loadPendingPosOrders } from '../lib/posHold'
import { quietly } from '../lib/loading'

const status = ref('')
// PC (≥1024): สลับมุมมอง การ์ด ↔ แถวหนาแน่น · จำค่าที่เลือกไว้ในเบราว์เซอร์
const wide = ref(false)
let mq = null
const onMq = () => { wide.value = !!mq?.matches }
const readView = () => { try { return localStorage.getItem('orderListView') } catch { return null } }
const view = ref(readView() === 'rows' ? 'rows' : 'cards')
const dense = computed(() => wide.value && view.value === 'rows')
function setView(v) { view.value = v; try { localStorage.setItem('orderListView', v) } catch { /* ignore */ } }
onMounted(() => { mq = window.matchMedia('(min-width: 1024px)'); onMq(); mq.addEventListener('change', onMq) })
onBeforeUnmount(() => mq?.removeEventListener('change', onMq))
// ค่าเริ่มต้น = ออร์เดอร์ที่นัดรับ/ส่งวันนี้ (ลบป้ายตัวกรองเพื่อดูทั้งหมด)
const todayStr = toDateStr(new Date())
const from = ref(todayStr)
const to = ref(todayStr)
const isToday = computed(() => from.value === todayStr && to.value === todayStr)
const q = ref('')
const fulfill = ref('') // '' | pickup | delivery
const payState = ref('') // '' | due | paid | over
const PAY_FILTERS = [{ v: 'due', l: 'ค้างชำระ' }, { v: 'paid', l: 'ชำระครบ' }, { v: 'over', l: 'ชำระเกิน' }]
function setFrom(v) {
  from.value = v
  if (v && to.value && to.value < v) to.value = v
}
const hasDate = computed(() => from.value || to.value)
// ค่าเริ่มต้น "วันนี้" ไม่ควรบังผลค้นหา: เมื่อพิมพ์ค้นหา ค้นทุกวัน (ถ้าผู้ใช้เลือกช่วงวันเอง ยังใช้ช่วงนั้น)
const searching = computed(() => !!q.value.trim())
const dateActive = computed(() => !(isToday.value && searching.value))

// ข้อความที่ค้นหาได้: เลขออร์เดอร์, ชื่อ, เบอร์, ชื่อเค้ก, ตัวเลือก/ข้อความบนเค้ก, เจ้าของวันเกิด
function searchText(o) {
  const c = findCustomer(o.customerId)
  const parts = [o.code, c?.name, c?.phone, c?.phone && formatPhone(c.phone), o.birthday?.name]
  for (const i of o.items) {
    parts.push(i.name, i.note)
    for (const d of describeSelections(i, db.optionGroups)) parts.push(d.value)
  }
  return parts.filter(Boolean).join(' ').toLowerCase()
}
function payMatch(o) {
  if (!payState.value) return true
  if (o.status === 'cancelled') return false
  const b = orderTotals(o).balance
  return payState.value === 'due' ? b > 0 : payState.value === 'paid' ? b === 0 : b < 0
}

// เตือนวันเกิด (แอดมิน + ขาย)
const birthdays = computed(() => (can('birthdays') ? upcomingBirthdays().filter((b) => !b.greeted) : []))
const bdOpen = ref(false)

// บิลหน้าร้าน (POS) ซ่อนไว้ก่อน กดชิปเพื่อแสดง
const showPos = ref(false)
// คิวบิลหน้าร้านที่ผลตรวจพบรายการเสี่ยงและยังไม่มีผู้จัดการตรวจ (ผู้จัดการเท่านั้น · ไม่กันการขาย)
const posHoldIds = ref([])
const posHoldSet = computed(() => new Set(posHoldIds.value))
const posReview = ref(false)
async function refreshPosHolds() {
  if (!can('manage')) return
  const client = await getSupabase()
  if (!client) return
  const r = await fetchPendingPosHoldIds(client)
  if (!r.error) posHoldIds.value = r.ids
}
// ตัวเลขจากฐานข้อมูลตามตัวกรองปัจจุบัน (null = นับจากรายการที่โหลด เช่น ตอนค้นหา/โหมดสาธิต)
const serverCounts = ref(null)
const posTotal = computed(() => (serverCounts.value ? serverCounts.value.pos : db.orders.filter((o) => o.channel === 'pos').length))
const totalCount = computed(() => (serverCounts.value ? serverCounts.value.all : visible.value.length))
// แหล่งข้อมูลรายการ = ผลจากฐานข้อมูลตามตัวกรองเท่านั้น · ใช้ข้อมูลในเครื่องทับเฉพาะออร์เดอร์ที่เพิ่งแก้
// โหมดสาธิต (ไม่มี Supabase) หรือโหลดไม่สำเร็จ = ใช้ข้อมูลในเครื่องเดิม
const serverRows = ref(null)
const searchedServer = ref(false) // ผลนี้มาจากการค้นที่เซิร์ฟเวอร์ (ทุกวัน) → ไม่กรองคำค้นซ้ำในเครื่อง
const dbById = computed(() => new Map(db.orders.map((o) => [o.id, o])))
const source = computed(() => {
  if (serverRows.value === null) return db.orders
  return serverRows.value.map((o) => dbById.value.get(o.id) || o)
})
const visible = computed(() => {
  return source.value.filter((o) => (posReview.value ? posHoldSet.value.has(o.id) : (showPos.value || o.channel !== 'pos')) && orderVisible(o))
})

// ดึงจากฐานข้อมูลเฉพาะตามตัวกรอง (ไม่ดึงทั้งหมดแล้วกรองเอง) · ค้นข้อความ → RPC ทุกวัน
let fetchTimer = null
let reqSeq = 0
// กำลังดึงรายการ: แสดงข้อความเล็กข้างจำนวนแทนหน้าจอโหลดทับทั้งจอ (ไม่บล็อกการแตะ/เลื่อน)
const loadingRows = ref(false)
async function fetchRows() {
  const next = reqSeq + 1
  loadingRows.value = true
  try { await runFetch() } finally { if (reqSeq === next) loadingRows.value = false }
}
async function runFetch() {
  const seq = ++reqSeq
  const client = await getSupabase()
  if (!client) { serverRows.value = null; searchedServer.value = false; return }
  if (posReview.value) { // คิวรอตรวจ: โหลดเฉพาะบิลในคิว (ตัวกรองวันและสถานะยังใช้กับรายการที่โหลดแล้ว)
    const pending = await fetchPendingPosHoldIds(client)
    if (seq !== reqSeq) return
    if (pending.error) { serverRows.value = null; searchedServer.value = false; serverCounts.value = null; return }
    posHoldIds.value = pending.ids
    const items = await loadPendingPosOrders(client, pending.ids)
    if (seq !== reqSeq) return
    serverRows.value = items.error ? null : items.items
    searchedServer.value = false
    serverCounts.value = null
    return
  }
  const term = q.value.trim()
  const scope = { from: from.value, to: to.value, openOnly: !from.value && !to.value, fulfillment: fulfill.value, includePos: showPos.value, payState: payState.value }
  const [r, cnt] = term
    ? [await searchOrdersRemote(client, term), null]
    : await Promise.all([loadOrdersInRange(client, { ...scope, status: status.value }), countOrders(client, scope)])
  if (seq !== reqSeq) return // มีการเปลี่ยนตัวกรองใหม่ระหว่างรอ
  if (r.error) { serverRows.value = null; searchedServer.value = false; serverCounts.value = null; return }
  serverRows.value = r.items
  searchedServer.value = !!term
  serverCounts.value = cnt && !cnt.error ? cnt : null
}
const scheduleFetch = (ms) => { clearTimeout(fetchTimer); fetchTimer = setTimeout(() => quietly(fetchRows), ms) }
watch([from, to, status, fulfill, showPos, payState, posReview], () => scheduleFetch(200))
watch(q, () => scheduleFetch(350))
// ข้อมูลในเครื่องเปลี่ยน (แก้/สร้าง/ซิงก์) → โหลดตัวเลขและรายการใหม่
watch(() => db.orders.map((o) => `${o.id}|${o.status}|${o.pickupAt}|${o.fulfillment}|${o.channel}|${orderTotals(o).balance}`).join(';'), () => scheduleFetch(800))
onMounted(() => { quietly(fetchRows); quietly(refreshPosHolds) })
onBeforeUnmount(() => clearTimeout(fetchTimer))

const counts = computed(() => {
  if (serverCounts.value) return serverCounts.value.byStatus
  const c = {}
  for (const o of visible.value) c[o.status] = (c[o.status] || 0) + 1
  return c
})

const list = computed(() => {
  const s = q.value.trim().toLowerCase()
  return visible.value
    .filter((o) => !status.value || o.status === status.value)
    .filter((o) => !dateActive.value || !from.value || o.pickupAt.slice(0, 10) >= from.value)
    .filter((o) => !dateActive.value || !to.value || o.pickupAt.slice(0, 10) <= to.value)
    .filter((o) => !fulfill.value || o.fulfillment === fulfill.value)
    .filter(payMatch)
    .filter((o) => !s || searchedServer.value || searchText(o).includes(s))
    .slice()
    .sort((a, b) => a.pickupAt.localeCompare(b.pickupAt))
})

// จัดกลุ่มตามวันนัดรับ
const groups = computed(() => {
  const map = new Map()
  for (const o of list.value) {
    const d = o.pickupAt.slice(0, 10)
    if (!map.has(d)) map.set(d, [])
    map.get(d).push(o)
  }
  return [...map.entries()].map(([day, orders]) => ({ day, orders }))
})

const rows = computed(() =>
  groups.value.map((g) => ({
    ...g,
    orders: g.orders.map((o) => ({ o, c: findCustomer(o.customerId), t: orderTotals(o) })),
  })),
)

const paidPct = (t) => (t.total > 0 ? Math.min(100, Math.round((t.paid / t.total) * 100)) : 0)

// ตัวกรองพับเก็บได้ แสดงจำนวนตัวกรองที่ใช้อยู่ + ป้ายสรุป
const filtersOpen = ref(false)
const shortDate = (d) => `${Number(d.slice(8, 10))}/${Number(d.slice(5, 7))}`
const activeFilters = computed(() => {
  const out = []
  if (hasDate.value) out.push({ k: 'date', l: isToday.value ? 'นัดรับ วันนี้' : `นัดรับ ${from.value ? shortDate(from.value) : '…'}–${to.value ? shortDate(to.value) : '…'}` })
  if (fulfill.value) out.push({ k: 'fulfill', l: fulfill.value === 'delivery' ? 'จัดส่ง' : 'รับที่ร้าน' })
  if (payState.value) out.push({ k: 'pay', l: PAY_FILTERS.find((f) => f.v === payState.value).l })
  return out
})
const chipFilters = computed(() => activeFilters.value.filter((f) => !(f.k === 'date' && isToday.value))) // วันนี้แสดงในแถบใหญ่แทน
function clearFilter(k) {
  if (k === 'date') from.value = to.value = ''
  if (k === 'fulfill') fulfill.value = ''
  if (k === 'pay') payState.value = ''
}
function clearAll() {
  for (const f of activeFilters.value) clearFilter(f.k)
}
</script>

<template>
  <div>
    <!-- หัวข้อ -->
    <div class="head-safe mb-4 flex items-end justify-between gap-3">
      <div class="min-w-0">
        <h1 class="page-title">ออร์เดอร์</h1>
        <p class="text-sm text-stone-500">แสดง {{ list.length }} จาก {{ totalCount }} รายการ<span v-if="loadingRows" class="ml-2 inline-flex items-center gap-1.5 align-middle text-stone-400">กำลังโหลด…</span></p>
      </div>
      <div class="ml-auto hidden items-center gap-1 rounded-xl bg-white p-1 ring-1 ring-stone-200 lg:flex" role="group" aria-label="มุมมองรายการ">
        <button type="button" class="rounded-lg px-3 py-1.5 text-sm font-medium" :class="view === 'cards' ? 'bg-brand-600 text-white' : 'text-stone-600 hover:bg-stone-50'" :aria-pressed="view === 'cards'" @click="setView('cards')">การ์ด</button>
        <button type="button" class="rounded-lg px-3 py-1.5 text-sm font-medium" :class="view === 'rows' ? 'bg-brand-600 text-white' : 'text-stone-600 hover:bg-stone-50'" :aria-pressed="view === 'rows'" data-view-rows @click="setView('rows')">แถว</button>
      </div>
      <RouterLink v-if="can('createOrder')" to="/admin/orders/new" class="btn-primary hidden md:inline-flex">
        <AppIcon name="plus" /> สร้างออร์เดอร์
      </RouterLink>
    </div>

    <!-- ค้นหา + ปุ่มตัวกรอง -->
    <div class="mb-3 flex gap-2">
      <label class="relative block min-w-0 flex-1">
        <span class="sr-only">ค้นหาออร์เดอร์</span>
        <AppIcon name="search" class="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-stone-400" />
        <input v-model="q" type="search" class="input bg-white pl-10" placeholder="ค้นหา ชื่อ เบอร์ หรือเค้ก" />
      </label>
      <button
        type="button"
        class="relative inline-flex h-11 shrink-0 items-center gap-1.5 rounded-xl border px-3.5 text-sm font-medium transition"
        :class="filtersOpen || activeFilters.length ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-stone-200 bg-white text-stone-700 hover:bg-stone-50'"
        :aria-expanded="filtersOpen"
        aria-controls="order-filters"
        @click="filtersOpen = !filtersOpen"
      >
        <AppIcon name="filter" />
        <span class="hidden sm:inline">ตัวกรอง</span>
        <span v-if="activeFilters.length" class="flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-600 px-1 text-xs font-semibold text-white">{{ activeFilters.length }}</span>
        <span v-if="!activeFilters.length" class="sr-only sm:hidden">ตัวกรอง</span>
      </button>
    </div>

    <!-- แผงตัวกรอง -->
    <div v-if="filtersOpen" id="order-filters" class="card mb-3 space-y-4">
      <div>
        <div class="label">วันนัดรับ</div>
        <div class="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
          <ThaiDateField :model-value="from" label="ตั้งแต่วันที่" :past="3" @update:model-value="setFrom" />
          <span class="shrink-0 text-stone-400 max-sm:hidden">–</span>
          <ThaiDateField v-model="to" :min="from" :past="3" label="ถึงวันที่" />
        </div>
      </div>
      <div>
        <div class="label">การส่งมอบ</div>
        <div class="grid grid-cols-3 gap-1 seg-grid">
          <button
            v-for="f in [{ v: '', l: 'ทั้งหมด' }, { v: 'pickup', l: 'รับที่ร้าน' }, { v: 'delivery', l: 'จัดส่ง' }]"
            :key="f.v"
            type="button"
            class="h-9 rounded-lg text-sm font-medium transition"
            :class="fulfill === f.v ? 'bg-white text-brand-800 shadow-sm' : 'text-stone-600'"
            :aria-pressed="fulfill === f.v"
            @click="fulfill = f.v"
          >{{ f.l }}</button>
        </div>
      </div>
      <div>
        <div class="label">การชำระ</div>
        <div class="grid grid-cols-4 gap-1 seg-grid">
          <button
            v-for="f in [{ v: '', l: 'ทั้งหมด' }, ...PAY_FILTERS]"
            :key="f.v"
            type="button"
            class="h-9 rounded-lg text-sm font-medium transition"
            :class="payState === f.v ? 'bg-white text-brand-800 shadow-sm' : 'text-stone-600'"
            :aria-pressed="payState === f.v"
            @click="payState = f.v"
          >{{ f.l }}</button>
        </div>
      </div>
      <div class="flex justify-between gap-2 border-t border-stone-100 pt-3">
        <button type="button" class="btn-outline" :disabled="!activeFilters.length" @click="clearAll">ล้างทั้งหมด</button>
        <button type="button" class="btn-primary" @click="filtersOpen = false">ดู {{ list.length }} รายการ</button>
      </div>
    </div>

    <!-- ค่าเริ่มต้น "นัดรับวันนี้": แถบบอกสถานะใหญ่ + ปุ่มดูทั้งหมด -->
    <div v-if="isToday && searching && !filtersOpen" data-search-all class="mb-3 rounded-2xl bg-brand-50 px-3.5 py-2 text-sm text-brand-900"><b>ค้นหาในออร์เดอร์ทุกวัน</b> <span class="whitespace-nowrap">({{ list.length }} รายการ)</span></div>
    <div v-else-if="isToday && !filtersOpen" data-today-banner class="mb-3 flex items-center gap-3 rounded-2xl bg-brand-50 px-3.5 py-2">
      <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-brand-600"><AppIcon name="calendar" :size="18" /></span>
      <span class="min-w-0 flex-1 text-sm text-brand-900"><b>แสดงเฉพาะนัดรับวันนี้</b> <span class="whitespace-nowrap">({{ list.length }} จาก {{ totalCount }})</span></span>
      <button type="button" class="btn-outline h-11 shrink-0 px-4" aria-label="ดูทั้งหมด (ลบตัวกรอง นัดรับ วันนี้)" @click="clearFilter('date')">ดูทั้งหมด</button>
    </div>

    <!-- ป้ายตัวกรองที่ใช้อยู่ -->
    <div v-if="chipFilters.length && !filtersOpen" class="mb-3 flex flex-wrap gap-2">
      <button
        v-for="f in chipFilters"
        :key="f.k"
        type="button"
        class="inline-flex h-8 items-center gap-1 rounded-full bg-brand-50 pr-2 pl-3 text-sm font-medium text-brand-800 hover:bg-brand-100"
        :aria-label="`ลบตัวกรอง ${f.l}`"
        @click="clearFilter(f.k)"
      >{{ f.l }} <AppIcon name="x" :size="14" /></button>
    </div>

    <!-- สถานะ -->
    <div class="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:flex-wrap md:overflow-visible md:px-0 md:pb-0" role="group" aria-label="กรองตามสถานะ">
      <button v-if="posTotal && can('pos')" class="chip" :class="showPos ? 'chip-on' : 'chip-off'" :aria-pressed="showPos" @click="showPos = !showPos">
        บิลหน้าร้าน <span class="font-normal">{{ posTotal }}</span>
      </button>
      <button v-if="can('manage') && (posHoldIds.length || posReview)" class="chip" :class="posReview ? 'chip-on' : 'chip-off'" :aria-pressed="posReview" data-pos-review @click="posReview = !posReview">
        รอตรวจบิลหน้าร้าน <span class="font-normal">{{ posHoldIds.length }}</span>
      </button>
      <button class="chip" :class="!status ? 'chip-on' : 'chip-off'" :aria-pressed="!status" @click="status = ''">
        ทั้งหมด <span class="font-normal">{{ totalCount }}</span>
      </button>
      <template v-for="(s, key) in STATUS" :key="key">
        <button v-if="counts[key]" class="chip" :class="status === key ? 'chip-on' : 'chip-off'" :aria-pressed="status === key" @click="status = key">
          <span v-if="status !== key" class="h-2 w-2 rounded-full" :class="s.dot" />
          {{ s.label }} <span class="font-normal">{{ counts[key] }}</span>
        </button>
      </template>
    </div>

    <!-- เตือนวันเกิด -->
    <button
      v-if="birthdays.length"
      class="mb-4 flex w-full items-center gap-3 rounded-2xl border border-rose-100 bg-rose-50/60 px-3.5 py-3 text-left transition hover:bg-rose-50 active:scale-[0.99]"
      @click="bdOpen = true"
    >
      <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-rose-700"><AppIcon name="cake" :size="18" /></span>
      <span class="min-w-0 flex-1">
        <span class="block text-sm font-semibold text-rose-900">วันเกิดใกล้ถึง {{ birthdays.length }} คน</span>
        <span class="block truncate text-xs text-rose-700">{{ birthdays.map((b) => b.name || findCustomer(b.customerId)?.name).join(', ') }}</span>
      </span>
      <AppIcon name="next" class="text-rose-300" />
    </button>

    <!-- ว่าง -->
    <div v-if="!list.length" class="empty py-12">
      <span class="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-600"><AppIcon name="cake" :size="28" /></span>
      <div class="font-semibold text-stone-800">{{ isToday && !q.trim() && !status ? 'ไม่มีออร์เดอร์นัดรับวันนี้' : 'ไม่พบออร์เดอร์' }}</div>
      <div class="text-sm text-stone-500">ลองเปลี่ยนคำค้นหาหรือตัวกรอง</div>
      <button v-if="activeFilters.length || status || q" type="button" class="btn-soft" @click="clearAll(); status = ''; q = ''">ล้างตัวกรองทั้งหมด</button>
    </div>

    <!-- รายการตามวัน -->
    <section v-for="g in rows" :key="g.day" class="mb-6">
      <h2 class="sticky top-14 z-10 -mx-4 mb-2 flex items-baseline gap-2 bg-cream px-5 py-2">
        <span class="text-base font-semibold text-stone-900">{{ dayLabel(g.day) }}</span>
        <span class="ml-auto text-xs font-medium text-stone-500">{{ g.orders.length }} ออร์เดอร์</span>
      </h2>

      <div v-if="dense" class="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-stone-200" data-order-rows>
        <RouterLink
          v-for="{ o, c, t } in g.orders"
          :key="o.id"
          :to="`/admin/orders/${o.id}`"
          class="grid grid-cols-[3.5rem_minmax(8rem,1.2fr)_minmax(8rem,1.6fr)_auto_7rem_9rem] items-center gap-4 border-b border-stone-100 px-4 py-2.5 text-sm last:border-b-0 hover:bg-brand-50/50 focus-visible:bg-brand-50 focus-visible:outline-none"
          :class="o.status === 'cancelled' ? 'grayscale' : ''"
          data-order-row
        >
          <span class="font-semibold text-brand-800 tabular-nums">{{ timeOnly(o.pickupAt) }} น.</span>
          <span class="min-w-0"><b class="block truncate font-semibold text-stone-900">{{ c?.name }}</b><span class="block text-xs text-stone-400">{{ orderNo(o.code) }}</span></span>
          <span class="flex min-w-0 items-center gap-1.5 text-stone-500">
            <AppIcon :name="o.fulfillment === 'delivery' ? 'truck' : 'store'" :size="14" class="shrink-0" />
            <span class="shrink-0">{{ o.fulfillment === 'delivery' ? 'จัดส่ง' : 'รับที่ร้าน' }}</span><span aria-hidden="true">·</span>
            <span class="truncate">{{ o.items[0]?.name }}<template v-if="o.items.length > 1"> +{{ o.items.length - 1 }}</template></span>
          </span>
          <span class="flex shrink-0 flex-wrap items-center justify-end gap-1"><StatusBadge :status="o.status" /><PayDueBadge :order="o" short /><span v-if="customerPending(o).length" class="rounded-full bg-sky-50 px-2 py-0.5 text-xs font-semibold whitespace-nowrap text-sky-700">รอตรวจสลิป</span></span>
          <span class="text-right font-semibold text-stone-900 tabular-nums">{{ money(t.total) }}</span>
          <span class="text-right text-xs font-medium">
            <template v-if="o.status === 'cancelled'"><span class="text-stone-500">ยกเลิกแล้ว</span></template>
            <template v-else>
              <span v-if="t.balance > 0" class="text-amber-700">ค้าง {{ money(t.balance) }}</span>
              <span v-else-if="t.balance < 0" class="text-rose-700">ชำระเกิน {{ money(-t.balance) }}</span>
              <span v-else class="text-brand-700">ชำระครบ</span>
            </template>
          </span>
        </RouterLink>
      </div>
      <div v-else class="grid grid-cols-1 gap-2.5 lg:grid-cols-2 2xl:grid-cols-3">
        <RouterLink
          v-for="{ o, c, t } in g.orders"
          :key="o.id"
          :to="`/admin/orders/${o.id}`"
          class="card block rounded-3xl border-transparent p-3.5 shadow-md transition hover:shadow-lg focus-visible:ring-4 focus-visible:ring-brand-200 focus-visible:outline-none active:scale-[0.99]"
          :class="o.status === 'cancelled' ? 'grayscale' : ''"
        >
          <div class="flex items-start gap-3">
            <!-- เวลา -->
            <div class="flex w-14 shrink-0 flex-col items-center rounded-xl bg-brand-50 py-2 text-brand-800">
              <span class="text-base leading-none font-semibold tabular-nums">{{ timeOnly(o.pickupAt) }}</span>
              <span class="mt-1 text-xs text-brand-700">น.</span>
            </div>

            <div class="min-w-0 flex-1">
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0 truncate font-semibold text-stone-900">{{ c?.name }}</div>
                <span class="flex shrink-0 flex-col items-end gap-1"><StatusBadge :status="o.status" /><PayDueBadge :order="o" short /><span v-if="customerPending(o).length" class="rounded-full bg-sky-50 px-2 py-0.5 text-xs font-semibold whitespace-nowrap text-sky-700">รอตรวจสลิป</span></span>
              </div>
              <div class="mt-0.5 flex min-w-0 items-center gap-1.5 text-sm text-stone-500">
                <AppIcon :name="o.fulfillment === 'delivery' ? 'truck' : 'store'" :size="14" class="shrink-0" />
                <span class="shrink-0">{{ o.fulfillment === 'delivery' ? 'จัดส่ง' : 'รับที่ร้าน' }}</span>
                <span aria-hidden="true">·</span>
                <span class="truncate">{{ o.items[0]?.name }}<template v-if="o.items.length > 1"> +{{ o.items.length - 1 }}</template></span>
              </div>
            </div>
          </div>

          <!-- เงิน -->
          <div class="mt-3 flex items-center gap-3">
            <div v-if="o.status !== 'cancelled'" class="h-1.5 flex-1 overflow-hidden rounded-full bg-stone-100" role="progressbar" :aria-valuenow="paidPct(t)" aria-valuemin="0" aria-valuemax="100" aria-label="ชำระแล้ว">
              <div class="h-full rounded-full bg-brand-600 transition-all" :style="{ width: paidPct(t) + '%' }" />
            </div>
            <span v-else class="flex-1 text-sm text-stone-500">ยกเลิกแล้ว</span>
            <span class="shrink-0 text-right text-sm leading-tight">
              <b class="block font-semibold text-stone-900 tabular-nums">{{ money(t.total) }}</b>
              <template v-if="o.status !== 'cancelled'">
                <span v-if="t.balance > 0" class="text-xs font-medium text-amber-700">ค้าง {{ money(t.balance) }}</span>
                <span v-else-if="t.balance < 0" class="text-xs font-medium text-rose-700">ชำระเกิน {{ money(-t.balance) }}</span>
                <span v-else class="text-xs font-medium text-brand-700">ชำระครบ</span>
              </template>
              <span class="block text-xs text-stone-400">{{ orderNo(o.code) }}</span>
            </span>
          </div>
        </RouterLink>
      </div>
    </section>

    <!-- เว้นที่ท้ายรายการ ไม่ให้ปุ่มลอยบังรายการสุดท้าย (มือถือ) -->
    <div v-if="can('createOrder')" class="h-20 md:hidden" aria-hidden="true" />
    <!-- ปุ่มลอยสร้างออร์เดอร์ (มือถือ) -->
    <RouterLink
      v-if="can('createOrder')"
      to="/admin/orders/new"
      class="fixed right-4 bottom-[calc(env(safe-area-inset-bottom)+5rem)] z-30 flex h-14 w-14 items-center justify-center rounded-full bg-brand-600 text-white shadow-lg hover:bg-brand-700 md:hidden"
      aria-label="สร้างออร์เดอร์"
    ><AppIcon name="plus" :size="26" /></RouterLink>

    <AppModal v-if="bdOpen" title="เตือนวันเกิด" @close="bdOpen = false">
      <BirthdayList />
    </AppModal>
  </div>
</template>
