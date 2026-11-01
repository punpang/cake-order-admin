<script setup>
import { computed, ref } from 'vue'
import { db, session, can, findCustomer } from '../data/store'
import { STATUS, VISIBLE } from '../lib/constants'
import { orderTotals } from '../lib/pricing'
import { money, timeOnly, dayLabel, dateOnly } from '../lib/format'
import StatusBadge from '../components/StatusBadge.vue'
import AppIcon from '../components/AppIcon.vue'

const status = ref('')
const date = ref('')
const q = ref('')

const visible = computed(() => {
  const f = VISIBLE[session.role]
  return f ? db.orders.filter(f) : db.orders
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
    .filter((o) => !date.value || o.pickupAt.startsWith(date.value))
    .filter((o) => {
      if (!s) return true
      const c = findCustomer(o.customerId)
      return [o.code, c?.name, c?.phone].some((v) => v?.toLowerCase().includes(s))
    })
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
</script>

<template>
  <div>
    <!-- หัวข้อ -->
    <div class="mb-4 flex items-end justify-between gap-3">
      <div class="min-w-0">
        <h1 class="text-2xl font-bold tracking-tight text-stone-900">ออร์เดอร์</h1>
        <p class="text-sm text-stone-500">ทั้งหมด {{ visible.length }} รายการ</p>
      </div>
      <RouterLink v-if="can('createOrder')" to="/orders/new" class="btn-primary hidden md:inline-flex">
        <AppIcon name="plus" /> สร้างออร์เดอร์
      </RouterLink>
    </div>

    <!-- ค้นหา + วันที่ -->
    <div class="card mb-3 grid grid-cols-1 gap-2 p-3 sm:grid-cols-[1fr_auto]">
      <label class="relative block min-w-0">
        <AppIcon name="search" class="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-stone-400" />
        <input v-model="q" class="input pl-10" placeholder="ค้นหา เลขออร์เดอร์ / ชื่อ / เบอร์" />
      </label>
      <div class="flex min-w-0 gap-2">
        <input v-model="date" type="date" class="input sm:w-44" aria-label="วันนัดรับ" />
        <button v-if="date" class="btn-outline px-3" aria-label="ล้างวันที่" @click="date = ''"><AppIcon name="x" /></button>
      </div>
    </div>

    <!-- สถานะ -->
    <div class="-mx-4 mb-5 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
      <button class="chip" :class="!status ? 'chip-on' : 'chip-off'" @click="status = ''">
        ทั้งหมด <span class="opacity-70">{{ visible.length }}</span>
      </button>
      <template v-for="(s, key) in STATUS" :key="key">
        <button v-if="counts[key]" class="chip" :class="status === key ? 'chip-on' : 'chip-off'" @click="status = key">
          <span v-if="status !== key" class="h-2 w-2 rounded-full" :class="s.dot" />
          {{ s.label }} <span class="opacity-70">{{ counts[key] }}</span>
        </button>
      </template>
    </div>

    <!-- ว่าง -->
    <div v-if="!list.length" class="card flex flex-col items-center gap-3 py-12 text-center">
      <span class="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-500"><AppIcon name="cake" :size="28" /></span>
      <div class="font-semibold text-stone-800">ไม่มีออร์เดอร์</div>
      <div class="text-sm text-stone-500">ลองเปลี่ยนตัวกรอง หรือสร้างออร์เดอร์ใหม่</div>
    </div>

    <!-- รายการตามวัน -->
    <section v-for="g in rows" :key="g.day" class="mb-6">
      <h2 class="mb-2.5 flex items-baseline gap-2 px-1">
        <span class="text-base font-bold text-stone-900">{{ dayLabel(g.day) }}</span>
        <span v-if="dayLabel(g.day) !== dateOnly(g.day)" class="text-sm text-stone-500">{{ dateOnly(g.day) }}</span>
        <span class="ml-auto text-xs font-medium text-stone-400">{{ g.orders.length }} ออร์เดอร์</span>
      </h2>

      <div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <RouterLink
          v-for="{ o, c, t } in g.orders"
          :key="o.id"
          :to="`/orders/${o.id}`"
          class="card group relative block overflow-hidden transition hover:-translate-y-0.5 hover:shadow-[0_12px_32px_-16px_rgb(120_80_40/0.35)] active:scale-[0.99]"
        >
          <span class="absolute inset-y-0 left-0 w-1" :class="STATUS[o.status]?.bar" />

          <div class="flex items-start gap-3">
            <!-- เวลา -->
            <div class="flex w-14 shrink-0 flex-col items-center rounded-xl bg-brand-50 py-2 text-brand-800">
              <span class="text-base leading-none font-bold">{{ timeOnly(o.pickupAt) }}</span>
              <span class="mt-1 text-[10px] font-medium text-brand-600">น.</span>
            </div>

            <div class="min-w-0 flex-1">
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0">
                  <div class="truncate font-semibold text-stone-900">{{ c?.name }}</div>
                  <div class="text-xs text-stone-400">{{ o.code }}</div>
                </div>
                <StatusBadge :status="o.status" />
              </div>

              <div class="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                <span class="meta">
                  <AppIcon :name="o.fulfillment === 'delivery' ? 'truck' : 'store'" :size="15" class="text-stone-400" />
                  {{ o.fulfillment === 'delivery' ? 'จัดส่ง' : 'รับที่ร้าน' }}
                </span>
                <span class="meta min-w-0">
                  <AppIcon name="cake" :size="15" class="text-stone-400" />
                  <span class="truncate">{{ o.items.length }} รายการ · {{ o.items[0]?.name }}<template v-if="o.items.length > 1"> +{{ o.items.length - 1 }}</template></span>
                </span>
              </div>
            </div>
          </div>

          <!-- เงิน -->
          <div class="mt-3 border-t border-stone-100 pt-3">
            <div class="flex items-center justify-between gap-2 text-sm">
              <span class="text-stone-500">รวม <b class="text-base text-stone-900">{{ money(t.total) }}</b></span>
              <span v-if="o.status === 'cancelled'" class="text-stone-400">ยกเลิกแล้ว</span>
              <span v-else-if="t.balance > 0" class="font-medium text-amber-700">ค้าง {{ money(t.balance) }}</span>
              <span v-else class="inline-flex items-center gap-1 font-medium text-emerald-700"><AppIcon name="check" :size="15" /> ชำระครบ</span>
            </div>
            <div v-if="o.status !== 'cancelled'" class="mt-2 h-1.5 overflow-hidden rounded-full bg-stone-100">
              <div class="h-full rounded-full bg-emerald-500 transition-all" :style="{ width: paidPct(t) + '%' }" />
            </div>
          </div>
        </RouterLink>
      </div>
    </section>
  </div>
</template>
