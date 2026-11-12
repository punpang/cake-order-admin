<script setup>
import SectionTabs from '../../components/SectionTabs.vue'
import { computed, ref, watch } from 'vue'
import { db, findCustomer } from '../../data/store'
import { orderTotals, shipNetOf } from '../../lib/pricing'
import { orderCost } from '../../lib/materials'
import { STATUS, MAIN_KEYS } from '../../lib/constants'
import { tiersOf } from '../../lib/pricing'
import { daysBetween } from '../../lib/birthday'
import { money, dateTime, toDateStr, dateOnly } from '../../lib/format'
import ManageShell from '../../components/ManageShell.vue'

// สรุปกำไรตามวันนัดรับ (ไม่นับออร์เดอร์ที่ยกเลิก) กำไร = ยอดรวม − ต้นทุนวัตถุดิบ
const d = new Date()
const to = ref(toDateStr(d))
d.setDate(1)
const from = ref(toDateStr(d))
function setFrom(v) {
  from.value = v
  if (to.value < v) to.value = v
}

const rows = computed(() =>
  db.orders
    .filter((o) => o.status !== 'cancelled')
    .filter((o) => {
      const day = o.pickupAt.slice(0, 10)
      return day >= from.value && day <= to.value
    })
    .map((o) => {
      const tt = orderTotals(o)
      const total = tt.beforeVat // ยอดขายไม่รวม VAT
      const cost = orderCost(o, db.optionGroups, db.retailItems, db.ingredients) + shipNetOf(tt) // + ค่าส่งที่จ่ายคนส่ง
      return { o, total, cost, profit: total - cost, balance: orderTotals(o).balance }
    })
    .sort((a, b) => a.o.pickupAt.localeCompare(b.o.pickupAt)),
)
const sum = computed(() => rows.value.reduce((s, r) => ({ total: s.total + r.total, cost: s.cost + r.cost, profit: s.profit + r.profit }), { total: 0, cost: 0, profit: 0 }))
const margin = computed(() => (sum.value.total > 0 ? Math.round((sum.value.profit / sum.value.total) * 100) : 0))

// ---------- กราฟยอดขาย / กำไร: รายวัน (ช่วงเกิน 62 วัน = รายเดือน) ----------
const monthly = computed(() => daysBetween(from.value, to.value) + 1 > 62)
const TH_MONTH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
const buckets = computed(() => {
  const list = []
  const d = new Date(`${from.value}T00:00`)
  const end = new Date(`${to.value}T00:00`)
  if (monthly.value) d.setDate(1)
  while (d <= end && list.length < 400) {
    const key = monthly.value ? toDateStr(d).slice(0, 7) : toDateStr(d)
    list.push({ key, sales: 0, profit: 0, count: 0 })
    if (monthly.value) d.setMonth(d.getMonth() + 1)
    else d.setDate(d.getDate() + 1)
  }
  const map = new Map(list.map((b) => [b.key, b]))
  for (const r of rows.value) {
    const b = map.get(monthly.value ? r.o.pickupAt.slice(0, 7) : r.o.pickupAt.slice(0, 10))
    if (b) Object.assign(b, { sales: b.sales + r.total, profit: b.profit + r.profit, count: b.count + 1 })
  }
  return list
})
const chartMax = computed(() => Math.max(1, ...buckets.value.map((b) => Math.max(b.sales, b.profit))))
const barH = (v) => `${Math.max(0, (v / chartMax.value) * 100)}%`
const bucketLabel = (k) => (monthly.value ? `${TH_MONTH[Number(k.slice(5, 7)) - 1]} ${String(Number(k.slice(0, 4)) + 543).slice(2)}` : String(Number(k.slice(8, 10))))
const bucketTitle = (k) => (monthly.value ? bucketLabel(k) : dateOnly(k))
const labelEvery = computed(() => Math.max(1, Math.ceil(buckets.value.length / 12)))
const hover = ref(-1)
const hovered = computed(() => buckets.value[hover.value] || null)

// ---------- ขายดี: สินค้าสำเร็จ/POS (ชิ้น) + กลุ่มหลักของสั่งทำ (ก้อน/ชั้น × จำนวน) ----------
const best = computed(() => {
  const ready = new Map()
  const main = Object.fromEntries(MAIN_KEYS.map((k) => [k, new Map()]))
  const add = (m, name, n) => m.set(name, (m.get(name) || 0) + n)
  for (const { o } of rows.value) {
    for (const it of o.items) {
      if (it.kind === 'retail') {
        add(ready, it.name, it.qty)
        continue
      }
      for (const t of tiersOf(it)) {
        for (const g of db.optionGroups.filter((x) => MAIN_KEYS.includes(x.key))) {
          const sel = (g.perTier ? t.selections : it.selections)?.[g.id]
          for (const id of [].concat(sel || [])) {
            const name = g.options.find((x) => x.id === id)?.name
            if (name) add(main[g.key], name, it.qty)
          }
        }
      }
    }
  }
  const top = (m) => [...m.entries()].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n).slice(0, 5)
  const title = (k) => db.optionGroups.find((g) => g.key === k)?.name || k
  return [{ key: 'ready', title: 'สินค้าสำเร็จ / POS', unit: 'ชิ้น', rows: top(ready) }, ...MAIN_KEYS.map((k) => ({ key: k, title: title(k), unit: 'ครั้ง', rows: top(main[k]) }))]
})

// ---------- รับเงินตามช่องทาง: งวดที่ยืนยันแล้ว ตามวันที่ชำระ (ไม่นับออร์เดอร์ยกเลิก) ----------
const byMethod = computed(() => {
  const m = new Map()
  for (const o of db.orders) {
    if (o.status === 'cancelled') continue
    for (const p of o.payments) {
      const day = (p.paidAt || '').slice(0, 10)
      if (p.status !== 'confirmed' || day < from.value || day > to.value) continue
      const cur = m.get(p.method) || { method: p.method, amount: 0, count: 0 }
      cur.amount += p.amount
      cur.count += 1
      m.set(p.method, cur)
    }
  }
  return [...m.values()].sort((a, b) => b.amount - a.amount)
})
const methodTotal = computed(() => byMethod.value.reduce((s, x) => s + x.amount, 0))

// ---------- ลูกค้าซื้อมากสุด + ยอดค้าง (ออร์เดอร์ในช่วง) ----------
const topCustomers = computed(() => {
  const m = new Map()
  for (const r of rows.value) {
    const cur = m.get(r.o.customerId) || { id: r.o.customerId, total: 0, count: 0 }
    cur.total += r.total
    cur.count += 1
    m.set(r.o.customerId, cur)
  }
  return [...m.values()].sort((a, b) => b.total - a.total).slice(0, 5)
})
const due = computed(() => {
  const list = rows.value.filter((r) => r.balance > 0)
  return { count: list.length, amount: list.reduce((s, r) => s + r.balance, 0) }
})
// แท็บ: สรุป (กราฟ/ขายดี/รับเงิน) · ออร์เดอร์ (รายการ แสดงทีละ 50)
const tab = ref('summary')
const rowLimit = ref(50)
watch([from, to], () => { rowLimit.value = 50 })
</script>

<template>
  <ManageShell title="ยอดขาย & กำไร" subtitle="ตามวันนัดรับ · ไม่นับออร์เดอร์ที่ยกเลิก" :toolbar="false">
    <section class="card mb-4 grid grid-cols-2 gap-3">
      <div><label class="label">ตั้งแต่วันที่</label><input :value="from" type="date" class="input" @input="setFrom($event.target.value)" /></div>
      <div><label class="label">ถึงวันที่</label><input v-model="to" type="date" :min="from" class="input" /></div>
    </section>

    <div class="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
      <div class="card p-3.5"><div class="text-xs text-stone-500">ออร์เดอร์</div><div class="text-xl font-semibold text-stone-900">{{ rows.length }}</div></div>
      <div class="card p-3.5"><div class="text-xs text-stone-500">ยอดขาย</div><div class="text-xl font-semibold text-stone-900">{{ money(sum.total) }}</div></div>
      <div class="card p-3.5"><div class="text-xs text-stone-500">ต้นทุนวัตถุดิบ</div><div class="text-xl font-semibold text-stone-900">{{ money(sum.cost) }}</div></div>
      <div class="card p-3.5"><div class="text-xs text-stone-500">กำไร ({{ margin }}%)</div><div class="text-xl font-semibold" :class="sum.profit >= 0 ? 'text-emerald-700' : 'text-rose-600'">{{ money(sum.profit) }}</div></div>
    </div>

    <SectionTabs v-model="tab" :tabs="[{ key: 'summary', label: 'สรุป' }, { key: 'orders', label: 'ออร์เดอร์', badge: rows.length }]" />

    <div v-show="tab === 'summary'">
    <!-- กราฟ -->
    <section class="card mb-4">
      <div class="mb-1 flex flex-wrap items-center justify-between gap-2">
        <div class="text-[15px] font-semibold text-stone-900">ยอดขาย / กำไร{{ monthly ? 'รายเดือน' : 'รายวัน' }}</div>
        <div class="flex items-center gap-3 text-xs text-stone-600">
          <span class="inline-flex items-center gap-1.5"><span class="h-2.5 w-2.5 rounded-sm bg-brand-500"></span>ยอดขาย</span>
          <span class="inline-flex items-center gap-1.5"><span class="h-2.5 w-2.5 rounded-sm bg-[#4a9d73]"></span>กำไร</span>
        </div>
      </div>
      <div class="mb-2 h-5 text-sm text-stone-600">
        <template v-if="hovered">{{ bucketTitle(hovered.key) }} · ยอดขาย <b class="text-stone-900">{{ money(hovered.sales) }}</b> · กำไร <b :class="hovered.profit >= 0 ? 'text-emerald-700' : 'text-rose-600'">{{ money(hovered.profit) }}</b> · {{ hovered.count }} ออร์เดอร์</template>
        <span v-else class="text-stone-400">แตะหรือชี้ที่แท่งเพื่อดูตัวเลข</span>
      </div>
      <div class="overflow-x-auto pb-1" @mouseleave="hover = -1">
        <div class="flex h-40 items-end gap-0.5 border-b border-stone-200" :style="{ minWidth: `${buckets.length * 14}px` }">
          <button
            v-for="(b, i) in buckets"
            :key="b.key"
            type="button"
            class="flex h-full min-w-0 flex-1 items-end justify-center gap-px rounded-t-md px-px"
            :class="hover === i ? 'bg-stone-100' : ''"
            :aria-label="`${bucketTitle(b.key)} ยอดขาย ${money(b.sales)} กำไร ${money(b.profit)}`"
            @mouseenter="hover = i"
            @click="hover = i"
          >
            <span class="w-1/2 max-w-3 rounded-t-[4px] bg-brand-500" :style="{ height: barH(b.sales) }"></span>
            <span class="w-1/2 max-w-3 rounded-t-[4px] bg-[#4a9d73]" :style="{ height: barH(b.profit) }"></span>
          </button>
        </div>
        <div class="flex gap-0.5 pt-1" :style="{ minWidth: `${buckets.length * 14}px` }">
          <span v-for="(b, i) in buckets" :key="b.key" class="min-w-0 flex-1 text-center text-xs whitespace-nowrap text-stone-500">{{ i % labelEvery === 0 ? bucketLabel(b.key) : '' }}</span>
        </div>
      </div>
      <p class="mt-1 text-xs text-stone-400">กำไรติดลบไม่แสดงแท่ง ดูตัวเลขได้เมื่อแตะ</p>
    </section>

    <!-- ขายดี -->
    <section class="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div v-for="b in best" :key="b.key" class="card">
        <div class="mb-2 text-[15px] font-semibold text-stone-900">ขายดี · {{ b.title }}</div>
        <p v-if="!b.rows.length" class="text-sm text-stone-400">ยังไม่มี</p>
        <ol v-else class="space-y-2">
          <li v-for="(r, i) in b.rows" :key="r.name" class="text-sm">
            <div class="flex items-center justify-between gap-2">
              <span class="min-w-0 truncate text-stone-800">{{ i + 1 }}. {{ r.name }}</span>
              <span class="shrink-0 font-semibold text-stone-900">{{ r.n }} {{ b.unit }}</span>
            </div>
            <div class="mt-1 h-1.5 overflow-hidden rounded-full bg-stone-100"><div class="h-full rounded-full bg-brand-400" :style="{ width: `${(r.n / b.rows[0].n) * 100}%` }"></div></div>
          </li>
        </ol>
      </div>
    </section>

    <section class="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
      <!-- รับเงินตามช่องทาง -->
      <div class="card">
        <div class="text-[15px] font-semibold text-stone-900">รับเงินตามช่องทาง</div>
        <p class="mb-2 text-xs text-stone-500">ยอดที่ยืนยันแล้ว ตามวันที่ชำระในช่วงนี้</p>
        <p v-if="!byMethod.length" class="text-sm text-stone-400">ยังไม่มี</p>
        <ul v-else class="space-y-1.5 text-sm">
          <li v-for="m in byMethod" :key="m.method" class="flex justify-between gap-2"><span class="text-stone-600">{{ m.method }} <span class="text-stone-400">({{ m.count }} งวด)</span></span><b class="text-stone-900">{{ money(m.amount) }}</b></li>
          <li class="flex justify-between gap-2 border-t border-stone-100 pt-1.5 font-semibold"><span>รวม</span><span>{{ money(methodTotal) }}</span></li>
        </ul>
      </div>
      <!-- ลูกค้าซื้อมากสุด + ยอดค้าง -->
      <div class="card">
        <div class="mb-2 text-[15px] font-semibold text-stone-900">ลูกค้าซื้อมากสุด</div>
        <p v-if="!topCustomers.length" class="text-sm text-stone-400">ยังไม่มี</p>
        <ol v-else class="space-y-1.5 text-sm">
          <li v-for="(c, i) in topCustomers" :key="c.id" class="flex justify-between gap-2">
            <span class="min-w-0 truncate text-stone-700">{{ i + 1 }}. {{ findCustomer(c.id)?.name }} <span class="text-stone-400">({{ c.count }})</span></span>
            <b class="shrink-0 text-stone-900">{{ money(c.total) }}</b>
          </li>
        </ol>
        <div class="mt-3 rounded-xl p-2.5 text-sm" :class="due.amount > 0 ? 'bg-amber-50 text-amber-800' : 'bg-stone-50 text-stone-600'">
          ยอดค้างรวม <b>{{ money(due.amount) }}</b> · {{ due.count }} ออร์เดอร์
        </div>
      </div>
    </section>

    </div>

    <div v-show="tab === 'orders'">
    <p v-if="!rows.length" class="card py-10 text-center text-stone-500">ไม่มีออร์เดอร์ในช่วงนี้</p>
    <div v-else class="card divide-y divide-stone-100 p-0">
      <RouterLink v-for="r in rows.slice(0, rowLimit)" :key="r.o.id" :to="`/admin/orders/${r.o.id}`" class="flex items-center gap-3 px-4 py-3 hover:bg-stone-50">
        <span class="min-w-0 flex-1">
          <span class="block truncate font-medium text-stone-900">{{ r.o.code }} · {{ findCustomer(r.o.customerId)?.name }}</span>
          <span class="block text-xs text-stone-500">{{ dateTime(r.o.pickupAt) }} · {{ STATUS[r.o.status].label }}</span>
        </span>
        <span class="shrink-0 text-right text-sm leading-tight">
          <span class="block text-stone-500">{{ money(r.total) }} − {{ money(r.cost) }}</span>
          <span class="block font-semibold" :class="r.profit >= 0 ? 'text-emerald-700' : 'text-rose-600'">{{ money(r.profit) }}</span>
        </span>
      </RouterLink>
    </div>
    <button v-if="rows.length > rowLimit" type="button" class="btn-outline mt-3 w-full" @click="rowLimit += 100">ดูเพิ่ม (เหลืออีก {{ rows.length - rowLimit }})</button>
    </div>
  </ManageShell>
</template>
