<script setup>
import { confirmDeactivate } from '../../lib/confirm'
import { computed, reactive, ref } from 'vue'
import { db, savePriceList, savePriceLevel, saveSizePrices } from '../../data/store'
import { activeLists } from '../../lib/pricing'
import { dateOnly, toDateStr, money } from '../../lib/format'
import ManageShell from '../../components/ManageShell.vue'
import AppModal from '../../components/AppModal.vue'
import AppIcon from '../../components/AppIcon.vue'
import AppSwitch from '../../components/AppSwitch.vue'

const q = ref('')
const inactive = ref(false)

const list = computed(() => {
  const s = q.value.trim().toLowerCase()
  return db.priceLists
    .filter((l) => inactive.value || l.active !== false)
    .filter((l) => !s || l.name.toLowerCase().includes(s))
})

// ---------- ตารางราคาเค้ก: ราคาขนาด + ระดับราคา (แก้ที่นี่ที่เดียว มีผลทุกเค้กที่เกี่ยวข้อง) ----------
const sizes = computed(() => (db.optionGroups.find((g) => g.key === 'size')?.options || []).filter((x) => x.active !== false))
const levels = computed(() => db.priceLevels.filter((l) => inactive.value || l.active !== false))
const table = reactive({ sizes: {}, levels: {} })
function loadTable() {
  table.sizes = Object.fromEntries(sizes.value.map((s) => [s.id, s.price || 0]))
  table.levels = Object.fromEntries(db.priceLevels.map((l) => [l.id, Object.fromEntries(sizes.value.map((s) => [s.id, l.prices?.[s.id] ?? 0]))]))
}
loadTable()
const tableMsg = ref('')
function saveTable() {
  const bad = [...Object.values(table.sizes), ...Object.values(table.levels).flatMap((r) => Object.values(r))].some((v) => v === '' || !(Number(v) >= 0))
  if (bad) return (tableMsg.value = 'กรอกตัวเลข 0 ขึ้นไปให้ครบทุกช่อง')
  saveSizePrices(table.sizes)
  for (const l of db.priceLevels) savePriceLevel({ ...l, prices: { ...l.prices, ...table.levels[l.id] } })
  loadTable()
  tableMsg.value = 'บันทึกแล้ว'
}
// เพิ่ม/แก้ชื่อ/ปิดระดับ
const lvOpen = ref(false)
const lv = reactive({ id: null, name: '', active: true })
const lvError = ref('')
function editLevel(l) {
  Object.assign(lv, l ? { id: l.id, name: l.name, active: l.active !== false } : { id: null, name: '', active: true })
  lvError.value = ''
  lvOpen.value = true
}
async function saveLv() {
  if (!lv.name.trim()) return (lvError.value = 'กรอกชื่อระดับ')
  if (!(await confirmDeactivate(db.priceLevels, lv, lv.name))) return
  const cur = db.priceLevels.find((x) => x.id === lv.id)
  savePriceLevel({ ...lv, prices: { ...(cur?.prices || {}) } })
  loadTable()
  lvOpen.value = false
}

const today = toDateStr(new Date())
const nowIds = computed(() => activeLists(db.priceLists, today).map((l) => l.id))
const period = (l) => (l.scheduled ? `${l.from ? dateOnly(l.from) : '…'} – ${l.to ? dateOnly(l.to) : '…'}` : 'ไม่กำหนดเวลา')

const open = ref(false)
const blank = () => ({ id: null, name: '', active: true, scheduled: false, from: today, to: today, sizes: {}, levels: {} })
const form = reactive(blank())
const error = ref('')
function edit(l) {
  Object.assign(form, l ? { ...blank(), ...l, sizes: { ...(l.sizes || {}) }, levels: JSON.parse(JSON.stringify(l.levels || {})) } : blank())
  for (const x of db.priceLevels) if (!form.levels[x.id]) form.levels[x.id] = {}
  error.value = ''
  open.value = true
}
async function save() {
  if (!form.name.trim()) return (error.value = 'กรอกชื่อราคาพิเศษ')
  if (form.scheduled && (!form.from || !form.to)) return (error.value = 'เลือกวันเริ่มและวันสิ้นสุด')
  if (form.scheduled && form.to < form.from) return (error.value = 'วันสิ้นสุดต้องไม่ก่อนวันเริ่ม')
  const vals = [...Object.values(form.sizes), ...Object.values(form.levels).flatMap((r) => Object.values(r))]
  if (vals.some((v) => v !== '' && v != null && !(Number(v) >= 0))) return (error.value = 'ราคาต้องเป็น 0 ขึ้นไป')
  if (!(await confirmDeactivate(db.priceLists, form, form.name))) return
  savePriceList({ ...form })
  open.value = false
}
</script>

<template>
  <ManageShell
    v-model:q="q"
    v-model:inactive="inactive"
    title="การกำหนดราคา"
    subtitle="ราคาขนาด + ระดับราคา และแบบราคาพิเศษ"
    add-label="เพิ่มราคาพิเศษ"
    search-placeholder="ค้นหาชื่อ"
    @add="edit(null)"
  >
    <!-- ตารางราคาเค้ก -->
    <section class="card mb-4">
      <div class="mb-1 flex items-center justify-between gap-2">
        <div class="text-[15px] font-semibold text-stone-900">ตารางราคาเค้ก</div>
        <button class="btn-soft h-9 px-3" @click="editLevel(null)"><AppIcon name="plus" :size="16" /> เพิ่มระดับ</button>
      </div>
      <p class="mb-3 text-xs text-stone-500">ราคาเค้ก = ราคาขนาด + ระดับของหน้าเค้ก + ระดับของเนื้อเค้ก · เค้กสำเร็จ = ราคาขนาด + ระดับของสินค้า · เค้กชั้นคิดทีละชั้นแล้วรวม</p>
      <div class="-mx-4 overflow-x-auto px-4">
        <table class="w-full min-w-max text-sm">
          <thead>
            <tr class="text-left text-xs text-stone-500">
              <th class="py-2 pr-3 font-medium">บาท</th>
              <th v-for="sz in sizes" :key="sz.id" class="px-1 py-2 font-medium">{{ sz.name }}</th>
            </tr>
          </thead>
          <tbody>
            <tr class="border-t border-stone-100">
              <td class="py-2 pr-3 font-semibold whitespace-nowrap text-stone-900">ราคาขนาด</td>
              <td v-for="sz in sizes" :key="sz.id" class="px-1 py-2"><input v-model="table.sizes[sz.id]" type="number" inputmode="numeric" min="0" class="input h-10 w-24" :aria-label="`ราคา ${sz.name}`" /></td>
            </tr>
            <tr v-for="l in levels" :key="l.id" class="border-t border-stone-100" :class="l.active === false ? 'opacity-60' : ''">
              <td class="py-2 pr-3 whitespace-nowrap">
                <button type="button" class="inline-flex items-center gap-1 font-medium text-stone-800 hover:text-brand-700" @click="editLevel(l)">
                  + {{ l.name }} <AppIcon name="edit" :size="14" class="text-stone-400" />
                </button>
                <span v-if="l.active === false" class="ml-1 text-xs text-stone-400">(ปิด)</span>
              </td>
              <td v-for="sz in sizes" :key="sz.id" class="px-1 py-2"><input v-model="table.levels[l.id][sz.id]" type="number" inputmode="numeric" min="0" class="input h-10 w-24" :aria-label="`${l.name} ${sz.name}`" /></td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="mt-3 flex items-center justify-end gap-3">
        <span v-if="tableMsg" class="text-sm" :class="tableMsg === 'บันทึกแล้ว' ? 'text-emerald-700' : 'text-rose-600'">{{ tableMsg }}</span>
        <button class="btn-primary" @click="saveTable">บันทึกตาราง</button>
      </div>
    </section>

    <div class="mb-2 px-1 text-[15px] font-semibold text-stone-900">ราคาพิเศษ</div>
    <p v-if="!list.length" class="card py-10 text-center text-stone-500">ยังไม่มีราคาพิเศษ</p>

    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <button
        v-for="l in list"
        :key="l.id"
        class="card flex items-center gap-3 text-left transition hover:border-brand-300 active:scale-[0.99]"
        :class="l.active === false ? 'opacity-60' : ''"
        @click="edit(l)"
      >
        <span class="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-brand-600"><AppIcon name="wallet" :size="24" /></span>
        <span class="min-w-0 flex-1">
          <span class="flex items-center gap-2">
            <span class="truncate font-semibold text-stone-900">{{ l.name }}</span>
            <span v-if="nowIds.includes(l.id)" class="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">ใช้อยู่ตอนนี้</span>
            <span v-else-if="l.active === false" class="shrink-0 rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-500">ปิดใช้งาน</span>
          </span>
          <span class="block text-sm text-stone-500">{{ period(l) }}</span>
        </span>
      </button>
    </div>

    <AppModal v-if="open" :title="form.id ? 'แก้ไขราคาพิเศษ' : 'เพิ่มราคาพิเศษ'" @close="open = false">
      <div class="space-y-4">
        <div><label class="label">ชื่อ <span class="text-rose-500">*</span></label><input v-model="form.name" class="input" placeholder="เช่น ราคาสมาชิก, โปรวันแม่" /></div>
        <AppSwitch v-model="form.scheduled" label="กำหนดช่วงเวลา (นับจากวันที่สร้างออร์เดอร์)" class="flex" />
        <div v-if="form.scheduled" class="grid grid-cols-2 gap-3">
          <div><label class="label">วันเริ่ม</label><input v-model="form.from" type="date" class="input" /></div>
          <div><label class="label">วันสิ้นสุด</label><input v-model="form.to" type="date" :min="form.from" class="input" /></div>
        </div>
        <AppSwitch v-model="form.active" label="ใช้งาน" class="flex" />
        <div>
          <div class="label">ตารางราคาพิเศษ (บาท)</div>
          <div class="-mx-5 overflow-x-auto px-5">
            <table class="w-full min-w-max text-sm">
              <thead>
                <tr class="text-left text-xs text-stone-500">
                  <th class="py-2 pr-3 font-medium"></th>
                  <th v-for="sz in sizes" :key="sz.id" class="px-1 py-2 font-medium">{{ sz.name }}</th>
                </tr>
              </thead>
              <tbody>
                <tr class="border-t border-stone-100">
                  <td class="py-2 pr-3 whitespace-nowrap text-stone-800">ราคาขนาด</td>
                  <td v-for="sz in sizes" :key="sz.id" class="px-1 py-2"><input v-model="form.sizes[sz.id]" type="number" inputmode="numeric" min="0" class="input h-10 w-24" :placeholder="money(sz.price || 0)" /></td>
                </tr>
                <tr v-for="l in db.priceLevels.filter((x) => x.active !== false)" :key="l.id" class="border-t border-stone-100">
                  <td class="py-2 pr-3 whitespace-nowrap text-stone-800">+ {{ l.name }}</td>
                  <td v-for="sz in sizes" :key="sz.id" class="px-1 py-2"><input v-model="form.levels[l.id][sz.id]" type="number" inputmode="numeric" min="0" class="input h-10 w-24" :placeholder="money(l.prices?.[sz.id] || 0)" /></td>
                </tr>
              </tbody>
            </table>
          </div>
          <p class="mt-1 text-xs text-stone-400">เว้นว่าง = ใช้ราคาปกติ (ตัวเลขจาง) · ราคาพิเศษของตัวเลือกรองตั้งในหน้าตัวเลือก</p>
        </div>
        <p class="text-xs text-stone-400">ถ้ามีหลายแบบใช้งานพร้อมกัน จะใช้ราคาที่ต่ำสุด (แยกทีละช่อง)</p>
        <p v-if="error" class="flex items-center gap-2 text-sm text-rose-600"><AppIcon name="alert" :size="16" /> {{ error }}</p>
      </div>
      <template #footer>
        <button class="btn-outline flex-1 sm:flex-none" @click="open = false">ยกเลิก</button>
        <button class="btn-primary flex-1 sm:flex-none" @click="save">บันทึก</button>
      </template>
    </AppModal>
    <AppModal v-if="lvOpen" :title="lv.id ? 'แก้ไขระดับราคา' : 'เพิ่มระดับราคา'" @close="lvOpen = false">
      <div class="space-y-4">
        <div><label class="label">ชื่อระดับ <span class="text-rose-500">*</span></label><input v-model="lv.name" class="input" placeholder="เช่น พรีเมียม" /></div>
        <AppSwitch v-model="lv.active" label="ใช้งาน (แสดงให้เลือกในหน้าตัวเลือก/สินค้า)" class="flex" />
        <p class="text-xs text-stone-400">ใส่ราคาแต่ละขนาดในตารางราคาเค้ก · ปิดใช้งานแล้ว ตัวเลือกที่ใช้ระดับนี้อยู่ยังคิดราคาตามเดิม</p>
        <p v-if="lvError" class="flex items-center gap-2 text-sm text-rose-600"><AppIcon name="alert" :size="16" /> {{ lvError }}</p>
      </div>
      <template #footer>
        <button class="btn-outline flex-1 sm:flex-none" @click="lvOpen = false">ยกเลิก</button>
        <button class="btn-primary flex-1 sm:flex-none" @click="saveLv">บันทึก</button>
      </template>
    </AppModal>
  </ManageShell>
</template>
