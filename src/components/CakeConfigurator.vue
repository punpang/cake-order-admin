<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { db, activeListsAt } from '../data/store'
import { forcedOf, syncForced, priceDetail, allowedBy, forType, discountLines, groupOkFor } from '../lib/pricing'
import { MAIN_KEYS, typeFreeGroup } from '../lib/constants'
import { encodeCake } from '../lib/cakeCode'
import { money } from '../lib/format'
import OptionPicker from './OptionPicker.vue'
import BundleHint from './BundleHint.vue'
import DiscountDetail from './DiscountDetail.vue'
import StoreOrderButtons from './StoreOrderButtons.vue'
import AppIcon from './AppIcon.vue'

// ตัวคำนวณราคาเค้กสั่งทำบนหน้าเว็บลูกค้า · ใช้ตัวคิดราคา/กติกาตัวเลือกเดียวกับหลังบ้าน (priceDetail/allowedBy/forType)
// ประเภทถูกกำหนดจากหน้า (typeId) ลูกค้าเลือกส่วนที่เหลือ → คัดลอกรหัส+สรุปส่งแชท → หลังบ้านวางแล้วได้รายการเดียวกัน
const props = defineProps({ typeId: { type: String, default: '' }, preselect: { type: Array, default: () => [] } })
const emit = defineEmits(['select', 'status'])

const groups = computed(() => db.optionGroups.filter((g) => g.active !== false && g.appliesTo.includes('custom')))
const typeG = computed(() => groups.value.find((g) => g.key === 'type'))
const tierGroups = computed(() => groups.value.filter((g) => g.perTier))
const wholeGroups = computed(() => groups.value.filter((g) => !g.perTier))
const hasTiers = computed(() => tierGroups.value.length > 0)
// กลุ่มที่ให้เลือก (ประเภทถูกล็อกตามหน้า)
const showTier = computed(() => tierGroups.value.filter((g) => g.key !== 'type'))
const showWhole = computed(() => wholeGroups.value.filter((g) => g.key !== 'type'))

const form = reactive({ id: 'web', kind: 'custom', retailId: null, retailPrice: 0, sizeId: null, typeId: null, qty: 1, note: '', images: [], selections: {}, tiers: hasTiers.value ? [{ selections: {} }] : [] })
// ตัวเลือกทั้งหมดที่ลูกค้าเลือก (รวมประเภท) ส่งให้หน้าเว็บใช้เลือกรูปตัวอย่าง
const selectedIds = computed(() => {
  const ids = new Set(props.typeId ? [props.typeId] : [])
  const add = (sels) => { for (const g of groups.value) { if (g.type === 'text') continue; const v = sels?.[g.id]; if (v == null || v === '') continue; for (const id of Array.isArray(v) ? v : [v]) ids.add(id) } }
  add(form.selections)
  form.tiers.forEach((t) => add(t.selections))
  return [...ids]
})
watch(selectedIds, (v) => emit('select', v), { immediate: true })
function lockType() {
  const g = typeG.value
  if (!g || !props.typeId) return
  if (g.perTier) for (const t of form.tiers) t.selections[g.id] = props.typeId
  else form.selections[g.id] = props.typeId
}
lockType()
watch(() => props.typeId, (v, old) => { if (old) reset(); lockType() })
// เติมตัวเลือกจากรูปแบบที่เลือก (ไม่รวมประเภท) · ตัวที่ไม่ได้ระบุปล่อยว่างให้ลูกค้าเลือก
function applyPre(ids) {
  for (const id of ids || []) {
    const g = groups.value.find((x) => x.key !== 'type' && x.type !== 'text' && (x.options || []).some((o) => o.id === id))
    if (!g) continue
    const sels = g.perTier && form.tiers[0] ? form.tiers[0].selections : form.selections
    if (g.type === 'multi') sels[g.id] = [...new Set([...(Array.isArray(sels[g.id]) ? sels[g.id] : []), id])]
    else sels[g.id] = id
  }
}
applyPre(props.preselect)
watch(() => props.preselect, (v) => applyPre(v))
function reset() {
  Object.assign(form, { qty: 1, note: '', selections: {}, tiers: hasTiers.value ? [{ selections: {} }] : [] })
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
  const gok = groupOkFor(db.optionGroups, form, t)
  // o = null → ถามแค่ว่าหัวข้อนี้เลือกได้ไหม (ตามรูปแบบตกแต่ง)
  return (g, o) => gok(g) && (!o || (a(g, o) && (typeFreeGroup(g) || forType(o, tid))))
}
const allSizeIds = computed(() => (sizeGroup.value?.perTier ? form.tiers.flatMap((t) => sizeIdsOf(t)) : sizeIdsOf(null)))
// ตัวเลือกที่ไม่เข้ากับกติกา (เช่น ขนาดที่รูปแบบตกแต่งซ่อน): ซ่อนจากรายการ แต่คงค่าไว้ให้ลูกค้าเลือกใหม่ · หัวข้อที่ไม่เปิดให้เลือกเลยจะล้างค่า
const okOpt = (g, id, allow) => { const o = g.options.find((x) => x.id === id); return !o || allow(g, o) }
function prune(sels, allow, list) {
  for (const g of list) if (!allow(g, null)) delete sels[g.id] // หัวข้อที่รูปแบบตกแต่งไม่เปิดให้เลือก → ล้างค่า
}
// ค่าที่ใช้ได้จริง (ตัดตัวเลือกที่ไม่เข้ากันออก) ใช้คิดราคา
function validSels(sels, allow, list) {
  const out = { ...sels }
  for (const g of list) {
    const v = out[g.id]
    if (v == null || g.type === 'text') continue
    if (!allow(g, null)) { delete out[g.id]; continue }
    if (Array.isArray(v)) out[g.id] = v.filter((id) => okOpt(g, id, allow))
    else if (!okOpt(g, v, allow)) delete out[g.id]
  }
  return out
}
// id ของหัวข้อที่เลือกไว้แล้วแต่ไม่เข้ากับตัวเลือกอื่นในปัจจุบัน
function invalidOf(sels, allow, list) {
  const ids = []
  for (const g of list) {
    const v = sels?.[g.id]
    if (v == null || g.type === 'text' || !allow(g, null)) continue
    if ((Array.isArray(v) ? v : [v]).some((id) => !okOpt(g, id, allow))) ids.push(g.id)
  }
  return ids
}
watch(() => JSON.stringify([form.selections, form.tiers]), () => {
  if (form.tiers.length) form.tiers.forEach((t) => prune(t.selections, allowFor(t), tierGroups.value))
  prune(form.selections, allowFor(form.tiers[0]), wholeGroups.value)
  applyForced()
})

// รูปทรงบังคับตัวเลือก: เติมให้อัตโนมัติ + ล็อก (ต่อชั้น)
const forcedPrev = new WeakMap()
const lockedOf = (t) => (t ? forcedOf(db.optionGroups, t.selections, allowFor(t)) : null)
function applyForced() {
  for (const t of form.tiers) forcedPrev.set(t, syncForced(db.optionGroups, t.selections, forcedPrev.get(t), allowFor(t)))
}
// ---- ราคา ----
const active = computed(() => activeListsAt(''))
// ราคาคิดจากค่าที่ใช้ได้จริงเท่านั้น (ค่าที่ซ่อนอยู่ไม่ถูกนับ) · invalid = หัวข้อที่ต้องเลือกใหม่
const priceForm = computed(() => ({ ...form, selections: validSels(form.selections, allowFor(form.tiers[0]), wholeGroups.value), tiers: form.tiers.map((t) => ({ ...t, selections: validSels(t.selections, allowFor(t), tierGroups.value) })) }))
const invalidFor = (t) => invalidOf(t.selections, allowFor(t), tierGroups.value)
const invalidWhole = computed(() => invalidOf(form.selections, allowFor(form.tiers[0]), wholeGroups.value))
const invalid = computed(() => [...new Set([...form.tiers.flatMap((t) => invalidFor(t)), ...invalidWhole.value])].map((id) => groups.value.find((g) => g.id === id)?.name).filter(Boolean))
const detail = computed(() => priceDetail(priceForm.value, db.optionGroups, db.retailItems, active.value, db.bundles))
const qty = computed(() => Math.min(999, Math.max(1, Math.round(Number(form.qty) || 1))))
const empty = (v) => v == null || v === '' || (Array.isArray(v) && !v.length)
const missing = computed(() => {
  const out = []
  if (typeG.value?.required && !props.typeId) out.push(typeG.value.name)
  const aW = allowFor(form.tiers[0])
  for (const g of wholeGroups.value) if (g.required && g.key !== 'type' && aW(g, null) && empty(form.selections[g.id])) out.push(g.name)
  form.tiers.forEach((t) => { const aT = allowFor(t); for (const g of tierGroups.value) if (g.required && g.key !== 'type' && aT(g, null) && empty(t.selections[g.id])) out.push(g.name) })
  for (const n of invalid.value) if (!out.includes(n)) out.push(n) // เลือกไว้แต่ไม่เข้ากับรูปแบบ → ต้องเลือกใหม่
  return out
})
const ready = computed(() => !missing.value.length)
// จำนวนหัวข้อจำเป็นทั้งหมด (ตามที่ตั้งในหลังบ้าน) + ที่ยังขาด ส่งให้หน้าเว็บ
const requiredTotal = computed(() => groups.value.filter((g) => g.required && g.type !== 'text').length)
watch([missing, requiredTotal], () => emit('status', { missing: [...missing.value], total: requiredTotal.value }), { immediate: true })
const out = computed(() => (ready.value ? encodeCake({ ...form, qty: qty.value, unitPrice: detail.value.unitPrice }, db.optionGroups) : null))
const open = ref(true)
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
const styleIdOf = (t) => {
  const sg = groups.value.find((g) => g.key === 'style')
  return sg ? ([].concat((sg.perTier && t ? t.selections : form.selections)?.[sg.id] ?? [])[0] || null) : null
}
const scopesFor = (t) => ({ tier: { typeId: typeOptOf(t)?.id || null, styleId: styleIdOf(t), sizeIds: sizeIdsOf(t) }, whole: { typeId: typeOptOf(form.tiers[0])?.id || null, styleId: styleIdOf(form.tiers[0]), sizeIds: allSizeIds.value } })
</script>

<template>
  <section class="mt-6 space-y-3" aria-label="คำนวณราคาเค้กสั่งทำ">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <h2 class="text-xl text-stone-900">เลือกแบบ · ดูราคาเบื้องต้น</h2>
        <p v-show="open" class="text-sm text-stone-600">ราคาตรงกับระบบของร้าน กดคัดลอกแล้ววางส่งในแชทได้เลย</p>
        <p v-show="open" class="mt-0.5 text-sm font-medium text-stone-800">เค้กหลายชั้น สั่งโดยตรงกับร้านทางแชทเท่านั้น</p>
      </div>
      <button type="button" class="btn-soft h-11 shrink-0 px-3" :aria-expanded="open" aria-controls="cfg-body" aria-label="ซ่อน/แสดงส่วนเลือกแบบ" @click="open = !open">
        {{ open ? 'ซ่อน' : 'แสดง' }} <AppIcon name="next" :size="14" class="transition" :class="open ? 'rotate-90' : ''" />
      </button>
    </div>
    <div v-show="open" id="cfg-body" class="space-y-3">
      <slot name="types" />

    <template v-if="hasTiers">
      <div v-for="(tier, i) in form.tiers" :key="i">
        <OptionPicker v-model="tier.selections" :locked="lockedOf(tier)" :scopes="scopesFor(tier)" :bundles="db.bundles" :context="form.selections" :groups="showTier" :all-groups="groups" :active="active" :allow="allowFor(tier)" :size-ids="sizeIdsOf(tier)" :type-opt="typeOptOf(tier)" :invalid="invalidFor(tier)" />
        <BundleHint scope="tier" :bundles="db.bundles" :groups="groups" :tier-sels="tier.selections" :whole-sels="form.selections" :size-ids="sizeIdsOf(tier)" :type-id="typeOptOf(tier)?.id || null" :style-id="styleIdOf(tier)" :allow="allowFor(tier)" />
      </div>
    </template>

    <template v-if="showWhole.length">
      <div class="text-sm font-semibold text-stone-500">ตัวเลือกเพิ่มเติม</div>
      <OptionPicker v-model="form.selections" :scopes="scopesFor(form.tiers[0])" :bundles="db.bundles" :context="form.tiers[0]?.selections || {}" :groups="showWhole" :all-groups="groups" :active="active" :allow="allowFor(form.tiers[0])" :size-ids="allSizeIds" :type-opt="typeOptOf(form.tiers[0])" :invalid="invalidWhole" />
      <BundleHint scope="whole" :bundles="db.bundles" :groups="groups" :tier-sels="form.tiers[0]?.selections || null" :whole-sels="form.selections" :size-ids="allSizeIds" :type-id="typeOptOf(form.tiers[0])?.id || null" :style-id="styleIdOf(form.tiers[0])" :allow="allowFor(form.tiers[0])" />
    </template>

    <div class="rounded-3xl bg-white p-3.5 shadow-md">
      <label class="label" for="cfg-note">หมายเหตุถึงร้าน <span class="font-normal text-stone-500">(ไม่บังคับ)</span></label>
      <textarea id="cfg-note" v-model="form.note" rows="2" maxlength="300" class="input" placeholder="รายละเอียดเพิ่มเติม"></textarea>
    </div>

    <!-- ราคา + ส่ง -->
    <div class="sticky bottom-[calc(4rem+env(safe-area-inset-bottom)+0.5rem)] z-10 rounded-2xl bg-white p-2.5 shadow-xl ring-1 ring-stone-200/70 md:bottom-2">
      <div class="flex items-center gap-2">
        <div class="min-w-0 flex-1 text-left leading-tight" aria-live="polite">
          <div v-if="qty > 1" class="text-xs text-stone-500">{{ money(detail.unitPrice) }} × {{ qty }}</div>
          <DiscountDetail :full="detail.fullPrice * qty" :final="detail.unitPrice * qty" :lines="discountLines(detail.discounts, qty)" size="lg" align="left" />
        </div>
        <button type="button" class="btn-primary h-11 shrink-0 whitespace-nowrap px-3.5 text-sm" :disabled="!ready" @click="copy"><AppIcon :name="copied ? 'check' : 'send'" :size="16" /> {{ copied ? 'คัดลอกแล้ว' : 'คัดลอกส่งร้าน' }}</button>
      </div>
      <p v-if="!ready" class="mt-1.5 truncate text-xs text-stone-800">เลือกให้ครบ: {{ missing.join(', ') }}</p>
      <p v-else class="mt-1 text-center text-xs text-stone-500">ราคาเบื้องต้น ร้านจะยืนยันราคาสุดท้ายในใบเสนอ</p>
    </div>
    <div v-if="out" class="space-y-3 rounded-3xl bg-white p-4 shadow-md">
      <p v-if="copied" class="text-sm text-success-700">คัดลอกแล้ว วางในแชทได้เลย</p>
      <div v-if="showText">
        <label class="label" for="cfg-text">ข้อความที่คัดลอก</label>
        <textarea id="cfg-text" :value="out.text" readonly rows="5" class="input font-mono text-xs" @focus="$event.target.select()"></textarea>
      </div>
      <StoreOrderButtons />
    </div>
    </div>
  </section>
</template>
