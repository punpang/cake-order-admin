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

// วัตถุดิบ: ต้องซื้อเพิ่มขึ้นก่อน → ยังไม่ได้นับ → พอแล้ว (ในแต่ละกลุ่มเรียงตามชื่อ)
const rawRank = (r) => (r.short > 0 ? 0 : r.stock == null ? 1 : 2)
const rows = computed(() => {
  const total = ordersMaterials(orders.value, db.optionGroups, db.retailItems)
  return Object.entries(total)
    .map(([id, amount]) => {
      const m = db.ingredients.find((x) => x.id === id)
      const stock = m?.stock ?? null
      return { id, name: m?.name || 'ไม่พบวัตถุดิบ', unit: m?.unit || '', amount, stock, short: shortfall(amount, stock) }
    })
    .sort((a, b) => rawRank(a) - rawRank(b) || a.name.localeCompare(b.name, 'th'))
})

const prep = computed(() => prepList(orders.value, db.optionGroups, db.retailItems))
const noRecipe = computed(() => missingRecipes(orders.value, db.optionGroups, db.retailItems))
// ตัวเค้กแยกสั่งทำ/สำเร็จ · สั่งทำแสดงเฉพาะชื่อเนื้อเค้กในหัวข้อย่อย
const cakeSplit = computed(() => ({
  custom: prep.value.cakes.filter((r) => r.kind === 'custom'),
  ready: prep.value.cakes.filter((r) => r.kind === 'ready'),
}))
const sumCount = (list) => list.reduce((s, r) => s + r.count, 0)
const cakeTotal = computed(() => sumCount(prep.value.cakes))
const cakeName = (r) => (r.kind === 'custom' ? r.flavor : r.name)
const showMissing = ref(false)

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

    <section class="card mb-3 flex items-center gap-3 py-3" aria-label="สรุปรายการเตรียม">
      <div class="min-w-0 flex-1">
        <div class="text-sm text-stone-600">ออร์เดอร์ที่นับ {{ orders.length }} รายการ</div>
        <div class="text-xs text-stone-500">{{ rangeText }}</div>
      </div>
      <div v-if="tab === 'prep'" class="shrink-0 text-right">
        <div class="text-2xl leading-none font-bold tabular-nums text-stone-900">{{ cakeTotal }} <span class="text-sm font-medium text-stone-500">ก้อน</span></div>
        <div class="mt-1 text-xs text-stone-500">สั่งทำ {{ sumCount(cakeSplit.custom) }} · สำเร็จ {{ sumCount(cakeSplit.ready) }}</div>
      </div>
    </section>

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
      <section v-if="noRecipe.length" class="no-print mb-3 overflow-hidden rounded-2xl bg-warning-50 text-sm text-warning-800 ring-1 ring-amber-200">
        <button type="button" class="flex min-h-11 w-full items-center gap-2 px-4 py-3 text-left font-semibold" :aria-expanded="showMissing" aria-controls="missing-list" @click="showMissing = !showMissing">
          <span class="min-w-0 flex-1">ยังไม่มีสูตร {{ noRecipe.length }} รายการ · วัตถุดิบไม่ถูกนับ</span>
          <span class="shrink-0 text-xs font-medium underline">{{ showMissing ? 'ซ่อน' : 'ดูรายการ' }}</span>
        </button>
        <div v-show="showMissing" id="missing-list" class="border-t border-warning-200 px-4 py-2 text-xs break-words">{{ noRecipe.slice(0, 10).join(', ') }}<span v-if="noRecipe.length > 10"> และอีก {{ noRecipe.length - 10 }} รายการ</span></div>
      </section>

      <template v-if="tab === 'prep'">
        <p v-if="!prep.cakes.length" class="card py-10 text-center text-stone-500">ไม่มีรายการที่ต้องเตรียมในช่วงนี้</p>
        <template v-else>
          <section class="card mb-3 p-0">
            <div class="card-title mb-0 border-b border-stone-100 px-4 py-3"><AppIcon name="cake" :size="18" class="text-brand-600" /> ตัวเค้ก</div>
            <div v-for="sub in [{ k: 'custom', l: 'สั่งทำ', list: cakeSplit.custom }, { k: 'ready', l: 'สำเร็จ', list: cakeSplit.ready }]" :key="sub.k">
              <template v-if="sub.list.length">
                <div class="flex items-center justify-between bg-stone-50 px-4 py-1.5 text-xs font-semibold text-stone-600"><span>{{ sub.l }}</span><span>{{ sumCount(sub.list) }} ก้อน</span></div>
                <div class="divide-y divide-stone-100">
                  <div v-for="row in sub.list" :key="row.name + row.pounds" class="flex items-center gap-3 px-4 py-3">
                    <span class="min-w-0 flex-1 truncate font-medium text-stone-900">{{ cakeName(row) }}</span>
                    <span class="shrink-0 rounded-md bg-stone-100 px-1.5 py-0.5 text-xs text-stone-600">{{ qty(row.pounds) }} ปอนด์</span>
                    <span class="w-8 shrink-0 text-right text-lg font-bold tabular-nums text-stone-900">{{ row.count }}</span>
                  </div>
                </div>
              </template>
            </div>
          </section>
          <section v-for="g in prep.groups" :key="g.id" class="card mb-3 p-0">
            <div class="card-title mb-0 border-b border-stone-100 px-4 py-3"><AppIcon name="tag" :size="18" class="text-brand-600" /> {{ g.name }} · {{ sumCount(g.rows) }} ชุด</div>
            <div class="divide-y divide-stone-100">
              <div v-for="row in g.rows" :key="row.name + row.pounds" class="flex items-center gap-3 px-4 py-3">
                <span class="min-w-0 flex-1 truncate font-medium text-stone-900">{{ row.name }}</span>
                <span class="shrink-0 rounded-md bg-stone-100 px-1.5 py-0.5 text-xs text-stone-600">{{ qty(row.pounds) }} ปอนด์</span>
                <span class="w-8 shrink-0 text-right text-lg font-bold tabular-nums text-stone-900">{{ row.count }}</span>
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
              <span class="block text-xs" :class="row.short > 0 ? 'font-semibold text-danger-700' : 'text-stone-500'">{{ row.stock == null ? 'ยังไม่ได้นับคงเหลือ' : row.short > 0 ? `ต้องซื้อเพิ่ม ${qty(row.short)} ${row.unit}` : `พอ · คงเหลือ ${qty(row.stock)} ${row.unit}` }}</span>
            </span>
            <span class="shrink-0 font-semibold text-stone-900">{{ qty(row.amount) }}</span>
            <span class="w-10 shrink-0 text-sm text-stone-500">{{ row.unit }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
