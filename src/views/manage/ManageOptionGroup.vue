<script setup>
import MoneyInput from '../../components/MoneyInput.vue'
import { confirmDeactivate } from '../../lib/confirm'
import { computed, reactive, ref } from 'vue'
import { db, findGroup, saveGroup, saveOption, moveItem, moveItemTo } from '../../data/store'
import { GROUP_TYPES, APPLIES_TO, MAIN_KEYS } from '../../lib/constants'
import { money } from '../../lib/format'
import ManageShell from '../../components/ManageShell.vue'
import AppModal from '../../components/AppModal.vue'
import AppIcon from '../../components/AppIcon.vue'
import AppSwitch from '../../components/AppSwitch.vue'
import RecipeEditor from '../../components/RecipeEditor.vue'
import ImageUploader from '../../components/ImageUploader.vue'

const props = defineProps({ id: { type: String, required: true } })
const group = computed(() => findGroup(props.id))
const isSize = computed(() => group.value?.key === 'size')
const isType = computed(() => group.value?.key === 'type')
const isFlavor = computed(() => group.value?.key === 'flavor' || group.value?.key === 'style' || group.value?.key === 'shape') // รูปแบบตกแต่ง: ราคาบวกคงที่เหมือนเนื้อเค้ก
// กลุ่มหลัก (ประเภท/เนื้อเค้ก/ขนาด): ราคาตั้งที่หน้าการกำหนดราคา · กลุ่มรอง: ราคาตามขนาด
const isMain = computed(() => MAIN_KEYS.includes(group.value?.key))
const isStyle = computed(() => group.value?.key === 'style')
// รูปแบบตกแต่ง: หัวข้อรองที่เลือกได้ (ไม่ติ๊ก/ติ๊กครบ = ทุกหัวข้อ)
const subGroups = computed(() => db.optionGroups.filter((x) => !MAIN_KEYS.includes(x.key) && x.active !== false))
// ประเภท: เลือกเนื้อเค้ก/ขนาดที่มี
const limitGroups = computed(() => db.optionGroups.filter((x) => x.key === 'flavor' || x.key === 'size' || (x.key === 'style' && x.options.length)))

const q = ref('')
const inactive = ref(false)
const options = computed(() => {
  const s = q.value.trim().toLowerCase()
  return (group.value?.options || [])
    .filter((o) => inactive.value || o.active !== false)
    .filter((o) => !s || o.name.toLowerCase().includes(s))
})

// ขนาดทั้งหมด (ใช้ตั้งราคาตามขนาด)
const sizeOpts = computed(() => (db.optionGroups.find((x) => x.key === 'size')?.options || []).filter((x) => x.active !== false))
const sizesText = (prices, plus = '+') => sizeOpts.value.map((sz) => `${sz.name} ${plus}${money(prices?.[sz.id] || 0)}`).join(' · ')
const hasPrice = (o) =>
  o.priceType === 'fixed'
    ? !!Number(o.price) || Object.values(o.typePrice || {}).some((v) => Number(v))
    : [o.sizePrices, ...Object.values(o.typePrices || {})].some((m) => Object.values(m || {}).some((v) => Number(v)))
const priceText = (o) => {
  if (isSize.value) return `${o.pounds} ปอนด์`
  if (isType.value) return `${money(o.price || 0)} + ตามขนาด`
  if (isFlavor.value) return o.priceType === 'size' ? 'ตามขนาด' : o.price ? `+${money(o.price)}` : 'ไม่บวกเพิ่ม'
  if (!hasPrice(o)) return 'ไม่บวกเพิ่ม'
  return o.priceType === 'fixed' ? `+${money(o.price || 0)}` : 'ตามขนาด'
}
// ตัวเลือกรองแปรผันตามประเภท
const types = computed(() => (db.optionGroups.find((x) => x.key === 'type')?.options || []).filter((t) => t.active !== false || o.types?.includes(t.id)))
const typeName = (id) => db.optionGroups.find((x) => x.key === 'type')?.options.find((t) => t.id === id)?.name || ''
function toggleType(id) {
  const i = o.types.indexOf(id)
  if (i >= 0) o.types.splice(i, 1)
  else o.types.push(id)
}
// จัดลำดับตัวเลือก
// ลากวางเรียง (PC/เมาส์) · ปุ่ม ▲▼ ยังใช้ได้เสมอ (แป้นพิมพ์/มือถือ)
const dragging = ref(null)
const dropOn = ref(null)
const dropped = (target) => {
  const list = group.value.options
  if (dragging.value) moveItemTo(list, list.indexOf(dragging.value), list.indexOf(target))
  dragging.value = null; dropOn.value = null
}
const move = (opt, dir) => moveItem(group.value.options, group.value.options.indexOf(opt), dir)

// ---------- ตั้งค่ากลุ่ม ----------
const gOpen = ref(false)
const g = reactive({ id: null, name: '', type: 'single', required: false, appliesTo: [], placeholder: '', active: true, prepList: false, perTier: false })
const gError = ref('')
function editGroup() {
  const cur = group.value
  Object.assign(g, { id: cur.id, name: cur.name, type: cur.type, required: !!cur.required, appliesTo: [...cur.appliesTo], placeholder: cur.placeholder || '', active: cur.active !== false, prepList: !!cur.prepList, perTier: !!cur.perTier })
  gError.value = ''
  gOpen.value = true
}
function toggleApplies(k) {
  const i = g.appliesTo.indexOf(k)
  if (i >= 0) g.appliesTo.splice(i, 1)
  else g.appliesTo.push(k)
}
async function saveG() {
  if (!g.name.trim()) return (gError.value = 'กรอกชื่อกลุ่ม')
  if (!g.appliesTo.length) return (gError.value = 'เลือกอย่างน้อย 1 ประเภทสินค้า')
  if (!(await confirmDeactivate(db.optionGroups, g, g.name))) return
  // ขนาด: เลือกได้ 1 ขนาดต่อชั้น ใช้กับสั่งทำ (เค้กสำเร็จมีขนาดตายตัว)
  if (isSize.value) Object.assign(g, { type: 'single', appliesTo: ['custom'], perTier: true, required: true })
  saveGroup({ ...g, appliesTo: [...g.appliesTo] })
  gOpen.value = false
}

// ---------- ตัวเลือก ----------
const oOpen = ref(false)
const blank = () => ({ id: null, name: '', price: 0, pounds: 1, active: true, recipe: [], images: [], allow: {}, groups: [], sizePrices: {}, priceType: 'size', types: [], typePrices: {}, typePrice: {} })
const o = reactive(blank())
const oError = ref('')
function editOption(opt) {
  Object.assign(o, opt ? { ...blank(), ...opt, groups: [...(opt.groups || [])], recipe: (opt.recipe || []).map((x) => ({ ...x })), images: [...(opt.images || [])], allow: JSON.parse(JSON.stringify(opt.allow || {})), forces: JSON.parse(JSON.stringify(opt.forces || {})), sizePrices: { ...(opt.sizePrices || {}) }, types: [...(opt.types || [])], typePrices: JSON.parse(JSON.stringify(opt.typePrices || {})), typePrice: { ...(opt.typePrice || {}) } } : blank())
  for (const t of db.optionGroups.find((x) => x.key === 'type')?.options || []) if (!o.typePrices[t.id]) o.typePrices[t.id] = {}
  if (!o.forces) o.forces = {}
  oError.value = ''
  oOpen.value = true
  if (isFlavor.value) o.priceType = o.priceType === 'size' && opt ? 'size' : 'fixed' // หัวข้อหลักแบบบวกเพิ่ม: ไม่มีค่า = คงที่
}

// รูปทรง: บังคับเลือกตัวเลือกในหัวข้ออื่น (ติ๊กให้อัตโนมัติ + ล็อก)
const isShape = computed(() => group.value?.key === 'shape')
const forceGroups = computed(() => subGroups.value.filter((x) => x.perTier && x.type !== 'text' && (x.options || []).length))
const forceOn = (gid, oid) => (o.forces?.[gid] || []).includes(oid)
function toggleForce(gid, oid) {
  const cur = [...(o.forces[gid] || [])]
  const i = cur.indexOf(oid)
  if (i >= 0) cur.splice(i, 1)
  else cur.push(oid)
  if (cur.length) o.forces[gid] = cur
  else delete o.forces[gid]
}
const groupOn = (gid) => !o.groups?.length || o.groups.includes(gid)
function toggleGroup(gid) {
  const cur = o.groups?.length ? [...o.groups] : subGroups.value.map((x) => x.id)
  const i = cur.indexOf(gid)
  if (i >= 0) cur.splice(i, 1)
  else cur.push(gid)
  o.groups = subGroups.value.every((x) => cur.includes(x.id)) ? [] : cur // ครบทุกหัวข้อ = ไม่จำกัด
}
// รูปแบบตกแต่ง: ซ่อน/แสดงขนาดได้ (เหมือนประเภทเลือกขนาดที่มี)
const sizeLimit = computed(() => db.optionGroups.filter((x) => x.key === 'size' || x.key === 'shape'))
// รูปทรง: ตั้งได้เฉพาะขนาดที่เปิดให้ (ผลกระทบสองทาง เหมือนรูปแบบตกแต่ง)
const sizeOnly = computed(() => db.optionGroups.filter((x) => x.key === 'size'))
const allowGroups = computed(() => (isType.value ? limitGroups.value : isShape.value ? sizeOnly.value : sizeLimit.value))
const allowOn = (lg, oid) => !o.allow[lg.id] || o.allow[lg.id].includes(oid)
function toggleAllow(lg, oid) {
  const cur = o.allow[lg.id] ? [...o.allow[lg.id]] : lg.options.map((x) => x.id)
  const i = cur.indexOf(oid)
  if (i >= 0) cur.splice(i, 1)
  else cur.push(oid)
  // เลือกครบทุกตัว = ไม่จำกัด
  if (lg.options.every((x) => cur.includes(x.id))) delete o.allow[lg.id]
  else o.allow[lg.id] = cur
}
async function saveO() {
  if (!o.name.trim()) return (oError.value = 'กรอกชื่อตัวเลือก')
  if (isSize.value && !(o.pounds > 0)) return (oError.value = 'ขนาดต้องมากกว่า 0')
  const vals = [o.price, ...Object.values(o.sizePrices), ...Object.values(o.typePrice), ...Object.values(o.typePrices).flatMap((r) => Object.values(r))]
  if (!isMain.value && vals.some((v) => v !== '' && v != null && !(Number(v) >= 0))) return (oError.value = 'ราคาไม่ถูกต้อง')
  const data = { ...o }
  if (!isType.value) delete data.images
  if (!isStyle.value) delete data.groups
  if (!isType.value && !isStyle.value && !isShape.value) delete data.allow
  else {
    for (const lg of allowGroups.value) if (data.allow[lg.id] && !data.allow[lg.id].length) return (oError.value = `เลือก${lg.name}อย่างน้อย 1 อย่าง`)
  }
  if (!(await confirmDeactivate(group.value.options, o, o.name))) return
  saveOption(group.value.id, data)
  oOpen.value = false
}
</script>

<template>
  <div v-if="!group" class="card py-10 text-center text-stone-500">
    ไม่พบกลุ่มตัวเลือก <RouterLink to="/admin/settings/options" class="text-brand-700 underline">กลับ</RouterLink>
  </div>

  <ManageShell narrow
    v-else
    v-model:q="q"
    v-model:inactive="inactive"
    :title="group.name"
    back="/admin/settings/options"
    :add-label="group.type !== 'text' ? 'เพิ่มตัวเลือก' : ''"
    :toolbar="group.type !== 'text'"
    search-placeholder="ค้นหาตัวเลือก"
    @add="editOption(null)"
  >
    <!-- ตั้งค่ากลุ่ม -->
    <section class="card mb-4">
      <div class="flex items-start gap-3">
        <span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600"><AppIcon name="tag" :size="22" /></span>
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <span class="font-semibold text-stone-900">{{ group.name }}</span>
            <span v-if="group.required" class="rounded-full bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-700">จำเป็น</span>
            <span v-if="group.active === false" class="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-500">ปิดใช้งาน</span>
          </div>
          <div class="text-sm text-stone-500">{{ GROUP_TYPES[group.type] }} · {{ group.appliesTo.map((a) => APPLIES_TO[a]).join(', ') }}</div>
          <div class="mt-1 text-xs text-stone-400">
            <template v-if="isMain">
              {{ isSize ? 'ราคาขนาดตั้งแยกตามประเภท' : isType ? 'ราคาประเภท + ราคาขนาดของประเภท' : 'บวกเพิ่มเท่ากันทุกขนาด' }} · ตั้งตัวเลขที่ <RouterLink to="/admin/settings/pricing" class="text-brand-700 underline">การกำหนดราคา</RouterLink>
            </template>
            <template v-else-if="group.type !== 'text'">ราคาตามขนาด · บันเดิ้ลตั้งที่ <RouterLink to="/admin/settings/bundles" class="text-brand-700 underline">บันเดิ้ล</RouterLink></template>
          </div>
        </div>
        <button class="btn-outline h-9 px-3" @click="editGroup"><AppIcon name="edit" :size="16" /> แก้ไข</button>
      </div>
    </section>

    <p v-if="group.type === 'text'" class="card py-8 text-center text-sm text-stone-500">กลุ่มนี้เป็นช่องพิมพ์ข้อความ ไม่มีตัวเลือกและไม่มีราคา</p>

    <template v-else>
      <p v-if="!options.length" class="card py-10 text-center text-stone-500">ยังไม่มีตัวเลือก</p>
      <div class="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <div
          v-for="opt in options"
          :key="opt.id"
          class="card flex items-center gap-2 p-2 transition hover:border-brand-300"
          :class="[opt.active === false ? 'opacity-60' : '', dropOn === opt && dragging !== opt ? 'border-brand-500 ring-2 ring-brand-200' : '']"
          draggable="true"
          data-option-card
          @dragstart="dragging = opt"
          @dragend="dragging = null; dropOn = null"
          @dragover.prevent="dropOn = opt"
          @drop.prevent="dropped(opt)"
        >
          <button type="button" class="flex min-w-0 flex-1 items-center gap-3 rounded-xl p-1.5 text-left active:scale-[0.99]" @click="editOption(opt)">
            <span class="min-w-0 flex-1">
              <span class="flex items-center gap-2">
                <span class="truncate font-medium text-stone-900">{{ opt.name }}</span>
                <span v-if="opt.active === false" class="shrink-0 rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-500">ปิดใช้งาน</span>
                <span v-if="!isMain && opt.types?.length" class="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700">บางประเภท</span>
              </span>
            </span>
            <span class="shrink-0 text-sm font-semibold" :class="isSize || isType || opt.price || hasPrice(opt) ? 'text-stone-900' : 'text-stone-400'">{{ priceText(opt) }}</span>
          </button>
          <span class="flex shrink-0 flex-col">
            <button type="button" class="flex h-10 w-10 items-center justify-center rounded-md text-stone-400 hover:bg-stone-100 hover:text-stone-700 disabled:opacity-30" :disabled="group.options.indexOf(opt) === 0" aria-label="เลื่อนขึ้น" @click="move(opt, -1)">▲</button>
            <button type="button" class="flex h-10 w-10 items-center justify-center rounded-md text-stone-400 hover:bg-stone-100 hover:text-stone-700 disabled:opacity-30" :disabled="group.options.indexOf(opt) === group.options.length - 1" aria-label="เลื่อนลง" @click="move(opt, 1)">▼</button>
          </span>
        </div>
      </div>

    </template>

    <!-- modal กลุ่ม -->
    <AppModal v-if="gOpen" title="ตั้งค่ากลุ่ม" @close="gOpen = false">
      <div class="space-y-4">
        <div><label class="label">ชื่อกลุ่ม <span class="text-rose-600">*</span></label><input v-model="g.name" class="input" /></div>
        <p v-if="isSize" class="rounded-xl bg-stone-50 p-3 text-sm text-stone-600">กลุ่มขนาด: เลือกได้ 1 ขนาดต่อชั้น · จำเป็น · ใช้กับสั่งทำ (เค้กสำเร็จกำหนดขนาดในหน้าสินค้า)</p>
        <div v-if="g.type !== 'text' && !isSize">
          <div class="label">รูปแบบ</div>
          <div class="grid grid-cols-2 gap-2">
            <button
              v-for="key in ['single', 'multi']"
              :key="key"
              type="button"
              class="flex h-11 items-center justify-center gap-1.5 rounded-xl border text-sm font-medium"
              :class="g.type === key ? 'border-brand-500 bg-brand-50 text-brand-800 ring-1 ring-brand-500' : 'border-stone-200 text-stone-600'"
              @click="g.type = key"
            >{{ GROUP_TYPES[key] }}</button>
          </div>
        </div>
        <div v-if="!isSize">
          <div class="label">ใช้กับ</div>
          <div class="flex flex-wrap gap-2">
            <button v-for="(label, key) in APPLIES_TO" :key="key" type="button" class="chip" :class="g.appliesTo.includes(key) ? 'chip-on' : 'chip-off'" @click="toggleApplies(key)">{{ label }}</button>
          </div>
        </div>
        <div v-if="g.type === 'text'"><label class="label">ข้อความตัวอย่างในช่อง</label><input v-model="g.placeholder" class="input" /></div>
        <AppSwitch v-if="!isSize" v-model="g.required" label="จำเป็นต้องเลือก/กรอก" class="flex" />
        <AppSwitch v-model="g.active" label="ใช้งาน (แสดงตอนสร้างออร์เดอร์)" class="flex" />
        <AppSwitch v-if="g.appliesTo.includes('custom') && !isSize" v-model="g.perTier" label="เลือกแยกแต่ละชั้น (เค้กสั่งทำ)" class="flex" />
        <AppSwitch v-if="g.type !== 'text' && !isSize && group.key !== 'flavor'" v-model="g.prepList" label="แสดงในรายการเตรียม (นับเป็นชุด แยกตามขนาด)" class="flex" />
        <p v-if="gError" class="flex items-center gap-2 text-sm text-rose-700"><AppIcon name="alert" :size="16" /> {{ gError }}</p>
      </div>
      <template #footer>
        <button class="btn-outline flex-1 sm:flex-none" @click="gOpen = false">ยกเลิก</button>
        <button class="btn-primary flex-1 sm:flex-none" @click="saveG">บันทึก</button>
      </template>
    </AppModal>

    <!-- modal ตัวเลือก -->
    <AppModal v-if="oOpen" :title="o.id ? 'แก้ไขตัวเลือก' : 'เพิ่มตัวเลือก'" @close="oOpen = false">
      <div class="space-y-4">
        <div><label class="label">ชื่อตัวเลือก <span class="text-rose-600">*</span></label><input v-model="o.name" class="input" /></div>

        <div v-if="isFlavor">
          <div class="label">รูปแบบราคา</div>
          <div class="grid grid-cols-2 gap-2">
            <button
              v-for="pt in [{ v: 'fixed', l: 'คงที่ (ทุกขนาด)' }, { v: 'size', l: 'ตามขนาด' }]"
              :key="pt.v"
              type="button"
              class="flex h-11 items-center justify-center rounded-xl border text-sm font-medium"
              :class="o.priceType === pt.v ? 'border-brand-500 bg-brand-50 text-brand-800 ring-1 ring-brand-500' : 'border-stone-200 text-stone-600'"
              :data-main-price-type="pt.v"
              @click="o.priceType = pt.v"
            >{{ pt.l }}</button>
          </div>
        </div>

        <template v-if="isSize">
          <div><label class="label">ขนาด (ปอนด์)</label><MoneyInput v-model.number="o.pounds" min="0.5" class="input" /></div>
          <p class="text-sm text-stone-500">ราคาของขนาดนี้ตั้งแยกตามประเภทที่ <RouterLink to="/admin/settings/pricing" class="text-brand-700 underline">การกำหนดราคา</RouterLink></p>
        </template>

        <div v-else-if="isMain && isFlavor && o.priceType === 'size'" class="space-y-2">
          <div class="label">ราคาบวกเพิ่มตามขนาด (บาท)</div>
          <div class="flex flex-wrap gap-2">
            <label v-for="sz in sizeOpts" :key="sz.id" class="text-xs text-stone-500">{{ sz.name }}<MoneyInput v-model="o.sizePrices[sz.id]" min="0" class="input mt-0.5 h-11 w-24" :data-opt-size="sz.id" placeholder="0" /></label>
          </div>
          <p class="text-xs text-stone-400">เว้นว่าง = ไม่บวกเพิ่มในขนาดนั้น · ราคาพิเศษตามช่วงเวลาตั้งที่ <RouterLink to="/admin/settings/pricing" class="text-brand-700 underline">การกำหนดราคา</RouterLink></p>
        </div>

        <div v-else-if="isMain" class="rounded-xl bg-stone-50 p-3 text-sm text-stone-600">
          <template v-if="o.id">
            <template v-if="isType">ราคาประเภท {{ money(o.price || 0) }}<br />ราคาขนาด: {{ sizesText(o.sizePrices, '') }}<br /></template>
            <template v-else-if="o.priceType === 'size'">ราคาตามขนาด: {{ sizesText(o.sizePrices, '') }}<br /></template>
            <template v-else>ราคา: {{ o.price ? `+${money(o.price)} ทุกขนาด` : 'ไม่บวกเพิ่ม' }}<br /></template>
          </template>
          <span class="text-xs text-stone-500">ตั้ง/แก้ราคาที่ <RouterLink to="/admin/settings/pricing" class="text-brand-700 underline">การกำหนดราคา</RouterLink></span>
        </div>

        <template v-else>
          <div>
            <div class="label">รูปแบบราคา</div>
            <div class="grid grid-cols-2 gap-2">
              <button
                v-for="pt in [{ v: 'size', l: 'ตามขนาด' }, { v: 'fixed', l: 'คงที่' }]"
                :key="pt.v"
                type="button"
                class="flex h-11 items-center justify-center rounded-xl border text-sm font-medium"
                :class="o.priceType === pt.v ? 'border-brand-500 bg-brand-50 text-brand-800 ring-1 ring-brand-500' : 'border-stone-200 text-stone-600'"
                @click="o.priceType = pt.v"
              >{{ pt.l }}</button>
            </div>
          </div>
          <div>
            <div class="label">ใช้กับประเภท</div>
            <div class="flex flex-wrap gap-2">
              <button v-for="t in types" :key="t.id" type="button" class="chip" :class="o.types.includes(t.id) ? 'chip-on' : 'chip-off'" @click="toggleType(t.id)">{{ t.name }}</button>
            </div>
            <p class="mt-1 text-xs text-stone-400">{{ o.types.length ? `ใช้ได้เฉพาะ ${o.types.map(typeName).join(', ')}` : 'ไม่เลือก = ใช้ได้ทุกประเภท' }}</p>
          </div>
          <div>
            <div class="label">ราคา (บาท)</div>
            <div class="-mx-5 overflow-x-auto px-5">
              <table class="w-full min-w-max text-sm">
                <thead>
                  <tr class="text-left text-xs text-stone-500">
                    <th class="py-2 pr-3 font-medium"></th>
                    <template v-if="o.priceType === 'fixed'"><th class="px-1 py-2 font-medium">ราคา</th></template>
                    <th v-for="sz in o.priceType === 'fixed' ? [] : sizeOpts" :key="sz.id" class="px-1 py-2 font-medium">{{ sz.name }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr class="border-t border-stone-100">
                    <td class="py-1.5 pr-3 font-semibold whitespace-nowrap text-stone-900">ทุกประเภท</td>
                    <td v-if="o.priceType === 'fixed'" class="px-1 py-1.5"><MoneyInput v-model="o.price" min="0" class="input h-10 w-24" placeholder="0" /></td>
                    <td v-for="sz in o.priceType === 'fixed' ? [] : sizeOpts" :key="sz.id" class="px-1 py-1.5"><MoneyInput v-model="o.sizePrices[sz.id]" min="0" class="input h-10 w-24" placeholder="0" /></td>
                  </tr>
                  <tr v-for="t in types.filter((x) => !o.types.length || o.types.includes(x.id))" :key="t.id" class="border-t border-stone-100">
                    <td class="py-1.5 pr-3 whitespace-nowrap text-stone-700">{{ t.name }}</td>
                    <td v-if="o.priceType === 'fixed'" class="px-1 py-1.5"><MoneyInput v-model="o.typePrice[t.id]" min="0" class="input h-10 w-24" :placeholder="String(o.price || 0)" /></td>
                    <td v-for="sz in o.priceType === 'fixed' ? [] : sizeOpts" :key="sz.id" class="px-1 py-1.5"><MoneyInput v-model="o.typePrices[t.id][sz.id]" min="0" class="input h-10 w-24" :placeholder="String(o.sizePrices[sz.id] || 0)" /></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p class="mt-1 text-xs text-stone-400">
              แถวประเภทเว้นว่าง = ใช้ราคา "ทุกประเภท" (ตัวเลขจาง) ·
              {{ o.priceType === 'fixed' ? 'คงที่: บวกครั้งเดียวต่อที่เลือก (กลุ่มแยกชั้นบวกชั้นละครั้ง)' : 'ตามขนาด: เค้กชั้นคิดตามขนาดของแต่ละชั้น' }}
            </p>
          </div>
        </template>

        <div v-if="isType">
          <div class="label">รูปเค้ก (แสดงที่หน้าร้าน)</div>
          <ImageUploader v-model="o.images" :max="6" />
          <p class="mt-1 text-xs text-stone-400">รูปแรกใช้เป็นรูปหน้าปกของประเภทนี้</p>
        </div>
        <div v-if="isType" class="space-y-3">
          <div v-for="lg in limitGroups" :key="lg.id">
            <div class="label">{{ lg.name }}ที่มีสำหรับประเภทนี้</div>
            <div class="flex flex-wrap gap-2">
              <button v-for="x in lg.options.filter((y) => y.active !== false || allowOn(lg, y.id))" :key="x.id" type="button" class="chip" :class="allowOn(lg, x.id) ? 'chip-on' : 'chip-off'" @click="toggleAllow(lg, x.id)">{{ x.name }}</button>
            </div>
          </div>
          <p class="text-xs text-stone-400">ที่ไม่เลือกจะไม่แสดงตอนสั่ง</p>
        </div>
        <div v-if="isStyle" class="space-y-3">
          <div v-for="lg in sizeLimit" :key="lg.id">
            <div class="label">{{ lg.name }}ที่แสดงเมื่อเลือกรูปแบบนี้</div>
            <div class="flex flex-wrap gap-2">
              <button v-for="x in lg.options.filter((y) => y.active !== false || allowOn(lg, y.id))" :key="x.id" type="button" class="chip" :class="allowOn(lg, x.id) ? 'chip-on' : 'chip-off'" :aria-pressed="allowOn(lg, x.id)" :data-style-size="x.id" :data-style-allow="lg.key" @click="toggleAllow(lg, x.id)">{{ x.name }}</button>
            </div>
          </div>
          <p class="text-xs text-stone-400">ขนาด/รูปทรงที่ไม่เลือกจะซ่อนตอนสั่ง · ตั้งที่นี่ที่เดียว ใช้ได้ทั้งสองทาง (เลือกรูปแบบนี้ ซ่อนขนาดที่ไม่เข้ากัน / เลือกขนาดที่ไม่เข้ากัน ซ่อนรูปแบบนี้) · เลือกครบทุกตัว = ไม่จำกัด</p>
        </div>
        <div v-if="isShape" class="space-y-3">
          <div v-for="lg in sizeOnly" :key="lg.id">
            <div class="label">{{ lg.name }}ที่แสดงเมื่อเลือกรูปทรงนี้</div>
            <div class="flex flex-wrap gap-2">
              <button v-for="x in lg.options.filter((y) => y.active !== false || allowOn(lg, y.id))" :key="x.id" type="button" class="chip" :class="allowOn(lg, x.id) ? 'chip-on' : 'chip-off'" :aria-pressed="allowOn(lg, x.id)" :data-shape-size="x.id" @click="toggleAllow(lg, x.id)">{{ x.name }}</button>
            </div>
          </div>
          <p class="text-xs text-stone-400">ขนาดที่ไม่เลือกจะซ่อนตอนเลือกรูปทรงนี้ · ตั้งที่นี่ที่เดียว ใช้ได้ทั้งสองทาง · เลือกครบทุกตัว = ไม่จำกัด</p>
        </div>
        <div v-if="isStyle && subGroups.length">
          <div class="label">หัวข้อที่เลือกได้เมื่อเลือกรูปแบบนี้</div>
          <div class="flex flex-wrap gap-2">
            <button v-for="x in subGroups" :key="x.id" type="button" class="chip" :class="groupOn(x.id) ? 'chip-on' : 'chip-off'" :aria-pressed="groupOn(x.id)" data-style-group @click="toggleGroup(x.id)">{{ x.name }}</button>
          </div>
          <p class="mt-1 text-xs text-stone-400">หัวข้อที่ไม่เลือกจะซ่อนตอนสั่ง และล้างค่าที่เลือกไว้ · เลือกครบทุกหัวข้อ = ไม่จำกัด</p>
        </div>
        <div v-if="isShape && forceGroups.length">
          <div class="label">บังคับเลือกเมื่อเลือกรูปทรงนี้</div>
          <div v-for="fg in forceGroups" :key="fg.id" class="mb-2">
            <div class="mb-1 text-xs text-stone-500">{{ fg.name }}</div>
            <div class="flex flex-wrap gap-2">
              <button v-for="x in fg.options.filter((y) => y.active !== false || forceOn(fg.id, y.id))" :key="x.id" type="button" class="chip" :class="forceOn(fg.id, x.id) ? 'chip-on' : 'chip-off'" :aria-pressed="forceOn(fg.id, x.id)" :data-force="fg.id + ':' + x.id" @click="toggleForce(fg.id, x.id)">{{ x.name }}</button>
            </div>
          </div>
          <p class="text-xs text-stone-400">ตัวที่เลือกจะถูกติ๊กให้อัตโนมัติและลูกค้าเอาออกไม่ได้ · เปลี่ยนรูปทรงแล้วจะถูกเอาออก</p>
        </div>
        <RecipeEditor v-model="o.recipe" />
        <AppSwitch v-model="o.active" label="ใช้งาน (แสดงตอนสร้างออร์เดอร์)" class="flex" />
        <p v-if="oError" class="flex items-center gap-2 text-sm text-rose-700"><AppIcon name="alert" :size="16" /> {{ oError }}</p>
      </div>
      <template #footer>
        <button class="btn-outline flex-1 sm:flex-none" @click="oOpen = false">ยกเลิก</button>
        <button class="btn-primary flex-1 sm:flex-none" @click="saveO">บันทึก</button>
      </template>
    </AppModal>
  </ManageShell>
</template>
