<script setup>
import { computed, ref } from 'vue'
import { db, findCustomer } from '../../data/store'
import { orderTotals } from '../../lib/pricing'
import { orderCost } from '../../lib/materials'
import { STATUS } from '../../lib/constants'
import { money, dateTime, toDateStr } from '../../lib/format'
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
      const total = orderTotals(o).total
      const cost = orderCost(o, db.optionGroups, db.products, db.ingredients)
      return { o, total, cost, profit: total - cost }
    })
    .sort((a, b) => a.o.pickupAt.localeCompare(b.o.pickupAt)),
)
const sum = computed(() => rows.value.reduce((s, r) => ({ total: s.total + r.total, cost: s.cost + r.cost, profit: s.profit + r.profit }), { total: 0, cost: 0, profit: 0 }))
const margin = computed(() => (sum.value.total > 0 ? Math.round((sum.value.profit / sum.value.total) * 100) : 0))
</script>

<template>
  <ManageShell title="สรุปกำไร" subtitle="ตามวันนัดรับ · ไม่นับออร์เดอร์ที่ยกเลิก" :toolbar="false">
    <section class="card mb-4 grid grid-cols-2 gap-3">
      <div><label class="label">ตั้งแต่วันที่</label><input :value="from" type="date" class="input" @input="setFrom($event.target.value)" /></div>
      <div><label class="label">ถึงวันที่</label><input v-model="to" type="date" :min="from" class="input" /></div>
    </section>

    <div class="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
      <div class="card p-3.5"><div class="text-xs text-stone-500">ออร์เดอร์</div><div class="text-xl font-bold text-stone-900">{{ rows.length }}</div></div>
      <div class="card p-3.5"><div class="text-xs text-stone-500">ยอดขาย</div><div class="text-xl font-bold text-stone-900">{{ money(sum.total) }}</div></div>
      <div class="card p-3.5"><div class="text-xs text-stone-500">ต้นทุนวัตถุดิบ</div><div class="text-xl font-bold text-stone-900">{{ money(sum.cost) }}</div></div>
      <div class="card p-3.5"><div class="text-xs text-stone-500">กำไร ({{ margin }}%)</div><div class="text-xl font-bold" :class="sum.profit >= 0 ? 'text-emerald-700' : 'text-rose-600'">{{ money(sum.profit) }}</div></div>
    </div>

    <p v-if="!rows.length" class="card py-10 text-center text-stone-500">ไม่มีออร์เดอร์ในช่วงนี้</p>
    <div v-else class="card divide-y divide-stone-100 p-0">
      <RouterLink v-for="r in rows" :key="r.o.id" :to="`/orders/${r.o.id}`" class="flex items-center gap-3 px-4 py-3 hover:bg-stone-50">
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
  </ManageShell>
</template>
