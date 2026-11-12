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

// ---------- ตารางราคาเค้ก: ประเภท (คงที่ + ราคาขนาดของประเภท) + เนื้อเค้ก (คงที่) — แก้ที่นี่ที่เดียว มีผลทุกเค้กที่เกี่ยวข้อง ----------
const optsOf = (k, all = false) => (db.optionGroups.find((g) => g.key === k)?.options || []).filter((x) => all || inactive.value || x.active !== false)
const sizes = computed(() => optsOf('size', true).filter((x) => x.active !== false))
const types = computed(() => optsOf('type'))
// หัวข้อหลักแบบบวกเพิ่ม: รายตัวเลือกเป็นคงที่ (f) หรือตามขนาด (s) · ตารางหลัก table / ราคาพิเศษ form ใช้โครงเดียวกัน
const MAINS = [
  { key: 'flavor', f: 'flavors', s: 'flavorSizes', title: 'เนื้อเค้ก' },
  { key: 'style', f: 'styles', s: 'styleSizes', title: 'รูปแบบตกแต่ง' },
  { key: 'shape', f: 'shapes', s: 'shapeSizes', title: 'รูปทรง' },
]
const bySize = (o) => o.priceType === 'size'
const table = reactive({ types: {}, typeSizes: {}, flavors: {}, styles: {}, shapes: {}, flavorSizes: {}, styleSizes: {}, shapeSizes: {} })
function loadTable() {
  table.types = Object.fromEntries(optsOf('type', true).map((t) => [t.id, t.price || 0]))
  table.typeSizes = Object.fromEntries(optsOf('type', true).map((t) => [t.id, Object.fromEntries(sizes.value.map((s) => [s.id, t.sizePrices?.[s.id] ?? 0]))]))
  for (const m of MAINS) {
    table[m.f] = Object.fromEntries(optsOf(m.key, true).map((f) => [f.id, f.price || 0]))
    table[m.s] = Object.fromEntries(optsOf(m.key, true).filter(bySize).map((f) => [f.id, Object.fromEntries(sizes.value.map((s) => [s.id, f.sizePrices?.[s.id] ?? 0]))]))
  }
}
loadTable()
const tableMsg = ref('')
function saveTable() {
  const vals = [...Object.values(table.types), ...Object.values(table.typeSizes).flatMap((r) => Object.values(r)), ...MAINS.flatMap((m) => [...Object.values(table[m.f]), ...Object.values(table[m.s]).flatMap((r) => Object.values(r))])]
  if (vals.some((v) => v === '' || v == null || !(Number(v) >= 0))) return (tableMsg.value = 'กรอกตัวเลข 0 ขึ้นไปให้ครบทุกช่อง')
  saveMainPrices(JSON.parse(JSON.stringify(table)))
  loadTable()
  tableMsg.value = 'บันทึกแล้ว'
}
// ขนาดที่ประเภทไม่มี (ตาม allow) แสดงเป็นช่องจาง
const sizeGroupId = computed(() => db.optionGroups.find((g) => g.key === 'size')?.id)
const sizeOff = (t, sz) => !!t.allow?.[sizeGroupId.value] && !t.allow[sizeGroupId.value].includes(sz.id)

const today = toDateStr(new Date())
const nowIds = computed(() => activeLists(db.priceLists, today).map((l) => l.id))
const period = (l) => (l.scheduled ? `${l.from ? dateOnly(l.from) : '…'} – ${l.to ? dateOnly(l.to) : '…'}` : 'ไม่กำหนดเวลา')

const open = ref(false)
const blank = () => ({ id: null, name: '', active: true, scheduled: false, from: today, to: today, types: {}, typeSizes: {}, flavors: {}, styles: {}, shapes: {}, flavorSizes: {}, styleSizes: {}, shapeSizes: {} })
const form = reactive(blank())
const error = ref('')
function edit(l) {
  Object.assign(form, l ? { ...blank(), ...l, types: { ...(l.types || {}) }, typeSizes: JSON.parse(JSON.stringify(l.typeSizes || {})), flavors: { ...(l.flavors || {}) }, styles: { ...(l.styles || {}) }, shapes: { ...(l.shapes || {}) }, flavorSizes: JSON.parse(JSON.stringify(l.flavorSizes || {})), styleSizes: JSON.parse(JSON.stringify(l.styleSizes || {})), shapeSizes: JSON.parse(JSON.stringify(l.shapeSizes || {})) } : blank())
  for (const x of optsOf('type', true)) if (!form.typeSizes[x.id]) form.typeSizes[x.id] = {}
  for (const m of MAINS) for (const x of optsOf(m.key, true).filter(bySize)) if (!form[m.s][x.id]) form[m.s][x.id] = {}
  error.value = ''
  open.value = true
}
async function save() {
  if (!form.name.trim()) return (error.value = 'กรอกชื่อราคาพิเศษ')
  if (form.scheduled && (!form.from || !form.to)) return (error.value = 'เลือกวันเริ่มและวันสิ้นสุด')
  if (form.scheduled && form.to < form.from) return (error.value = 'วันสิ้นสุดต้องไม่ก่อนวันเริ่ม')
  const vals = [...Object.values(form.types), ...Object.values(form.typeSizes).flatMap((r) => Object.values(r)), ...MAINS.flatMap((m) => [...Object.values(form[m.f]), ...Object.values(form[m.s]).flatMap((r) => Object.values(r))])]
  if (vals.some((v) => v !== '' && v != null && !(Number(v) >= 0))) return (error.value = 'ราคาต้องเป็น 0 ขึ้นไป')
  if (!(await confirmDeactivate(db.priceLists, form, form.name))) return
  savePriceList({ ...form })
  open.value = false
}
</script>

<template>
  <ManageShell narrow guard
    v-model:q="q"
    v-model:inactive="inactive"
    title="การกำหนดราคา"
    subtitle="ราคาเค้ก (ประเภท + เนื้อเค้ก + ขนาด) และแบบราคาพิเศษ"
    add-label="เพิ่มราคาพิเศษ"
    search-placeholder="ค้นหาชื่อ"
    @add="edit(null)"
  >
    <!-- ตารางราคาเค้ก -->
    <section class="card mb-4">
      <div class="mb-1 text-[15px] font-semibold text-stone-900">ตารางราคาเค้ก</div>
      <p class="mb-3 text-xs text-stone-500">ราคาเค้ก = ราคาประเภท + ราคาขนาดของประเภทนั้น + เนื้อเค้ก · เค้กชั้นคิดทีละชั้นแล้วรวม · เค้กสำเร็จคิดจากประเภท/เนื้อ/ขนาดที่กำหนดในหน้าสินค้า · ช่องจาง = ประเภทนี้ไม่มีขนาดนั้น</p>
      <div class="-mx-4 overflow-x-auto px-4">
        <table class="w-full min-w-max text-sm">
          <thead>
            <tr class="text-left text-xs text-stone-500">
              <th class="py-2 pr-3 font-medium">ประเภท</th>
              <th class="px-1 py-2 font-medium">ราคาประเภท</th>
              <th v-for="sz in sizes" :key="sz.id" class="px-1 py-2 font-medium">{{ sz.name }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="t in types" :key="t.id" class="border-t border-stone-100" :class="t.active === false ? 'opacity-60' : ''">
              <td class="py-1.5 pr-3 whitespace-nowrap text-stone-800">{{ t.name }}<span v-if="t.active === false" class="ml-1 text-xs text-stone-400">(ปิด)</span></td>
              <td class="px-1 py-1.5"><input v-model="table.types[t.id]" type="text" v-num.dec min="0" class="input h-10 w-24" :aria-label="`ราคา ${t.name}`" /></td>
              <td v-for="sz in sizes" :key="sz.id" class="px-1 py-1.5"><input v-model="table.typeSizes[t.id][sz.id]" type="text" v-num.dec min="0" class="input h-10 w-24" :class="sizeOff(t, sz) ? 'opacity-40' : ''" :aria-label="`${t.name} ${sz.name}`" /></td>
            </tr>
          </tbody>
        </table>
      </div>
      <template v-for="m in MAINS" :key="m.key">
        <template v-if="optsOf(m.key).length">
          <div class="mt-4 mb-1 text-xs font-semibold text-stone-500">{{ m.title }} (คงที่ = บวกเท่ากันทุกขนาด · ตามขนาด = ตั้งราคาต่อขนาด · เลือกที่หน้าแก้ตัวเลือก)</div>
          <div class="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
            <template v-for="f in optsOf(m.key)" :key="f.id">
              <label v-if="!bySize(f)" class="flex items-center gap-3" :class="f.active === false ? 'opacity-60' : ''">
                <span class="min-w-0 flex-1 truncate text-sm text-stone-800">{{ f.name }}<span v-if="f.active === false" class="ml-1 text-xs text-stone-400">(ปิด)</span></span>
                <input v-model="table[m.f][f.id]" type="text" v-num.dec min="0" class="input h-10 w-24 shrink-0" :data-main-fixed="f.id" />
              </label>
              <div v-else class="sm:col-span-2" :class="f.active === false ? 'opacity-60' : ''">
                <div class="mb-1 text-sm text-stone-800">{{ f.name }} <span class="text-xs text-stone-400">ตามขนาด</span><span v-if="f.active === false" class="ml-1 text-xs text-stone-400">(ปิด)</span></div>
                <div class="flex flex-wrap gap-2">
                  <label v-for="sz in sizes" :key="sz.id" class="text-xs text-stone-500">{{ sz.name }}<input v-model="table[m.s][f.id][sz.id]" type="text" v-num.dec min="0" class="input mt-0.5 h-10 w-24" :data-main-size="`${f.id}:${sz.id}`" /></label>
                </div>
              </div>
            </template>
          </div>
        </template>
      </template>
      <div class="mt-3 flex items-center justify-end gap-3">
        <span v-if="tableMsg" class="text-sm" :class="tableMsg === 'บันทึกแล้ว' ? 'text-emerald-700' : 'text-rose-700'">{{ tableMsg }}</span>
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
        <div><label class="label">ชื่อ <span class="text-rose-600">*</span></label><input v-model="form.name" class="input" placeholder="เช่น ราคาสมาชิก, โปรวันแม่" /></div>
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
                  <th class="py-2 pr-3 font-medium">ประเภท</th>
                  <th class="px-1 py-2 font-medium">ราคาประเภท</th>
                  <th v-for="sz in sizes" :key="sz.id" class="px-1 py-2 font-medium">{{ sz.name }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="t in optsOf('type', true).filter((x) => x.active !== false)" :key="t.id" class="border-t border-stone-100">
                  <td class="py-1.5 pr-3 whitespace-nowrap text-stone-800">{{ t.name }}</td>
                  <td class="px-1 py-1.5"><input v-model="form.types[t.id]" type="text" v-num.dec min="0" class="input h-10 w-24" :placeholder="money(t.price || 0)" /></td>
                  <td v-for="sz in sizes" :key="sz.id" class="px-1 py-1.5"><input v-model="form.typeSizes[t.id][sz.id]" type="text" v-num.dec min="0" class="input h-10 w-24" :placeholder="money(t.sizePrices?.[sz.id] || 0)" /></td>
                </tr>
              </tbody>
            </table>
          </div>
          <template v-for="m in MAINS" :key="m.key">
            <template v-if="optsOf(m.key, true).some((x) => x.active !== false)">
              <div class="mt-3 mb-1 text-xs font-semibold text-stone-500">{{ m.title }}</div>
              <div class="space-y-1.5">
                <template v-for="f in optsOf(m.key, true).filter((x) => x.active !== false)" :key="f.id">
                  <label v-if="!bySize(f)" class="flex items-center gap-3">
                    <span class="min-w-0 flex-1 truncate text-sm text-stone-800">{{ f.name }}</span>
                    <input v-model="form[m.f][f.id]" type="text" v-num.dec min="0" class="input h-10 w-24 shrink-0" :placeholder="money(f.price || 0)" />
                  </label>
                  <div v-else>
                    <div class="mb-1 text-sm text-stone-800">{{ f.name }} <span class="text-xs text-stone-400">ตามขนาด</span></div>
                    <div class="flex flex-wrap gap-2">
                      <label v-for="sz in sizes" :key="sz.id" class="text-xs text-stone-500">{{ sz.name }}<input v-model="form[m.s][f.id][sz.id]" type="text" v-num.dec min="0" class="input mt-0.5 h-10 w-24" :placeholder="money(f.sizePrices?.[sz.id] || 0)" /></label>
                    </div>
                  </div>
                </template>
              </div>
            </template>
          </template>
          <p class="mt-1 text-xs text-stone-400">เว้นว่าง = ใช้ราคาปกติ (ตัวเลขจาง)</p>
        </div>
        <p class="text-xs text-stone-400">ถ้ามีหลายแบบใช้งานพร้อมกัน จะใช้ราคาที่ต่ำสุด (แยกทีละช่อง)</p>
        <p v-if="error" class="flex items-center gap-2 text-sm text-rose-700"><AppIcon name="alert" :size="16" /> {{ error }}</p>
      </div>
      <template #footer>
        <button class="btn-outline flex-1 sm:flex-none" @click="open = false">ยกเลิก</button>
        <button class="btn-primary flex-1 sm:flex-none" @click="save">บันทึก</button>
      </template>
    </AppModal>
  </ManageShell>
</template>
