<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { db, activeListsAt } from '../data/store'
import { priceDetail, allowedBy, forType, discountLines } from '../lib/pricing'
import { MAIN_KEYS } from '../lib/constants'
import { encodeCake } from '../lib/cakeCode'
import { money } from '../lib/format'
import OptionPicker from './OptionPicker.vue'
import DiscountDetail from './DiscountDetail.vue'
import StoreOrderButtons from './StoreOrderButtons.vue'
import AppIcon from './AppIcon.vue'

// ตัวคำนวณราคาเค้กสั่งทำบนหน้าเว็บลูกค้า · ใช้ตัวคิดราคา/กติกาตัวเลือกเดียวกับหลังบ้าน (priceDetail/allowedBy/forType)
// ประเภทถูกกำหนดจากหน้า (typeId) ลูกค้าเลือกส่วนที่เหลือ → คัดลอกรหัส+สรุปส่งแชท → หลังบ้านวางแล้วได้รายการเดียวกัน
const props = defineProps({ typeId: { type: String, required: true } })
const emit = defineEmits(['select'])

const groups = computed(() => db.optionGroups.filter((g) => g.active !== false && g.appliesTo.includes('custom')))
const typeG = computed(() => groups.value.find((g) => g.key === 'type'))
const tierGroups = computed(() => groups.value.filter((g) => g.perTier))
const wholeGroups = computed(() => groups.value.filter((g) => !g.perTier))
const hasTiers = computed(() => tierGroups.value.length > 0)
// กลุ่มที่ให้เลือก (ประเภทถูกล็อกตามหน้า)
const showTier = computed(() => tierGroups.value.filter((g) => g.key !== 'type'))
const showWhole = computed(() => wholeGroups.value.filter((g) => g.key !== 'type'))

const form = reactive({ id: 'web', kind: 'custom', retailId: null, retailPrice: 0, sizeId: null, typeId: null, qty: 1, note: '', images: [], selections: {}, tiers: hasTiers.value ? [{ selections: {} }] : [] })
const layered = ref(false)
// ตัวเลือกทั้งหมดที่ลูกค้าเลือก (รวมประเภท) ส่งให้หน้าเว็บใช้เลือกรูปตัวอย่าง
const selectedIds = computed(() => {
  const ids = new Set([props.typeId])
  const add = (sels) => { for (const g of groups.value) { if (g.type === 'text') continue; const v = sels?.[g.id]; if (v == null || v === '') continue; for (const id of Array.isArray(v) ? v : [v]) ids.add(id) } }
  add(form.selections)
  form.tiers.forEach((t) => add(t.selections))
  return [...ids]
})
watch(selectedIds, (v) => emit('select', v), { immediate: true })
function lockType() {
  const g = typeG.value
  if (!g) return
  if (g.perTier) for (const t of form.tiers) t.selections[g.id] = props.typeId
  else form.selections[g.id] = props.typeId
}
lockType()
watch(() => props.typeId, () => { reset(); lockType() })
function reset() {
  Object.assign(form, { qty: 1, note: '', selections: {}, tiers: hasTiers.value ? [{ selections: {} }] : [] })
  layered.value = false
}
function setLayered(v) {
  layered.value = v
  if (v && form.tiers.length < 2) form.tiers.push({ selections: {} })
  if (!v) form.tiers.splice(1)
  lockType()
}
function addTier() {
  if (form.tiers.length < 5) { form.tiers.push({ selections: {} }); lockType() }
}
function removeTier(i) {
  if (form.tiers.length > 1) form.tiers.splice(i, 1)
}

// ---- กติกาตัวเลือกตามประเภท/ขนาด (เหมือน ItemEditor) ----
const sizeGroup = computed(() => groups.value.find((g) => g.key === 'size'))
function sizeIdsOf(t) {
  const sg = sizeGroup.value
  if (!sg) return []
  const v = (sg.perTier && t ? t.selections : form.selections)[sg.id]
  return v == null ? [] : Array.isArray(v) ? v : [v]
}
const typeSels = (t) => (typeG.value && typeG.value.perTier && t ? t.selections : form.selections)
const typeOptOf = (t) => {
  const v = typeG.value ? typeSels(t)?.[typeG.value.id] : null
  const id = Array.isArray(v) ? v[0] : v
  return typeG.value?.options.find((o) => o.id === id) || null
}
const allowFor = (t) => {
  const a = allowedBy(db.optionGroups, typeSels(t))
  const tid = typeOptOf(t)?.id
  return (g, o) => a(g, o) && (MAIN_KEYS.includes(g.key) || forType(o, tid))
}
const allSizeIds = computed(() => (sizeGroup.value?.perTier ? form.tiers.flatMap((t) => sizeIdsOf(t)) : sizeIdsOf(null)))
function prune(sels, allow, list) {
  for (const g of list) {
    const v = sels[g.id]
    if (v == null || g.type === 'text') continue
    const ok = (id) => { const o = g.options.find((x) => x.id === id); return !o || allow(g, o) }
    if (Array.isArray(v)) sels[g.id] = v.filter(ok)
    else if (!ok(v)) delete sels[g.id]
  }
}
watch(() => JSON.stringify([form.selections, form.tiers]), () => {
  if (form.tiers.length) form.tiers.forEach((t) => prune(t.selections, allowFor(t), tierGroups.value))
  prune(form.selections, allowFor(form.tiers[0]), wholeGroups.value)
})

// ---- ราคา ----
const active = computed(() => activeListsAt(''))
const detail = computed(() => priceDetail(form, db.optionGroups, db.retailItems, active.value, db.bundles))
const qty = computed(() => Math.min(999, Math.max(1, Math.round(Number(form.qty) || 1))))
const step = (d) => { form.qty = Math.min(999, Math.max(1, (Number(form.qty) || 1) + d)) }
const empty = (v) => v == null || v === '' || (Array.isArray(v) && !v.length)
const missing = computed(() => {
  const out = []
  for (const g of wholeGroups.value) if (g.required && g.key !== 'type' && empty(form.selections[g.id])) out.push(g.name)
  form.tiers.forEach((t, i) => { for (const g of tierGroups.value) if (g.required && g.key !== 'type' && empty(t.selections[g.id])) out.push(form.tiers.length > 1 ? `ชั้น ${i + 1} · ${g.name}` : g.name) })
  return out
})
const ready = computed(() => !missing.value.length)
const out = computed(() => (ready.value ? encodeCake({ ...form, qty: qty.value, unitPrice: detail.value.unitPrice }, db.optionGroups) : null))
const copied = ref(false)
const showText = ref(false)
async function copy() {
  if (!out.value) return
  showText.value = true
  try {
    await navigator.clipboard.writeText(out.value.text)
    copied.value = true
    setTimeout(() => (copied.value = false), 2000)
  } catch {
    copied.value = false
  }
}
</script>

<template>
  <section class="mt-6 space-y-3" aria-label="คำนวณราคาเค้กสั่งทำ">
    <div>
      <h2 class="text-xl text-stone-900">เลือกแบบ · ดูราคาเบื้องต้น</h2>
      <p class="text-sm text-stone-600">ราคาตรงกับระบบของร้าน กดคัดลอกแล้ววางส่งในแชทได้เลย</p>
    </div>

    <div v-if="hasTiers" class="grid grid-cols-2 seg-grid">
      <button v-for="k in [{ v: false, t: 'เค้กปกติ' }, { v: true, t: 'เค้กชั้น' }]" :key="k.t" type="button" class="seg-item" :class="layered === k.v ? 'seg-on' : ''" @click="setLayered(k.v)">{{ k.t }}</button>
    </div>

    <template v-if="hasTiers">
      <div v-for="(tier, i) in form.tiers" :key="i" :class="layered ? 'rounded-3xl border-2 border-brand-200 bg-brand-50/50 p-3' : ''">
        <div v-if="layered" class="mb-2.5 flex items-center justify-between gap-2">
          <span class="font-semibold text-brand-800">ชั้นที่ {{ i + 1 }}</span>
          <button v-if="form.tiers.length > 1" type="button" class="btn-danger h-8 px-2.5 text-sm" @click="removeTier(i)"><AppIcon name="trash" :size="14" /> ลบชั้น</button>
        </div>
        <OptionPicker v-model="tier.selections" :groups="showTier" :active="active" :allow="allowFor(tier)" :size-ids="sizeIdsOf(tier)" :type-opt="typeOptOf(tier)" />
      </div>
      <button v-if="layered && form.tiers.length < 5" type="button" class="btn-soft w-full" @click="addTier"><AppIcon name="plus" :size="16" /> เพิ่มชั้น</button>
    </template>

    <template v-if="showWhole.length">
      <div class="text-sm font-semibold text-stone-500">ตัวเลือกเพิ่มเติม</div>
      <OptionPicker v-model="form.selections" :groups="showWhole" :active="active" :allow="allowFor(form.tiers[0])" :size-ids="allSizeIds" :type-opt="typeOptOf(form.tiers[0])" />
    </template>

    <div class="rounded-3xl bg-white p-3.5 shadow-md">
      <label class="label" for="cfg-note">หมายเหตุถึงร้าน <span class="font-normal text-stone-400">(ไม่บังคับ)</span></label>
      <textarea id="cfg-note" v-model="form.note" rows="2" maxlength="300" class="input" placeholder="รายละเอียดเพิ่มเติม"></textarea>
    </div>

    <!-- ราคา + ส่ง -->
    <div class="sticky bottom-3 z-10 space-y-3 rounded-3xl bg-white p-4 shadow-xl ring-1 ring-stone-200/70">
      <div class="flex items-center justify-between gap-3">
        <div class="flex h-11 items-center rounded-xl border border-stone-200">
          <button type="button" class="h-full w-10 text-lg text-stone-600" aria-label="ลดจำนวน" @click="step(-1)">−</button>
          <input v-model.number="form.qty" type="text" inputmode="numeric" class="h-full w-12 border-0 bg-transparent text-center text-base font-semibold outline-none" aria-label="จำนวน" />
          <button type="button" class="h-full w-10 text-lg text-stone-600" aria-label="เพิ่มจำนวน" @click="step(1)">+</button>
        </div>
        <div class="min-w-0 flex-1 text-right leading-tight" aria-live="polite">
          <div class="text-xs text-stone-500">{{ qty > 1 ? `${money(detail.unitPrice)} × ${qty}` : 'ราคา' }}</div>
          <DiscountDetail :full="detail.fullPrice * qty" :final="detail.unitPrice * qty" :lines="discountLines(detail.discounts, qty)" size="lg" />
        </div>
      </div>
      <p v-if="!ready" class="text-sm text-stone-800">เลือกให้ครบก่อนคัดลอก: {{ missing.join(', ') }}</p>
      <p class="text-xs text-stone-400">ราคาเบื้องต้น ร้านจะยืนยันราคาสุดท้ายในใบเสนอ</p>
      <button type="button" class="btn-primary w-full" :disabled="!ready" @click="copy"><AppIcon :name="copied ? 'check' : 'send'" :size="18" /> {{ copied ? 'คัดลอกแล้ว วางในแชทได้เลย' : 'คัดลอกส่งร้าน' }}</button>
      <div v-if="out && showText">
        <label class="label" for="cfg-text">ข้อความที่คัดลอก</label>
        <textarea id="cfg-text" :value="out.text" readonly rows="5" class="input font-mono text-xs" @focus="$event.target.select()"></textarea>
      </div>
      <StoreOrderButtons v-if="out" />
    </div>
  </section>
</template>
