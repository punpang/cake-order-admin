<script setup>
import { computed, ref } from 'vue'
import { db, session, can, findCustomer } from '../data/store'
import { STATUS, VISIBLE } from '../lib/constants'
import { orderTotals } from '../lib/pricing'
import { money, dateTime } from '../lib/format'
import StatusBadge from '../components/StatusBadge.vue'

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
</script>

<template>
  <div>
    <div class="mb-4 flex items-center justify-between gap-2">
      <h1 class="text-xl font-semibold">ออร์เดอร์</h1>
      <RouterLink v-if="can('createOrder')" to="/orders/new" class="btn-primary hidden sm:inline-flex">+ สร้างออร์เดอร์</RouterLink>
    </div>

    <div class="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1">
      <button
        class="shrink-0 rounded-full border px-3 py-1 text-sm"
        :class="!status ? 'border-rose-400 bg-rose-50 text-rose-700' : 'border-stone-300 bg-white'"
        @click="status = ''"
      >
        ทั้งหมด {{ visible.length }}
      </button>
      <button
        v-for="(s, key) in STATUS"
        v-show="counts[key]"
        :key="key"
        class="shrink-0 rounded-full border px-3 py-1 text-sm"
        :class="status === key ? 'border-rose-400 bg-rose-50 text-rose-700' : 'border-stone-300 bg-white'"
        @click="status = key"
      >
        {{ s.label }} {{ counts[key] }}
      </button>
    </div>

    <div class="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_200px]">
      <input v-model="q" class="input" placeholder="ค้นหา เลขออร์เดอร์ / ชื่อ / เบอร์" />
      <div class="flex gap-2">
        <input v-model="date" type="date" class="input" />
        <button v-if="date" class="btn-outline" @click="date = ''">ล้าง</button>
      </div>
    </div>

    <p v-if="!list.length" class="card text-center text-stone-500">ไม่มีออร์เดอร์</p>

    <div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <RouterLink
        v-for="o in list"
        :key="o.id"
        :to="`/orders/${o.id}`"
        class="card block transition hover:border-rose-300 hover:shadow-sm"
      >
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <div class="text-sm text-stone-500">{{ o.code }}</div>
            <div class="truncate font-semibold">{{ findCustomer(o.customerId)?.name }}</div>
          </div>
          <StatusBadge :status="o.status" />
        </div>
        <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span>🕑 {{ dateTime(o.pickupAt) }}</span>
          <span>{{ o.fulfillment === 'delivery' ? '🚚 จัดส่ง' : '🏪 รับที่ร้าน' }}</span>
        </div>
        <div class="mt-1 truncate text-sm text-stone-500">{{ o.items.map((i) => `${i.name}${i.qty > 1 ? ' ×' + i.qty : ''}`).join(', ') }}</div>
        <div class="mt-2 flex justify-between border-t border-stone-100 pt-2 text-sm">
          <span>รวม <b>{{ money(orderTotals(o).total) }}</b></span>
          <span v-if="o.status !== 'cancelled' && orderTotals(o).balance > 0" class="text-amber-700">ค้าง {{ money(orderTotals(o).balance) }}</span>
          <span v-else-if="o.status !== 'cancelled'" class="text-emerald-700">ชำระครบ</span>
        </div>
      </RouterLink>
    </div>

    <RouterLink
      v-if="can('createOrder')"
      to="/orders/new"
      class="fixed bottom-5 right-5 flex h-14 w-14 items-center justify-center rounded-full bg-rose-500 text-3xl text-white shadow-lg sm:hidden"
    >+</RouterLink>
  </div>
</template>
