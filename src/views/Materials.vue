<script setup>
import { computed, ref } from 'vue'
import { db, can } from '../data/store'
import { MATERIAL_STATUSES, STATUS } from '../lib/constants'
import { ordersMaterials } from '../lib/materials'
import { qty, toDateStr } from '../lib/format'
import AppIcon from '../components/AppIcon.vue'

const today = toDateStr(new Date())
const from = ref(today)
const to = ref(today)

const picked = ref([...MATERIAL_STATUSES])
function toggle(s) {
  const i = picked.value.indexOf(s)
  if (i >= 0) picked.value.splice(i, 1)
  else picked.value.push(s)
}

// ออร์เดอร์ในช่วงวัน (ทุกสถานะที่นับได้)
const inRange = computed(() =>
  db.orders.filter((o) => {
    const day = o.pickupAt.slice(0, 10)
    return MATERIAL_STATUSES.includes(o.status) && day >= from.value && day <= to.value
  }),
)
const countOf = (s) => inRange.value.filter((o) => o.status === s).length
const orders = computed(() => inRange.value.filter((o) => picked.value.includes(o.status)))

const rows = computed(() => {
  const total = ordersMaterials(orders.value, db.optionGroups, db.products)
  return Object.entries(total)
    .map(([id, amount]) => {
      const m = db.ingredients.find((x) => x.id === id)
      return { id, name: m?.name || 'ไม่พบวัตถุดิบ', unit: m?.unit || '', amount }
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'th'))
})

function setFrom(v) {
  from.value = v
  if (to.value < v) to.value = v
}
</script>

<template>
  <div v-if="!can('viewMaterials')" class="card flex flex-col items-center gap-3 py-12 text-center">
    <span class="flex h-14 w-14 items-center justify-center rounded-2xl bg-stone-100 text-stone-400"><AppIcon name="user" :size="28" /></span>
    <div class="font-semibold text-stone-800">เฉพาะแอดมินและคนทำเค้ก</div>
    <RouterLink to="/orders" class="btn-soft">กลับไปหน้าออร์เดอร์</RouterLink>
  </div>

  <div v-else class="mx-auto max-w-4xl">
    <h1 class="mb-4 text-xl font-bold tracking-tight text-stone-900">วัตถุดิบที่ต้องเตรียม</h1>

    <section class="card mb-4 space-y-3">
      <div class="grid grid-cols-2 gap-3">
        <div><label class="label">ตั้งแต่วันที่</label><input :value="from" type="date" class="input" @input="setFrom($event.target.value)" /></div>
        <div><label class="label">ถึงวันที่</label><input v-model="to" type="date" :min="from" class="input" /></div>
      </div>
      <div>
        <div class="label">สถานะออร์เดอร์</div>
        <div class="flex flex-wrap gap-2">
          <button v-for="s in MATERIAL_STATUSES" :key="s" type="button" class="chip" :class="picked.includes(s) ? 'chip-on' : 'chip-off'" @click="toggle(s)">
            <span class="h-2 w-2 rounded-full" :class="STATUS[s].dot"></span>
            {{ STATUS[s].label }} ({{ countOf(s) }})
          </button>
        </div>
      </div>
      <p class="text-xs text-stone-500">นับจากวันนัดรับ</p>
    </section>

    <div class="mb-3 text-sm text-stone-600">ออร์เดอร์ที่นับ {{ orders.length }} รายการ</div>

    <p v-if="!rows.length" class="card py-10 text-center text-stone-500">ไม่มีวัตถุดิบที่ต้องเตรียมในช่วงนี้</p>

    <div v-else class="card divide-y divide-stone-100 p-0">
      <div v-for="row in rows" :key="row.id" class="flex items-center gap-3 px-4 py-3">
        <span class="min-w-0 flex-1 truncate font-medium text-stone-900">{{ row.name }}</span>
        <span class="shrink-0 font-semibold text-stone-900">{{ qty(row.amount) }}</span>
        <span class="w-10 shrink-0 text-sm text-stone-500">{{ row.unit }}</span>
      </div>
    </div>
  </div>
</template>
