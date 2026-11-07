<script setup>
import { computed, ref } from 'vue'
import { db, can, orderVisible, findCustomer, upcomingBirthdays } from '../data/store'
import { STATUS } from '../lib/constants'
import { orderTotals, describeSelections } from '../lib/pricing'
import { money, timeOnly, dayLabel, formatPhone } from '../lib/format'
import StatusBadge from '../components/StatusBadge.vue'
import PayDueBadge from '../components/PayDueBadge.vue'
import { customerPending } from '../lib/payDue'
import AppIcon from '../components/AppIcon.vue'
import AppModal from '../components/AppModal.vue'
import BirthdayList from '../components/BirthdayList.vue'

const status = ref('')
const from = ref('')
const to = ref('')
const q = ref('')
const fulfill = ref('') // '' | pickup | delivery
const payState = ref('') // '' | due | paid | over
const PAY_FILTERS = [{ v: 'due', l: 'ค้างชำระ' }, { v: 'paid', l: 'ชำระครบ' }, { v: 'over', l: 'ชำระเกิน' }]
function setFrom(v) {
  from.value = v
  if (v && to.value && to.value < v) to.value = v
}
const hasDate = computed(() => from.value || to.value)

// ข้อความที่ค้นหาได้: เลขออร์เดอร์, ชื่อ, เบอร์, LINE, ชื่อเค้ก, ตัวเลือก/ข้อความบนเค้ก, เจ้าของวันเกิด
function searchText(o) {
  const c = findCustomer(o.customerId)
  const parts = [o.code, c?.name, c?.phone, c?.phone && formatPhone(c.phone), c?.line, o.birthday?.name]
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
const posCount = computed(() => db.orders.filter((o) => o.channel === 'pos').length)
const visible = computed(() => {
  return db.orders.filter((o) => (showPos.value || o.channel !== 'pos') && orderVisible(o))
})

const counts = computed(() => {
  const c = {}
  for (const o of visible.value) c[o.status] = (c[o.status] || 0) + 1
  return c
})

const list = computed(() => {
  const s = q.value.trim().toLowerCase()
  return visible.value
    .filter((o) => !status.value || o.status === status.value)
    .filter((o) => !from.value || o.pickupAt.slice(0, 10) >= from.value)
    .filter((o) => !to.value || o.pickupAt.slice(0, 10) <= to.value)
    .filter((o) => !fulfill.value || o.fulfillment === fulfill.value)
    .filter(payMatch)
    .filter((o) => !s || searchText(o).includes(s))
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
  if (hasDate.value) out.push({ k: 'date', l: `นัดรับ ${from.value ? shortDate(from.value) : '…'}–${to.value ? shortDate(to.value) : '…'}` })
  if (fulfill.value) out.push({ k: 'fulfill', l: fulfill.value === 'delivery' ? 'จัดส่ง' : 'รับที่ร้าน' })
  if (payState.value) out.push({ k: 'pay', l: PAY_FILTERS.find((f) => f.v === payState.value).l })
  return out
})
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
    <div class="mb-4 flex items-end justify-between gap-3">
      <div class="min-w-0">
        <h1 class="text-2xl font-semibold tracking-tight text-stone-900">ออร์เดอร์</h1>
        <p class="text-sm text-stone-500">แสดง {{ list.length }} จาก {{ visible.length }} รายการ</p>
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
        <div class="flex min-w-0 items-center gap-2">
          <input :value="from" type="date" class="input" aria-label="ตั้งแต่วันที่" @input="setFrom($event.target.value)" />
          <span class="shrink-0 text-stone-400">–</span>
          <input v-model="to" type="date" :min="from" class="input" aria-label="ถึงวันที่" />
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

    <!-- ป้ายตัวกรองที่ใช้อยู่ -->
    <div v-if="activeFilters.length && !filtersOpen" class="mb-3 flex flex-wrap gap-2">
      <button
        v-for="f in activeFilters"
        :key="f.k"
        type="button"
        class="inline-flex h-8 items-center gap-1 rounded-full bg-brand-50 pr-2 pl-3 text-sm font-medium text-brand-800 hover:bg-brand-100"
        :aria-label="`ลบตัวกรอง ${f.l}`"
        @click="clearFilter(f.k)"
      >{{ f.l }} <AppIcon name="x" :size="14" /></button>
    </div>

    <!-- สถานะ -->
    <div class="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]" role="group" aria-label="กรองตามสถานะ">
      <button v-if="posCount && can('pos')" class="chip" :class="showPos ? 'chip-on' : 'chip-off'" :aria-pressed="showPos" @click="showPos = !showPos">
        บิลหน้าร้าน <span class="opacity-75">{{ posCount }}</span>
      </button>
      <button class="chip" :class="!status ? 'chip-on' : 'chip-off'" :aria-pressed="!status" @click="status = ''">
        ทั้งหมด <span class="opacity-75">{{ visible.length }}</span>
      </button>
      <template v-for="(s, key) in STATUS" :key="key">
        <button v-if="counts[key]" class="chip" :class="status === key ? 'chip-on' : 'chip-off'" :aria-pressed="status === key" @click="status = key">
          <span v-if="status !== key" class="h-2 w-2 rounded-full" :class="s.dot" />
          {{ s.label }} <span class="opacity-75">{{ counts[key] }}</span>
        </button>
      </template>
    </div>

    <!-- เตือนวันเกิด -->
    <button
      v-if="birthdays.length"
      class="mb-4 flex w-full items-center gap-3 rounded-2xl border border-rose-100 bg-rose-50/60 px-3.5 py-3 text-left transition hover:bg-rose-50 active:scale-[0.99]"
      @click="bdOpen = true"
    >
      <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-rose-600"><AppIcon name="cake" :size="18" /></span>
      <span class="min-w-0 flex-1">
        <span class="block text-sm font-semibold text-rose-900">วันเกิดใกล้ถึง {{ birthdays.length }} คน</span>
        <span class="block truncate text-xs text-rose-700">{{ birthdays.map((b) => b.name || findCustomer(b.customerId)?.name).join(', ') }}</span>
      </span>
      <AppIcon name="next" class="text-rose-300" />
    </button>

    <!-- ว่าง -->
    <div v-if="!list.length" class="empty py-12">
      <span class="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-600"><AppIcon name="cake" :size="28" /></span>
      <div class="font-semibold text-stone-800">ไม่พบออร์เดอร์</div>
      <div class="text-sm text-stone-500">ลองเปลี่ยนคำค้นหาหรือตัวกรอง</div>
      <button v-if="activeFilters.length || status || q" type="button" class="btn-soft" @click="clearAll(); status = ''; q = ''">ล้างตัวกรองทั้งหมด</button>
    </div>

    <!-- รายการตามวัน -->
    <section v-for="g in rows" :key="g.day" class="mb-6">
      <h2 class="sticky top-14 z-10 -mx-4 mb-2 flex items-baseline gap-2 bg-cream/90 px-5 py-2 backdrop-blur">
        <span class="text-base font-semibold text-stone-900">{{ dayLabel(g.day) }}</span>
        <span class="ml-auto text-xs font-medium text-stone-500">{{ g.orders.length }} ออร์เดอร์</span>
      </h2>

      <div class="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
        <RouterLink
          v-for="{ o, c, t } in g.orders"
          :key="o.id"
          :to="`/admin/orders/${o.id}`"
          class="card block rounded-3xl border-transparent p-3.5 shadow-md transition hover:shadow-lg focus-visible:ring-4 focus-visible:ring-brand-200 focus-visible:outline-none active:scale-[0.99]"
          :class="o.status === 'cancelled' ? 'opacity-70' : ''"
        >
          <div class="flex items-start gap-3">
            <!-- เวลา -->
            <div class="flex w-14 shrink-0 flex-col items-center rounded-xl bg-brand-50 py-2 text-brand-800">
              <span class="text-base leading-none font-semibold tabular-nums">{{ timeOnly(o.pickupAt) }}</span>
              <span class="mt-1 text-[11px] text-brand-700">น.</span>
            </div>

            <div class="min-w-0 flex-1">
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0 truncate font-semibold text-stone-900">{{ c?.name }}</div>
                <span class="flex shrink-0 flex-col items-end gap-1"><StatusBadge :status="o.status" /><PayDueBadge :order="o" short /><span v-if="customerPending(o).length" class="rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap text-sky-700">รอตรวจสลิป</span></span>
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
                <span v-else-if="t.balance < 0" class="text-xs font-medium text-rose-600">ชำระเกิน {{ money(-t.balance) }}</span>
                <span v-else class="text-xs font-medium text-brand-700">ชำระครบ</span>
              </template>
              <span class="block text-[11px] text-stone-400">{{ o.code }}</span>
            </span>
          </div>
        </RouterLink>
      </div>
    </section>

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
