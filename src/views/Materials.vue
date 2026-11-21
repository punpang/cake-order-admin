<script setup>
import ThaiDateField from '../components/ThaiDateField.vue'
import DatePresets from '../components/DatePresets.vue'
import { computed, ref } from 'vue'
import { db, can } from '../data/store'
import { MATERIAL_STATUSES, STATUS } from '../lib/constants'
import { missingRecipes, ordersMaterials, prepList, shortfall } from '../lib/materials'
import { qty, toDateStr, dateOnly } from '../lib/format'
import { printKitchen } from '../lib/printKitchen'
import { isNative } from '../lib/nativeDevices'
import AppIcon from '../components/AppIcon.vue'
import KitchenTabs from '../components/KitchenTabs.vue'

const tab = ref('prep')
const today = toDateStr(new Date())
const from = ref(today)
const to = ref(today)
const showFilter = ref(false) // ตัวกรองละเอียด (พับไว้ก่อน)
const rangeText = computed(() => (from.value === to.value ? dateOnly(from.value) : `${dateOnly(from.value)} – ${dateOnly(to.value)}`))

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
  const total = ordersMaterials(orders.value, db.optionGroups, db.retailItems)
  return Object.entries(total)
    .map(([id, amount]) => {
      const m = db.ingredients.find((x) => x.id === id)
      const stock = m?.stock ?? null
      return { id, name: m?.name || 'ไม่พบวัตถุดิบ', unit: m?.unit || '', amount, stock, short: shortfall(amount, stock) }
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'th'))
})

const prep = computed(() => prepList(orders.value, db.optionGroups, db.retailItems))
const noRecipe = computed(() => missingRecipes(orders.value, db.optionGroups, db.retailItems))

function setFrom(v) {
  from.value = v
  if (to.value < v) to.value = v
}
</script>

<template>
  <div v-if="!can('viewMaterials')" class="card flex flex-col items-center gap-3 py-12 text-center">
    <span class="flex h-14 w-14 items-center justify-center rounded-2xl bg-stone-100 text-stone-400"><AppIcon name="user" :size="28" /></span>
    <div class="font-semibold text-stone-800">เฉพาะแอดมินและคนทำเค้ก</div>
    <RouterLink to="/admin/orders" class="btn-soft">กลับไปหน้าออร์เดอร์</RouterLink>
  </div>

  <div v-else>
    <KitchenTabs />
    <h1 class="page-title mb-4">รายการเตรียม</h1>

    <section class="card mb-4 space-y-3" aria-label="ตัวกรอง">
      <!-- แถวสรุป + ปุ่มลัด (ตัวกรองละเอียดพับไว้: คนครัวเห็นงานวันนี้ได้ทันทีโดยไม่ต้องเลื่อน) -->
      <div class="flex items-center gap-2">
        <p class="min-w-0 flex-1 text-sm text-stone-600">{{ rangeText }} · สถานะ {{ picked.length }}/{{ MATERIAL_STATUSES.length }}</p>
        <button v-if="!isNative()" type="button" class="btn-outline h-10 shrink-0 px-3 text-sm" @click="printKitchen">พิมพ์</button>
        <button type="button" class="btn-outline h-10 shrink-0 px-3 text-sm" :aria-expanded="showFilter" aria-controls="kitchen-filter" @click="showFilter = !showFilter"><AppIcon name="filter" :size="16" /> {{ showFilter ? 'ซ่อนตัวกรอง' : 'ตัวกรอง' }}</button>
      </div>
      <DatePresets :from="from" :to="to" :presets="['today', 'tomorrow', 'next7']" @set="([f, t]) => { from = f; to = t }" />
      <div v-show="showFilter" id="kitchen-filter" class="space-y-3 border-t border-stone-100 pt-3">
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><label class="label">ตั้งแต่วันที่</label><ThaiDateField :model-value="from" label="ตั้งแต่วันที่" @update:model-value="setFrom" /></div>
          <div><label class="label">ถึงวันที่</label><ThaiDateField v-model="to" :min="from" label="ถึงวันที่" /></div>
        </div>
        <div>
          <div class="mb-1.5 flex items-center justify-between gap-2">
            <div class="label mb-0">สถานะออร์เดอร์ <span class="font-normal text-stone-500">· เลือก {{ picked.length }}/{{ MATERIAL_STATUSES.length }}</span></div>
            <button type="button" class="h-9 rounded-lg px-2 text-sm font-medium text-brand-700 underline" @click="picked = picked.length === MATERIAL_STATUSES.length ? [] : [...MATERIAL_STATUSES]">{{ picked.length === MATERIAL_STATUSES.length ? 'ล้างทั้งหมด' : 'เลือกทั้งหมด' }}</button>
          </div>
          <div class="flex flex-wrap gap-2">
            <button v-for="s in MATERIAL_STATUSES" :key="s" type="button" class="chip" :class="picked.includes(s) ? 'chip-on' : 'chip-off'" :aria-pressed="picked.includes(s)" @click="toggle(s)">
              <span v-if="picked.includes(s)" aria-hidden="true">✓</span>
              <span v-else class="h-2 w-2 rounded-full" :class="STATUS[s].dot"></span>
              {{ STATUS[s].label }} ({{ countOf(s) }})
            </button>
          </div>
        </div>
        <p class="text-xs text-stone-500">นับจากวันนัดรับ</p>
      </div>
    </section>

    <div class="mb-3 text-sm text-stone-600">ออร์เดอร์ที่นับ {{ orders.length }} รายการ</div>

    <div class="mb-4 grid grid-cols-2 gap-1 seg-grid">
      <button
        v-for="t in [{ v: 'prep', l: 'เค้กและตัวเลือก' }, { v: 'raw', l: 'วัตถุดิบรวม' }]"
        :key="t.v"
        type="button"
        class="h-10 rounded-xl text-sm font-semibold transition"
        :class="tab === t.v ? 'bg-white text-brand-700 shadow-sm' : 'text-stone-500'"
        @click="tab = t.v"
      >{{ t.l }}</button>
    </div>

    <div class="kitchen-print-area">
      <h2 class="mb-2 hidden text-base font-semibold text-stone-900 print:block">{{ tab === 'prep' ? 'รายการเตรียม' : 'วัตถุดิบรวม' }} · {{ rangeText }}</h2>
      <section v-if="noRecipe.length" class="no-print mb-3 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200">
        <div class="font-semibold">ยังไม่มีสูตร {{ noRecipe.length }} รายการ · วัตถุดิบของรายการเหล่านี้ไม่ถูกนับ</div>
        <div class="mt-1 text-xs break-words">{{ noRecipe.slice(0, 10).join(', ') }}<span v-if="noRecipe.length > 10"> และอีก {{ noRecipe.length - 10 }} รายการ</span></div>
      </section>

      <template v-if="tab === 'prep'">
        <p v-if="!prep.cakes.length" class="card py-10 text-center text-stone-500">ไม่มีรายการที่ต้องเตรียมในช่วงนี้</p>
        <template v-else>
          <section class="card mb-3 p-0">
            <div class="card-title mb-0 border-b border-stone-100 px-4 py-3"><AppIcon name="cake" :size="18" class="text-brand-600" /> ตัวเค้ก</div>
            <div class="divide-y divide-stone-100">
              <div v-for="row in prep.cakes" :key="row.name + row.pounds" class="flex items-center gap-3 px-4 py-3">
                <span class="min-w-0 flex-1">
                  <span class="block truncate font-medium text-stone-900">{{ row.name }}</span>
                  <span class="block text-xs text-stone-500">{{ qty(row.pounds) }} ปอนด์</span>
                </span>
                <span class="shrink-0 font-semibold text-stone-900">{{ row.count }}</span>
                <span class="w-10 shrink-0 text-sm text-stone-500">ก้อน</span>
              </div>
            </div>
          </section>
          <section v-for="g in prep.groups" :key="g.id" class="card mb-3 p-0">
            <div class="card-title mb-0 border-b border-stone-100 px-4 py-3"><AppIcon name="tag" :size="18" class="text-brand-600" /> {{ g.name }}</div>
            <div class="divide-y divide-stone-100">
              <div v-for="row in g.rows" :key="row.name + row.pounds" class="flex items-center gap-3 px-4 py-3">
                <span class="min-w-0 flex-1">
                  <span class="block truncate font-medium text-stone-900">{{ row.name }}</span>
                  <span class="block text-xs text-stone-500">{{ qty(row.pounds) }} ปอนด์</span>
                </span>
                <span class="shrink-0 font-semibold text-stone-900">{{ row.count }}</span>
                <span class="w-10 shrink-0 text-sm text-stone-500">ชุด</span>
              </div>
            </div>
          </section>
        </template>
      </template>

      <p v-else-if="!rows.length" class="card py-10 text-center text-stone-500">ไม่มีวัตถุดิบที่ต้องเตรียมในช่วงนี้</p>

      <div v-else class="card p-0">
        <p class="border-b border-stone-100 px-4 py-2.5 text-xs text-stone-500">ตัวเลขขวา = ปริมาณที่ต้องใช้ในช่วงที่เลือก · บรรทัดใต้ชื่อ = เทียบกับคงเหลือที่นับไว้</p>
        <div class="divide-y divide-stone-100">
          <div v-for="row in rows" :key="row.id" class="flex items-center gap-3 px-4 py-3">
            <span class="min-w-0 flex-1">
              <span class="block truncate font-medium text-stone-900">{{ row.name }}</span>
              <span class="block text-xs" :class="row.short > 0 ? 'font-semibold text-rose-700' : 'text-stone-500'">{{ row.stock == null ? 'ยังไม่ได้นับคงเหลือ' : row.short > 0 ? `ต้องซื้อเพิ่ม ${qty(row.short)} ${row.unit}` : `พอ · คงเหลือ ${qty(row.stock)} ${row.unit}` }}</span>
            </span>
            <span class="shrink-0 font-semibold text-stone-900">{{ qty(row.amount) }}</span>
            <span class="w-10 shrink-0 text-sm text-stone-500">{{ row.unit }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
