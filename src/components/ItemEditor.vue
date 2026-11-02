<script setup>
import { askConfirm } from '../lib/confirm'
import { computed, reactive, ref, toRaw, watch } from 'vue'
import { db, activeListsAt } from '../data/store'
import { priceDetail, productPrice, productPounds, allowedBy, forType, discountLines } from '../lib/pricing'
import { money } from '../lib/format'
import { MAIN_KEYS } from '../lib/constants'
import AppModal from './AppModal.vue'
import AppIcon from './AppIcon.vue'
import OptionPicker from './OptionPicker.vue'
import DiscountDetail from './DiscountDetail.vue'

const props = defineProps({
  item: { type: Object, default: null },
  priceDate: { type: String, default: '' }, // วันที่ใช้เลือกราคาพิเศษ (วันที่สร้างออร์เดอร์) ว่าง = วันนี้
  defaults: { type: Object, default: null }, // ค่าเริ่มต้นของรายการใหม่ (เช่น ข้อความบนเค้กจากแชท) { [groupId]: value }
})
const emit = defineEmits(['save', 'close'])

const blank = () => ({ id: `i${Date.now()}`, kind: 'ready', productId: null, name: '', qty: 1, note: '', images: [], selections: { ...(props.defaults || {}) }, tiers: [] })
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
  if (form.kind === 'ready') {
    const p = db.products.find((x) => x.id === form.productId)
    return p?.sizeId ? [p.sizeId] : []
  }
  return sizeGroup.value?.perTier ? form.tiers.flatMap((t) => sizeIdsOf(t)) : sizeIdsOf(null)
})

// เค้กสำเร็จมีขนาดตายตัว ไม่แสดงกลุ่มขนาด
const groups = computed(() => db.optionGroups.filter((g) => g.active !== false && g.appliesTo.includes(form.kind) && !(form.kind === 'ready' && g.key === 'size')))
const tierGroups = computed(() => (form.kind === 'custom' ? groups.value.filter((g) => g.perTier) : []))
const wholeGroups = computed(() => groups.value.filter((g) => !tierGroups.value.includes(g)))

// เนื้อเค้ก/ขนาดที่ประเภทอนุญาต (ประเภทอยู่ในชั้นหรือทั้งก้อนก็ได้)
const typeGroup = computed(() => groups.value.find((g) => g.key === 'type'))
const typeSels = (t) => (typeGroup.value && tierGroups.value.includes(typeGroup.value) && t ? t.selections : form.selections)
// ตัวเลือกรองที่ประเภทของชั้นใช้ได้ (ตัวเลือกรองแปรผันตามประเภท)
const allowFor = (t) => {
  const a = allowedBy(db.optionGroups, typeSels(t))
  const tid = typeOptOf(t)?.id
  return (g, o) => a(g, o) && (MAIN_KEYS.includes(g.key) || forType(o, tid))
}
// เค้กสำเร็จ: ประเภทของสินค้า (ราคา/ตัวเลือกรองตามประเภท)
const readyTypeOpt = computed(() => {
  const p = db.products.find((x) => x.id === form.productId)
  return db.optionGroups.find((g) => g.key === 'type')?.options.find((o) => o.id === p?.typeId) || null
})
// เปลี่ยนประเภทแล้ว ตัดตัวเลือกที่ไม่มีออก
function prune(sels, allow, list) {
  for (const g of list) {
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
  },
)
const products = computed(() => db.products.filter((p) => p.active || p.id === form.productId))
const active = computed(() => activeListsAt(props.priceDate))
const detail = computed(() => priceDetail(form, db.optionGroups, db.products, active.value, db.bundles))
const unitPrice = computed(() => detail.value.unitPrice)
// ราคาเค้กสำเร็จ (ประเภท + เนื้อเค้ก + ขนาด) ราคาปกติแสดงขีดฆ่าเมื่อมีราคาพิเศษ
const priceOf = (p) => ({ price: productPrice(p, db.optionGroups, active.value), regular: productPrice(p, db.optionGroups) })

function setKind(k) {
  if (form.kind === k) return
  form.kind = k
  form.productId = null
  form.selections = { ...(props.defaults || {}) }
  form.tiers = k === 'custom' ? [{ selections: {} }] : []
  layered.value = false
  errors.value = {}
}

function onImages(e) {
  for (const f of e.target.files) form.images.push(URL.createObjectURL(f))
  e.target.value = ''
}

function save() {
  const err = {}
  if (form.kind === 'ready' && !form.productId) err.product = 'เลือกเค้ก'
  const empty = (v) => v == null || v === ''
  for (const g of wholeGroups.value) {
    if (g.required && empty(form.selections[g.id])) err[g.id] = `เลือก${g.name}`
  }
  form.tiers.forEach((t, i) => {
    const e = {}
    for (const g of tierGroups.value) if (g.required && empty(t.selections[g.id])) e[g.id] = `เลือก${g.name}`
    if (Object.keys(e).length) err[`t${i}`] = e
  })
  if (!(form.qty >= 1)) err.qty = 'จำนวนอย่างน้อย 1'
  errors.value = err
  if (Object.keys(err).length) return

  // ตัดตัวเลือกของอีกประเภทออก
  const allowed = new Set(wholeGroups.value.map((g) => g.id))
  for (const k of Object.keys(form.selections)) if (!allowed.has(k)) delete form.selections[k]
  const tierAllowed = new Set(tierGroups.value.map((g) => g.id))
  for (const t of form.tiers) for (const k of Object.keys(t.selections)) if (!tierAllowed.has(k)) delete t.selections[k]
  if (form.kind !== 'custom' || !tierGroups.value.length) form.tiers = []

  if (form.kind === 'ready') {
    form.name = db.products.find((p) => p.id === form.productId)?.name || ''
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
  emit('save', { ...JSON.parse(JSON.stringify(toRaw(form))), ...detail.value })
}

async function removeTier(i) {
  if (await askConfirm({ title: 'ลบชั้น', message: `ชั้นที่ ${i + 1}`, okText: 'ลบชั้น', danger: true })) form.tiers.splice(i, 1)
}

const step = (d) => { form.qty = Math.max(1, (Number(form.qty) || 1) + d) }
</script>

<template>
  <AppModal :title="item ? 'แก้ไขสินค้า' : 'เพิ่มสินค้า'" wide @close="emit('close')">
    <!-- ประเภท -->
    <div class="mb-4 grid grid-cols-2 gap-1 rounded-2xl bg-stone-100 p-1">
      <button
        v-for="k in [{ v: 'ready', t: 'เค้กสำเร็จ' }, { v: 'custom', t: 'สั่งทำ' }]"
        :key="k.v"
        type="button"
        class="h-10 rounded-xl text-sm font-semibold transition"
        :class="form.kind === k.v ? 'bg-white text-brand-700 shadow-sm' : 'text-stone-500'"
        @click="setKind(k.v)"
      >
        {{ k.t }}
      </button>
    </div>

    <!-- เค้กสำเร็จ -->
    <div v-if="form.kind === 'ready'" class="mb-3 rounded-2xl border bg-white p-3.5" :class="errors.product ? 'border-rose-300 ring-4 ring-rose-50' : 'border-stone-200/70'">
      <div class="mb-2.5 flex items-baseline gap-2">
        <span class="text-sm font-semibold text-stone-800">เลือกเค้ก</span>
        <span class="text-xs font-medium text-rose-500">จำเป็น</span>
      </div>
      <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <button
          v-for="p in products"
          :key="p.id"
          type="button"
          class="flex items-center gap-3 rounded-xl border p-3 text-left transition active:scale-[0.99]"
          :class="form.productId === p.id ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500' : 'border-stone-200 hover:border-brand-300'"
          @click="form.productId = p.id"
        >
          <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg" :class="form.productId === p.id ? 'bg-brand-600 text-white' : 'bg-brand-50 text-brand-600'">
            <AppIcon :name="form.productId === p.id ? 'check' : 'cake'" :size="20" />
          </span>
          <span class="min-w-0 flex-1">
            <span class="block truncate font-medium text-stone-900">{{ p.name }}</span>
            <span class="block text-xs text-stone-500">{{ productPounds(p, db.optionGroups) }} ปอนด์</span>
          </span>
          <span class="shrink-0 text-right leading-tight">
            <span v-if="priceOf(p).price !== priceOf(p).regular" class="block text-xs text-stone-400 line-through">{{ money(priceOf(p).regular) }}</span>
            <span class="block font-semibold" :class="priceOf(p).price !== priceOf(p).regular ? 'text-rose-600' : 'text-stone-900'">{{ money(priceOf(p).price) }}</span>
          </span>
        </button>
      </div>
      <p v-if="errors.product" class="mt-2 text-sm text-rose-600">{{ errors.product }}</p>
    </div>

    <!-- ชั้นของเค้ก (สั่งทำ) -->
    <template v-if="tierGroups.length">
      <!-- เค้กปกติ / เค้กชั้น -->
      <div class="mb-3 grid grid-cols-2 gap-1 rounded-2xl bg-stone-100 p-1">
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
          <OptionPicker v-model="tier.selections" :groups="tierGroups" :errors="errors['t' + i] || {}" :active="active" :allow="allowFor(tier)" :size-ids="sizeIdsOf(tier)" :type-opt="typeOptOf(tier)" />
        </div>
        <button type="button" class="btn-soft mb-3 w-full" @click="form.tiers.push({ selections: {} })"><AppIcon name="plus" :size="16" /> เพิ่มชั้น</button>
      </template>
      <div v-else class="mb-3">
        <OptionPicker v-model="form.tiers[0].selections" :groups="tierGroups" :errors="errors.t0 || {}" :active="active" :allow="allowFor(form.tiers[0])" :size-ids="sizeIdsOf(form.tiers[0])" :type-opt="typeOptOf(form.tiers[0])" />
      </div>
    </template>

    <div v-if="form.kind === 'custom' && wholeGroups.length" class="mb-2 text-sm font-semibold text-stone-500">ตัวเลือกเพิ่มเติม</div>
    <OptionPicker v-model="form.selections" :groups="wholeGroups" :errors="errors" :active="active" :allow="form.kind === 'custom' ? allowFor(form.tiers[0]) : null" :size-ids="allSizeIds" :type-opt="form.kind === 'custom' ? typeOptOf(form.tiers[0]) : readyTypeOpt" />

    <!-- รูป + หมายเหตุ -->
    <div class="mt-3 rounded-2xl border border-stone-200/70 bg-white p-3.5">
      <div class="mb-2.5 text-sm font-semibold text-stone-800">รูปตัวอย่าง</div>
      <div class="flex flex-wrap gap-2">
        <div v-for="(src, i) in form.images" :key="src" class="relative">
          <img :src="src" class="h-20 w-20 rounded-xl object-cover" />
          <button type="button" class="absolute -top-1.5 -right-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-stone-900 text-white shadow" aria-label="ลบรูป" @click="form.images.splice(i, 1)">
            <AppIcon name="x" :size="14" />
          </button>
        </div>
        <label class="flex h-20 w-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-stone-200 text-xs text-stone-400 hover:border-brand-300 hover:text-brand-600">
          <AppIcon name="image" :size="20" />
          เพิ่มรูป
          <input type="file" accept="image/*" multiple class="hidden" @change="onImages" />
        </label>
      </div>
      <div class="mt-4">
        <div class="label">หมายเหตุ</div>
        <textarea v-model="form.note" rows="2" class="input" placeholder="รายละเอียดเพิ่มเติม" />
      </div>
    </div>

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
      <p v-if="errors.qty || Object.keys(errors).length" class="w-full text-sm text-rose-600">กรอกข้อมูลที่จำเป็นให้ครบ</p>
    </template>
  </AppModal>
</template>
