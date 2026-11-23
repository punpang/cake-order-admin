<script setup>
import { askConfirm } from '../lib/confirm'
import { computed, reactive, ref, toRaw, watch } from 'vue'
import { db, activeListsAt, session } from '../data/store'
import { forcedOf, syncForced, priceDetail, allowedBy, forType, discountLines, groupOkFor } from '../lib/pricing'
import { decodeCake, findCodes } from '../lib/cakeCode'
import { money } from '../lib/format'
import { resizeImage, imageErrorMessage } from '../lib/imageResize'
import { MAIN_KEYS, typeFreeGroup, topTierOnly } from '../lib/constants'
import AppModal from './AppModal.vue'
import AppIcon from './AppIcon.vue'
import OptionPicker from './OptionPicker.vue'
import BundleHint from './BundleHint.vue'
import DiscountDetail from './DiscountDetail.vue'
import SecureImg from './SecureImg.vue'
import SmsTick from './SmsTick.vue'

const props = defineProps({
  item: { type: Object, default: null },
  priceDate: { type: String, default: '' }, // วันที่ใช้เลือกราคาพิเศษ (วันที่สร้างออร์เดอร์) ว่าง = วันนี้
  defaults: { type: Object, default: null }, // ค่าเริ่มต้นของรายการใหม่ (เช่น ข้อความบนเค้กจากแชท) { [groupId]: value }
  customer: { type: Object, default: null }, // มีลูกค้า = แสดงกล่องติ๊ก "แจ้งลูกค้า" (ใช้ที่หน้ารายละเอียดออร์เดอร์)
  order: { type: Object, default: null },
})
const emit = defineEmits(['save', 'close'])
const notifyCust = ref(true)
const smsCust = ref(true)

const blank = () => ({ id: `i${Date.now()}`, kind: 'retail', retailId: null, retailPrice: 0, sizeId: null, typeId: null, name: '', qty: 1, note: '', images: [], selections: { ...(props.defaults || {}) }, tiers: [] })
const form = reactive(props.item ? { tiers: [], ...JSON.parse(JSON.stringify(toRaw(props.item))) } : blank())

// รายการสั่งทำเก่าที่ยังไม่มีชั้น: ย้ายตัวเลือกของกลุ่มแยกชั้นไปไว้ชั้นที่ 1
if (form.kind === 'custom' && !form.tiers.length) {
  const first = {}
  for (const g of db.optionGroups) {
    if (g.perTier && form.selections[g.id] != null) {
      first[g.id] = form.selections[g.id]
      delete form.selections[g.id]
    }
  }
  form.tiers = [{ selections: first }]
}
const errors = ref({})
// ข้อมูลแพ้อาหาร = ข้อมูลสุขภาพ (PDPA ม.26) → บันทึกได้เมื่อลูกค้ายินยอมโดยชัดแจ้งแล้วเท่านั้น
const isHealthGroup = (g) => g.type === 'text' && (g.sensitive || g.id === 'g_allergy')
const healthText = () => wholeGroups.value.some((g) => isHealthGroup(g) && String(form.selections[g.id] ?? '').trim())
const healthOk = ref(!!form.healthConsent)
// เค้กชั้น: ต้องเลือกก่อน ปุ่มเพิ่ม/ลบชั้นถึงขึ้น
const layered = ref(form.tiers.length > 1)
async function setLayered(v) {
  if (v === layered.value) return
  if (v) {
    if (form.tiers.length < 2) form.tiers.push({ selections: {} })
  } else if (form.tiers.length > 1) {
    if (!(await askConfirm({ title: 'เปลี่ยนเป็นเค้กปกติ', message: 'เก็บไว้เฉพาะชั้นที่ 1 ชั้นอื่นจะถูกลบ', okText: 'เปลี่ยน', danger: true }))) return
    form.tiers.splice(1)
  }
  layered.value = v
}
// ขนาดที่เลือกของชั้น (ใช้แสดงราคาตัวเลือกแบบตามขนาด)
const sizeGroup = computed(() => db.optionGroups.find((g) => g.key === 'size'))
function sizeIdsOf(t) {
  const sg = sizeGroup.value
  if (!sg) return []
  const v = (sg.perTier && t ? t.selections : form.selections)[sg.id]
  return v == null ? [] : Array.isArray(v) ? v : [v]
}
// ประเภทที่เลือกของชั้น (ราคาขนาดขึ้นกับประเภท)
function typeOptOf(t) {
  const tg = typeGroup.value
  const v = tg ? typeSels(t)?.[tg.id] : null
  const id = Array.isArray(v) ? v[0] : v
  return tg?.options.find((o) => o.id === id) || null
}
const allSizeIds = computed(() => {
  if (form.kind === 'retail') return form.sizeId ? [form.sizeId] : []
  return sizeGroup.value?.perTier ? form.tiers.flatMap((t) => sizeIdsOf(t)) : sizeIdsOf(null)
})

// สินค้าสำเร็จมีขนาดตายตัว ไม่แสดงกลุ่มขนาด · ตัวเลือกของสินค้าสำเร็จ = กลุ่มที่ใช้กับ 'ready'
const groups = computed(() => db.optionGroups.filter((g) => g.active !== false && g.appliesTo.includes(form.kind === 'retail' ? 'ready' : form.kind) && !(form.kind === 'retail' && g.key === 'size')))
const tierGroups = computed(() => (form.kind === 'custom' ? groups.value.filter((g) => g.perTier) : []))
const wholeGroups = computed(() => groups.value.filter((g) => !tierGroups.value.includes(g)))

// เนื้อเค้ก/ขนาดที่ประเภทอนุญาต (ประเภทอยู่ในชั้นหรือทั้งก้อนก็ได้)
const typeGroup = computed(() => groups.value.find((g) => g.key === 'type'))
const typeSels = (t) => (typeGroup.value && tierGroups.value.includes(typeGroup.value) && t ? t.selections : form.selections)
// ตัวเลือกรองที่ประเภทของชั้นใช้ได้ (ตัวเลือกรองแปรผันตามประเภท)
const allowFor = (t) => {
  const a = allowedBy(db.optionGroups, typeSels(t))
  const tid = typeOptOf(t)?.id
  const gok = groupOkFor(db.optionGroups, form, t)
  // o = null → ถามแค่ว่าหัวข้อนี้เลือกได้ไหม (ตามรูปแบบตกแต่ง)
  const idx = form.kind === 'custom' ? form.tiers.indexOf(t) : -1
  // ขนาดต้องไล่ขึ้นจากชั้นบนลงล่าง: ชั้นนี้ ≥ ทุกชั้นที่อยู่บน และ ≤ ทุกชั้นที่อยู่ล่าง (เฉพาะชั้นที่เลือกขนาดแล้ว)
  const upIdx = idx > 0 ? form.tiers.slice(0, idx).map(sizeIdxOf).filter((x) => x >= 0) : []
  const lowIdx = idx >= 0 ? form.tiers.slice(idx + 1).map(sizeIdxOf).filter((x) => x >= 0) : []
  const up = upIdx.length ? Math.max(...upIdx) : -1
  const low = lowIdx.length ? Math.min(...lowIdx) : -1
  return (g, o) => {
    if (idx > 0 && topTierOnly(g)) return false // กลางเค้กมีได้เฉพาะชั้น 1
    if (!gok(g)) return false
    if (!o) return true
    if (sizeGroup.value && g.id === sizeGroup.value.id && g.perTier && idx >= 0) {
      const i = g.options.findIndex((x) => x.id === o.id)
      if (up >= 0 && i < up) return false
      if (low >= 0 && i > low) return false
    }
    return a(g, o) && (typeFreeGroup(g) || forType(o, tid))
  }
}
// ลำดับขนาด (ตามลำดับตัวเลือกในหัวข้อขนาด) ของชั้น · -1 = ยังไม่เลือก
function sizeIdxOf(t) {
  const sg = sizeGroup.value
  const id = sizeIdsOf(t)[0]
  return sg && id ? sg.options.findIndex((x) => x.id === id) : -1
}
// รูปทรงบังคับตัวเลือก: เติมให้อัตโนมัติ + ล็อก (ต่อชั้น)
const forcedPrev = new WeakMap()
const lockedOf = (t) => (t && form.kind === 'custom' ? forcedOf(db.optionGroups, t.selections, allowFor(t)) : null)
function applyForced() {
  if (form.kind !== 'custom') return
  for (const t of form.tiers) forcedPrev.set(t, syncForced(db.optionGroups, t.selections, forcedPrev.get(t), allowFor(t)))
}
// สินค้าสำเร็จ: ประเภทของสินค้า (ตัวเลือกรองตามประเภท)
const readyTypeOpt = computed(() => db.optionGroups.find((g) => g.key === 'type')?.options.find((o) => o.id === form.typeId) || null)
// เปลี่ยนประเภทแล้ว ตัดตัวเลือกที่ไม่มีออก
function prune(sels, allow, list) {
  for (const g of list) {
    if (!allow(g, null)) { delete sels[g.id]; continue } // หัวข้อที่รูปแบบตกแต่งไม่เปิดให้เลือก → ล้างค่า
    const v = sels[g.id]
    if (v == null || g.type === 'text') continue
    const ok = (id) => { const o = g.options.find((x) => x.id === id); return !o || allow(g, o) }
    if (Array.isArray(v)) sels[g.id] = v.filter(ok)
    else if (!ok(v)) delete sels[g.id]
  }
}
watch(
  () => JSON.stringify([form.selections, form.tiers]),
  () => {
    if (form.kind !== 'custom') return
    if (form.tiers.length) form.tiers.forEach((t) => prune(t.selections, allowFor(t), tierGroups.value))
    prune(form.selections, allowFor(form.tiers[0]), wholeGroups.value)
    applyForced()
  },
)
// สินค้าที่เลือกได้ = สินค้า POS ที่เปิดใช้งาน/แสดงใน POS และไม่ต้องเลือกตัวเลือกหน้าร้าน (เช่น เครื่องดื่ม) · ค้นหา/กรองหมวดได้
const q = ref('')
const cat = ref('')
const products = computed(() => db.retailItems.filter((p) => p.id === form.retailId || (p.active !== false && p.showInPos !== false && !(p.modifierIds || []).length)))
const cats = computed(() => [...new Set(products.value.map((p) => p.category).filter(Boolean))])
const shown = computed(() => products.value.filter((p) => (!cat.value || p.category === cat.value) && (!q.value.trim() || p.name.toLowerCase().includes(q.value.trim().toLowerCase()))))
const active = computed(() => activeListsAt(props.priceDate))
const detail = computed(() => priceDetail(form, db.optionGroups, db.retailItems, active.value, db.bundles))
const unitPrice = computed(() => detail.value.unitPrice)
const poundsOf = (p) => db.optionGroups.find((g) => g.key === 'size')?.options.find((o) => o.id === p.sizeId)?.pounds
function pickProduct(p) {
  Object.assign(form, { retailId: p.id, retailPrice: Number(p.price) || 0, sizeId: p.sizeId || null, typeId: p.typeId || null, name: p.name })
}

// วางรหัสสินค้าที่ลูกค้าคัดลอกมาจากหน้าเว็บ (#CK1…) → เติมฟอร์มให้เหมือนที่ลูกค้าเลือก
const pasteText = ref('')
const pasteMsg = ref({ ok: '', warn: [], error: '' })
function applyPaste() {
  pasteMsg.value = { ok: '', warn: [], error: '' }
  const codes = findCodes(pasteText.value)
  if (!codes.length) return (pasteMsg.value.error = 'ไม่พบรหัสสินค้า (#CK1…) ในข้อความ')
  if (codes.length > 1) pasteMsg.value.warn.push(`พบ ${codes.length} รหัส ใช้รหัสแรก (เพิ่มอีกรายการแล้ววางรหัสต่อไป)`)
  const r = decodeCake(codes[0], { groups: db.optionGroups, products: db.retailItems, active: active.value, bundles: db.bundles })
  if (r.error) return (pasteMsg.value.error = r.error)
  const it = r.item
  form.kind = 'custom'
  Object.assign(form, { retailId: null, retailPrice: 0, sizeId: null, typeId: null, qty: it.qty, note: it.note })
  form.selections = JSON.parse(JSON.stringify(it.selections))
  form.tiers = it.tiers.length ? JSON.parse(JSON.stringify(it.tiers)) : []
  layered.value = form.tiers.length > 1
  errors.value = {}
  pasteMsg.value.warn.push(...r.warnings.map((w) => w.text))
  pasteMsg.value.ok = `วางแล้ว: ${it.name} × ${it.qty}`
  pasteText.value = ''
}

function setKind(k) {
  if (form.kind === k) return
  form.kind = k
  Object.assign(form, { retailId: null, retailPrice: 0, sizeId: null, typeId: null })
  form.selections = { ...(props.defaults || {}) }
  form.tiers = k === 'custom' ? [{ selections: {} }] : []
  layered.value = false
  errors.value = {}
}

const MAX_REF_IMAGES = 6
const imgError = ref('')
async function onImages(e) {
  const files = [...e.target.files]
  e.target.value = ''
  imgError.value = ''
  const room = Math.max(MAX_REF_IMAGES - form.images.length, 0)
  if (files.length > room) imgError.value = `แนบได้สูงสุด ${MAX_REF_IMAGES} รูป`
  for (const f of files.slice(0, room)) {
    try {
      form.images.push(URL.createObjectURL((await resizeImage(f)).blob))
    } catch (err) {
      imgError.value = imageErrorMessage(err)
    }
  }
}

function save() {
  const err = {}
  if (form.kind === 'retail' && !form.retailId) err.product = 'เลือกสินค้า'
  const empty = (v) => v == null || v === ''
  const allowW = allowFor(form.tiers[0])
  for (const g of wholeGroups.value) {
    if (g.required && allowW(g, null) && empty(form.selections[g.id])) err[g.id] = `เลือก${g.name}`
  }
  form.tiers.forEach((t, i) => {
    const e = {}
    const allowT = allowFor(t)
    for (const g of tierGroups.value) if (g.required && allowT(g, null) && empty(t.selections[g.id])) e[g.id] = `เลือก${g.name}`
    if (Object.keys(e).length) err[`t${i}`] = e
  })
  if (!(form.qty >= 1)) err.qty = 'จำนวนอย่างน้อย 1'
  if (healthText() && !healthOk.value) err.health = 'ต้องได้รับความยินยอมโดยชัดแจ้งจากลูกค้าก่อนบันทึกข้อมูลแพ้อาหาร (หรือลบข้อความออก)'
  errors.value = err
  if (Object.keys(err).length) return

  // ตัดตัวเลือกของอีกประเภทออก
  const allowed = new Set(wholeGroups.value.map((g) => g.id))
  for (const k of Object.keys(form.selections)) if (!allowed.has(k)) delete form.selections[k]
  const tierAllowed = new Set(tierGroups.value.map((g) => g.id))
  for (const t of form.tiers) for (const k of Object.keys(t.selections)) if (!tierAllowed.has(k)) delete t.selections[k]
  if (form.kind !== 'custom' || !tierGroups.value.length) form.tiers = []
  // หลักฐานความยินยอม (เวลา/ผู้บันทึก) · ไม่มีข้อมูลแพ้อาหาร = ไม่เก็บ
  if (healthText()) form.healthConsent = form.healthConsent || { at: new Date().toISOString(), by: session.role || '' }
  else delete form.healthConsent

  if (form.kind === 'retail') {
    form.name = db.retailItems.find((p) => p.id === form.retailId)?.name || form.name
  } else {
    // ชื่อ = ประเภท · เนื้อเค้ก · ขนาด (หลายชั้นคั่นด้วย /)
    const namesOf = (g, sels) => {
      const sel = sels?.[g.id]
      const ids = sel == null ? [] : Array.isArray(sel) ? sel : [sel]
      return ids.map((id) => g.options.find((o) => o.id === id)?.name).filter(Boolean).join(' + ')
    }
    const mainOf = (t) =>
      MAIN_KEYS.map((k) => db.optionGroups.find((g) => g.key === k))
        .filter(Boolean)
        .map((g) => namesOf(g, g.perTier && form.tiers.length ? t.selections : form.selections))
        .filter(Boolean)
        .join(' · ')
    const tiers = form.tiers.length ? form.tiers : [{ selections: form.selections }]
    form.name = tiers.length > 1
      ? `เค้กสั่งทำ ${tiers.length} ชั้น (${tiers.map((t) => mainOf(t) || '-').join(' / ')})`
      : mainOf(tiers[0]) || 'เค้กสั่งทำ'
  }
  emit('save', { ...JSON.parse(JSON.stringify(toRaw(form))), ...detail.value }, { notify: notifyCust.value, sms: smsCust.value })
}

async function removeTier(i) {
  if (await askConfirm({ title: 'ลบชั้น', message: `ชั้นที่ ${i + 1}`, okText: 'ลบชั้น', danger: true })) form.tiers.splice(i, 1)
}

const step = (d) => { form.qty = Math.max(1, (Number(form.qty) || 1) + d) }
const styleIdOf = (t) => {
  const sg = groups.value.find((g) => g.key === 'style')
  return sg ? ([].concat((sg.perTier && t ? t.selections : form.selections)?.[sg.id] ?? [])[0] || null) : null
}
const scopesFor = (t) => ({ tier: { typeId: typeOptOf(t)?.id || null, styleId: styleIdOf(t), sizeIds: sizeIdsOf(t) }, whole: { typeId: typeOptOf(form.tiers[0])?.id || null, styleId: styleIdOf(form.tiers[0]), sizeIds: allSizeIds.value } })
</script>

<template>
  <AppModal :title="item ? 'แก้ไขสินค้า' : 'เพิ่มสินค้า'" split @close="emit('close')">
    <template #left>
    <!-- ประเภท -->
    <div class="mb-4 grid grid-cols-2 gap-1 seg-grid">
      <button
        v-for="k in [{ v: 'retail', t: 'สินค้าสำเร็จ' }, { v: 'custom', t: 'สั่งทำ' }]"
        :key="k.v"
        type="button"
        class="h-10 rounded-xl text-sm font-semibold transition"
        :class="form.kind === k.v ? 'bg-white text-brand-700 shadow-sm' : 'text-stone-500'"
        @click="setKind(k.v)"
      >
        {{ k.t }}
      </button>
    </div>

    <!-- วางรหัสจากลูกค้า -->
    <div v-if="!item" class="mb-3 rounded-2xl border border-dashed border-brand-300 bg-brand-50/40 p-3">
      <label class="label" for="paste-code">วางข้อความ/รหัสที่ลูกค้าคัดลอกมา <span class="font-normal text-stone-400">(สั่งทำ)</span></label>
      <div class="flex gap-2">
        <textarea id="paste-code" v-model="pasteText" rows="2" class="input min-w-0 flex-1 font-mono text-xs" placeholder="#CK1.…" @keydown.ctrl.enter="applyPaste" @keydown.meta.enter="applyPaste"></textarea>
        <button type="button" class="btn-soft self-start" :disabled="!pasteText.trim()" @click="applyPaste">ใส่ในฟอร์ม</button>
      </div>
      <p v-if="pasteMsg.ok" class="mt-1.5 text-sm font-medium text-emerald-700" role="status">{{ pasteMsg.ok }}</p>
      <p v-for="(w, i) in pasteMsg.warn" :key="i" class="mt-1 text-sm text-amber-700">⚠ {{ w }}</p>
      <p v-if="pasteMsg.error" class="mt-1.5 text-sm text-rose-700" role="alert">{{ pasteMsg.error }}</p>
    </div>

    <!-- สินค้าสำเร็จ (สินค้า POS) -->
    <div v-if="form.kind === 'retail'" class="mb-3 rounded-2xl border bg-white p-3.5" :class="errors.product ? 'border-rose-300 ring-4 ring-rose-50' : 'border-stone-200/70'">
      <div class="mb-2.5 flex items-baseline gap-2">
        <span class="text-sm font-semibold text-stone-800">เลือกสินค้า</span>
        <span class="text-xs font-medium text-rose-700">จำเป็น</span>
      </div>
      <div class="mb-2.5 flex flex-wrap gap-2">
        <input v-model="q" type="search" class="input h-10 min-w-0 flex-1 basis-40" placeholder="ค้นหาสินค้า" />
        <div v-if="cats.length > 1" class="flex flex-wrap gap-1.5">
          <button type="button" class="chip" :class="!cat ? 'chip-on' : 'chip-off'" @click="cat = ''">ทั้งหมด</button>
          <button v-for="c in cats" :key="c" type="button" class="chip" :class="cat === c ? 'chip-on' : 'chip-off'" @click="cat = c">{{ c }}</button>
        </div>
      </div>
      <div class="grid max-h-72 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
        <button
          v-for="p in shown"
          :key="p.id"
          type="button"
          class="flex items-center gap-3 rounded-xl border p-3 text-left transition active:scale-[0.99]"
          :class="form.retailId === p.id ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500' : 'border-stone-200 hover:border-brand-300'"
          @click="pickProduct(p)"
        >
          <img v-if="p.images?.length" :src="p.images[0]" alt="" loading="lazy" decoding="async" class="h-10 w-10 shrink-0 rounded-lg object-cover" />
          <span v-else class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg" :class="form.retailId === p.id ? 'bg-brand-600 text-white' : 'bg-brand-50 text-brand-600'">
            <AppIcon :name="form.retailId === p.id ? 'check' : 'cake'" :size="20" />
          </span>
          <span class="min-w-0 flex-1">
            <span class="block truncate font-medium text-stone-900">{{ p.name }}</span>
            <span class="block truncate text-xs text-stone-500">{{ p.category || '-' }}<template v-if="poundsOf(p)"> · {{ poundsOf(p) }} ปอนด์</template><template v-if="p.stock != null"> · เหลือ {{ p.stock }}</template></span>
          </span>
          <span class="shrink-0 font-semibold text-stone-900">{{ money(p.price) }}</span>
        </button>
      </div>
      <p v-if="!shown.length" class="py-4 text-center text-sm text-stone-500">ไม่พบสินค้า</p>
      <p v-if="errors.product" class="mt-2 text-sm text-rose-700">{{ errors.product }}</p>
    </div>

    <!-- รูป + หมายเหตุ -->
    <div class="mt-3 rounded-2xl border border-stone-200/70 bg-white p-3.5">
      <div class="mb-2.5 text-sm font-semibold text-stone-800">รูปตัวอย่าง</div>
      <div class="flex flex-wrap gap-2">
        <div v-for="(src, i) in form.images" :key="src" class="relative">
          <SecureImg :src="src" class="h-20 w-20 rounded-xl object-cover" />
          <button type="button" class="absolute -top-1.5 -right-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-stone-900 text-white shadow" aria-label="ลบรูป" @click="form.images.splice(i, 1)">
            <AppIcon name="x" :size="14" />
          </button>
        </div>
        <label v-if="form.images.length < MAX_REF_IMAGES" class="flex h-20 w-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-stone-200 text-xs text-stone-400 hover:border-brand-300 hover:text-brand-600">
          <AppIcon name="image" :size="20" />
          เพิ่มรูป
          <input type="file" accept="image/*" multiple class="hidden" @change="onImages" />
        </label>
      </div>
      <p v-if="imgError" class="mt-1 text-xs text-rose-700">{{ imgError }}</p>
      <div class="mt-4">
        <div class="label">หมายเหตุ</div>
        <textarea v-model="form.note" rows="2" class="input" placeholder="รายละเอียดเพิ่มเติม" />
      </div>
      <div v-if="customer" class="mt-4 space-y-2 rounded-xl border border-stone-200 bg-white p-3">
        <label class="flex items-center gap-2 text-sm text-stone-700"><input v-model="notifyCust" type="checkbox" class="h-4 w-4" aria-label="แจ้งลูกค้า" /> แจ้งลูกค้าว่ามีการแก้ไขรายการ</label>
        <SmsTick v-model="smsCust" :customer="customer" :order="order" :show="notifyCust" />
      </div>
    </div>
    </template>
    <template #center>
    <!-- ชั้นของเค้ก (สั่งทำ) -->
    <template v-if="tierGroups.length">
      <!-- เค้กปกติ / เค้กชั้น -->
      <div class="mb-3 grid grid-cols-2 gap-1 seg-grid">
        <button
          v-for="k in [{ v: false, t: 'เค้กปกติ' }, { v: true, t: 'เค้กชั้น' }]"
          :key="k.t"
          type="button"
          class="h-10 rounded-xl text-sm font-semibold transition"
          :class="layered === k.v ? 'bg-white text-brand-700 shadow-sm' : 'text-stone-500'"
          @click="setLayered(k.v)"
        >{{ k.t }}</button>
      </div>

      <template v-if="layered">
        <div v-for="(tier, i) in form.tiers" :key="i" class="mb-3 rounded-2xl border border-brand-200 bg-brand-50/40 p-3">
          <div class="mb-2.5 flex items-center justify-between gap-2">
            <span class="font-semibold text-brand-800">ชั้นที่ {{ i + 1 }}</span>
            <button v-if="form.tiers.length > 1" type="button" class="btn-danger h-8 px-2.5 text-sm" @click="removeTier(i)"><AppIcon name="trash" :size="14" /> ลบชั้น</button>
          </div>
          <OptionPicker compact v-model="tier.selections" :locked="lockedOf(tier)" :scopes="scopesFor(tier)" :bundles="form.kind === 'custom' ? db.bundles : []" :context="form.selections" :groups="tierGroups" :all-groups="groups" :errors="errors['t' + i] || {}" :active="active" :allow="allowFor(tier)" :size-ids="sizeIdsOf(tier)" :type-opt="typeOptOf(tier)" />
          <BundleHint scope="tier" :bundles="db.bundles" :groups="groups" :tier-sels="tier.selections" :whole-sels="form.selections" :size-ids="sizeIdsOf(tier)" :type-id="typeOptOf(tier)?.id || null" :style-id="styleIdOf(tier)" :allow="allowFor(tier)" />
        </div>
        <button type="button" class="btn-soft mb-3 w-full" @click="form.tiers.push({ selections: {} })"><AppIcon name="plus" :size="16" /> เพิ่มชั้น</button>
      </template>
      <div v-else class="mb-3">
        <OptionPicker compact v-model="form.tiers[0].selections" :locked="lockedOf(form.tiers[0])" :scopes="scopesFor(form.tiers[0])" :bundles="form.kind === 'custom' ? db.bundles : []" :context="form.selections" :groups="tierGroups" :all-groups="groups" :errors="errors.t0 || {}" :active="active" :allow="allowFor(form.tiers[0])" :size-ids="sizeIdsOf(form.tiers[0])" :type-opt="typeOptOf(form.tiers[0])" />
        <BundleHint scope="tier" :bundles="db.bundles" :groups="groups" :tier-sels="form.tiers[0].selections" :whole-sels="form.selections" :size-ids="sizeIdsOf(form.tiers[0])" :type-id="typeOptOf(form.tiers[0])?.id || null" :style-id="styleIdOf(form.tiers[0])" :allow="allowFor(form.tiers[0])" />
      </div>
    </template>

    </template>
    <template #right>
    <div v-if="form.kind === 'custom' && wholeGroups.length" class="mb-2 text-sm font-semibold text-stone-500">ตัวเลือกเพิ่มเติม</div>
    <OptionPicker compact v-model="form.selections" :scopes="scopesFor(form.tiers[0])" :bundles="form.kind === 'custom' ? db.bundles : []" :context="form.tiers[0]?.selections || {}" :groups="wholeGroups" :all-groups="groups" :errors="errors" :active="active" :allow="form.kind === 'custom' ? allowFor(form.tiers[0]) : null" :size-ids="allSizeIds" :type-opt="form.kind === 'custom' ? typeOptOf(form.tiers[0]) : readyTypeOpt" />
    <BundleHint v-if="form.kind === 'custom'" scope="whole" :bundles="db.bundles" :groups="groups" :tier-sels="form.tiers[0]?.selections || null" :whole-sels="form.selections" :size-ids="allSizeIds" :type-id="typeOptOf(form.tiers[0])?.id || null" :style-id="styleIdOf(form.tiers[0])" :allow="allowFor(form.tiers[0])" />

    <div v-if="healthText()" class="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3.5">
      <label class="flex items-start gap-2 text-sm text-amber-900">
        <input v-model="healthOk" type="checkbox" class="mt-0.5 h-4 w-4 shrink-0" />
        <span>ลูกค้ายินยอมโดยชัดแจ้งให้ร้านเก็บและใช้ข้อมูลแพ้อาหารนี้ เพื่อทำสินค้าเท่านั้น (ข้อมูลสุขภาพตาม PDPA) — ถามลูกค้าในแชทก่อนติ๊ก</span>
      </label>
      <p v-if="errors.health" class="mt-1.5 text-sm text-rose-700" role="alert">{{ errors.health }}</p>
    </div>

    </template>

    <template #footer>
      <div class="flex w-full flex-wrap items-center gap-3">
        <!-- จำนวน -->
        <div class="flex h-11 items-center rounded-xl border border-stone-200">
          <button type="button" class="h-full w-10 text-lg text-stone-600" aria-label="ลด" @click="step(-1)">−</button>
          <input v-model.number="form.qty" type="text" v-num min="1" class="h-full w-10 border-0 bg-transparent text-center text-base font-semibold outline-none" aria-label="จำนวน" />
          <button type="button" class="h-full w-10 text-lg text-stone-600" aria-label="เพิ่ม" @click="step(1)">+</button>
        </div>
        <div class="min-w-0 flex-1 text-right leading-tight">
          <div class="text-xs text-stone-500">{{ form.qty > 1 ? `${money(unitPrice)} × ${form.qty}` : 'ราคา' }}</div>
          <DiscountDetail :full="detail.fullPrice * (form.qty || 0)" :final="unitPrice * (form.qty || 0)" :lines="discountLines(detail.discounts, form.qty || 0)" size="lg" />
        </div>
        <button class="btn-primary w-full sm:w-auto" @click="save">
          <AppIcon name="check" :size="18" /> บันทึกสินค้า
        </button>
      </div>
      <p v-if="errors.qty || Object.keys(errors).length" class="w-full text-sm text-rose-700">กรอกข้อมูลที่จำเป็นให้ครบ</p>
    </template>
  </AppModal>
</template>
