<script setup>
import { confirmDeactivate } from '../../lib/confirm'
import { computed, reactive, ref } from 'vue'
import { db, savePriceList, saveMainPrices } from '../../data/store'
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

// ---------- ตารางราคาเค้ก: หน้าเค้ก (ตามขนาด) + เนื้อเค้ก (คงที่) + ขนาด (แก้ที่นี่ที่เดียว มีผลทุกเค้กที่เกี่ยวข้อง) ----------
const optsOf = (k, all = false) => (db.optionGroups.find((g) => g.key === k)?.options || []).filter((x) => all || inactive.value || x.active !== false)
const sizes = computed(() => optsOf('size', true).filter((x) => x.active !== false))
const faces = computed(() => optsOf('face'))
const flavors = computed(() => optsOf('flavor'))
const table = reactive({ sizes: {}, faces: {}, flavors: {} })
function loadTable() {
  table.sizes = Object.fromEntries(sizes.value.map((s) => [s.id, s.price || 0]))
  table.faces = Object.fromEntries(optsOf('face', true).map((f) => [f.id, Object.fromEntries(sizes.value.map((s) => [s.id, f.sizePrices?.[s.id] ?? 0]))]))
  table.flavors = Object.fromEntries(optsOf('flavor', true).map((f) => [f.id, f.price || 0]))
}
loadTable()
const tableMsg = ref('')
function saveTable() {
  const vals = [...Object.values(table.sizes), ...Object.values(table.faces).flatMap((r) => Object.values(r)), ...Object.values(table.flavors)]
  if (vals.some((v) => v === '' || v == null || !(Number(v) >= 0))) return (tableMsg.value = 'กรอกตัวเลข 0 ขึ้นไปให้ครบทุกช่อง')
  saveMainPrices(JSON.parse(JSON.stringify(table)))
  loadTable()
  tableMsg.value = 'บันทึกแล้ว'
}

const today = toDateStr(new Date())
const nowIds = computed(() => activeLists(db.priceLists, today).map((l) => l.id))
const period = (l) => (l.scheduled ? `${l.from ? dateOnly(l.from) : '…'} – ${l.to ? dateOnly(l.to) : '…'}` : 'ไม่กำหนดเวลา')

const open = ref(false)
const blank = () => ({ id: null, name: '', active: true, scheduled: false, from: today, to: today, sizes: {}, faces: {}, flavors: {} })
const form = reactive(blank())
const error = ref('')
function edit(l) {
  Object.assign(form, l ? { ...blank(), ...l, sizes: { ...(l.sizes || {}) }, faces: JSON.parse(JSON.stringify(l.faces || {})), flavors: { ...(l.flavors || {}) } } : blank())
  for (const x of optsOf('face', true)) if (!form.faces[x.id]) form.faces[x.id] = {}
  error.value = ''
  open.value = true
}
async function save() {
  if (!form.name.trim()) return (error.value = 'กรอกชื่อราคาพิเศษ')
  if (form.scheduled && (!form.from || !form.to)) return (error.value = 'เลือกวันเริ่มและวันสิ้นสุด')
  if (form.scheduled && form.to < form.from) return (error.value = 'วันสิ้นสุดต้องไม่ก่อนวันเริ่ม')
  const vals = [...Object.values(form.sizes), ...Object.values(form.faces).flatMap((r) => Object.values(r)), ...Object.values(form.flavors)]
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
    subtitle="ราคาเค้ก (หน้าเค้ก + เนื้อเค้ก + ขนาด) และแบบราคาพิเศษ"
    add-label="เพิ่มราคาพิเศษ"
    search-placeholder="ค้นหาชื่อ"
    @add="edit(null)"
  >
    <!-- ตารางราคาเค้ก -->
    <section class="card mb-4">
      <div class="mb-1 text-[15px] font-semibold text-stone-900">ตารางราคาเค้ก</div>
      <p class="mb-3 text-xs text-stone-500">ราคาเค้ก = หน้าเค้ก (ตามขนาด) + เนื้อเค้ก (บวกเท่ากันทุกขนาด) + ราคาขนาด · เค้กชั้นคิดทีละชั้นแล้วรวม · เค้กสำเร็จคิดจากหน้า/เนื้อ/ขนาดที่กำหนดในหน้าสินค้า</p>
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
            <tr class="border-t border-stone-100">
              <td :colspan="sizes.length + 1" class="pt-3 pb-1 text-xs font-semibold text-stone-500">หน้าเค้ก (บวกตามขนาด)</td>
            </tr>
            <tr v-for="f in faces" :key="f.id" :class="f.active === false ? 'opacity-60' : ''">
              <td class="py-1.5 pr-3 whitespace-nowrap text-stone-800">{{ f.name }}<span v-if="f.active === false" class="ml-1 text-xs text-stone-400">(ปิด)</span></td>
              <td v-for="sz in sizes" :key="sz.id" class="px-1 py-1.5"><input v-model="table.faces[f.id][sz.id]" type="number" inputmode="numeric" min="0" class="input h-10 w-24" :aria-label="`${f.name} ${sz.name}`" /></td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="mt-4 mb-1 text-xs font-semibold text-stone-500">เนื้อเค้ก (บวกเท่ากันทุกขนาด)</div>
      <div class="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
        <label v-for="f in flavors" :key="f.id" class="flex items-center gap-3" :class="f.active === false ? 'opacity-60' : ''">
          <span class="min-w-0 flex-1 truncate text-sm text-stone-800">{{ f.name }}<span v-if="f.active === false" class="ml-1 text-xs text-stone-400">(ปิด)</span></span>
          <input v-model="table.flavors[f.id]" type="number" inputmode="numeric" min="0" class="input h-10 w-24 shrink-0" />
        </label>
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
                <tr class="border-t border-stone-100">
                  <td :colspan="sizes.length + 1" class="pt-3 pb-1 text-xs font-semibold text-stone-500">หน้าเค้ก (บวกตามขนาด)</td>
                </tr>
                <tr v-for="f in optsOf('face', true).filter((x) => x.active !== false)" :key="f.id">
                  <td class="py-1.5 pr-3 whitespace-nowrap text-stone-800">{{ f.name }}</td>
                  <td v-for="sz in sizes" :key="sz.id" class="px-1 py-1.5"><input v-model="form.faces[f.id][sz.id]" type="number" inputmode="numeric" min="0" class="input h-10 w-24" :placeholder="money(f.sizePrices?.[sz.id] || 0)" /></td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="mt-3 mb-1 text-xs font-semibold text-stone-500">เนื้อเค้ก (บวกเท่ากันทุกขนาด)</div>
          <div class="space-y-1.5">
            <label v-for="f in optsOf('flavor', true).filter((x) => x.active !== false)" :key="f.id" class="flex items-center gap-3">
              <span class="min-w-0 flex-1 truncate text-sm text-stone-800">{{ f.name }}</span>
              <input v-model="form.flavors[f.id]" type="number" inputmode="numeric" min="0" class="input h-10 w-24 shrink-0" :placeholder="money(f.price || 0)" />
            </label>
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
  </ManageShell>
</template>
