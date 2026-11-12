<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { db, saveBundle } from '../../data/store'
import { confirmDeactivate } from '../../lib/confirm'
import { showToast } from '../../lib/toast'
import { qty } from '../../lib/format'
import { MAIN_KEYS } from '../../lib/constants'
import { autoBundleName, bahtText, checkBundle, effectiveDiscount, findItemOption, makeDraft, percentOf, regularTotal } from '../../lib/bundleEditor'
import { recommendPrice, subSuggestions } from '../../lib/bundleAdvice'
import ManageShell from '../../components/ManageShell.vue'
import AppIcon from '../../components/AppIcon.vue'
import AppSwitch from '../../components/AppSwitch.vue'

// หน้าแก้ไขบันเดิ้ล: 4 ขั้น (เลือกตัวเลือก → ตั้งชื่อ → เลือกประเภท → ตั้งส่วนลด) เห็นราคาปกติและราคาที่เหลือทันที
const props = defineProps({ id: { type: String, required: true } })
const route = useRoute()
const router = useRouter()
const LIST = '/admin/settings/bundles'
const EPS = 1e-9

const isNew = computed(() => props.id === 'new')
const found = computed(() => isNew.value || db.bundles.some((b) => b.id === props.id))
const typesAll = computed(() => db.optionGroups.find((x) => x.key === 'type')?.options || [])
const activeTypes = computed(() => typesAll.value.filter((t) => t.active !== false))
const sizes = computed(() => (db.optionGroups.find((x) => x.key === 'size')?.options || []).filter((x) => x.active !== false))
const styles = computed(() => (db.optionGroups.find((x) => x.key === 'style')?.options || []).filter((x) => x.active !== false))
const itemGroups = computed(() => db.optionGroups.filter((g) => !MAIN_KEYS.includes(g.key) && g.type !== 'text' && g.active !== false))

// ---------- ร่างฟอร์ม ----------
const draft = reactive(makeDraft(null, [], []))
const scope = ref('all') // 'all' = ทุกประเภท · อย่างอื่น = id ของประเภทนั้น
const itemQ = ref('')
const fillAmount = ref('')
const fillPct = ref('')

// โหลดชุดที่จะแก้ (หรือชุดต้นแบบตอนทำสำเนา ?from=id)
function load() {
  const src = isNew.value
    ? (route.query.from ? db.bundles.find((b) => b.id === route.query.from) : null)
    : db.bundles.find((b) => b.id === props.id)
  const d = makeDraft(src, styles.value, typesAll.value)
  if (isNew.value && src) Object.assign(d, { id: null, name: `${src.name} (สำเนา)`, active: true })
  Object.assign(draft, d)
  scope.value = 'all'
  fillAmount.value = ''
  fillPct.value = ''
}
watch(() => [props.id, route.query.from], load, { immediate: true })

const autoName = computed(() => autoBundleName(draft.items, db.optionGroups))
const finalName = computed(() => draft.name.trim() || autoName.value)
const hasItems = computed(() => draft.items.length > 0)
const selectedText = computed(() => draft.items.map((x) => findItemOption(db.optionGroups, x)?.name || 'ตัวเลือกที่ถูกลบแล้ว').join(' + '))
// ชุดที่บันทึกไว้ (ไว้เช็กว่าแก้ตัวเลือกจนซ้ำกับชุดอื่นหรือไม่) · ชุดใหม่ = ไม่มี
const original = computed(() => (isNew.value ? null : db.bundles.find((b) => b.id === props.id) || null))
const check = computed(() => checkBundle(draft, { groups: db.optionGroups, sizes: sizes.value, types: typesAll.value, styles: styles.value, bundles: db.bundles, original: original.value }))
const blocked = computed(() => check.value.errors.length > 0)

// ---------- บันเดิ้ลทางเลือก และราคาที่แนะนำ ----------
const activeTypeIds = computed(() => activeTypes.value.map((t) => t.id))
const hasTypeOverride = computed(() => Object.values(draft.typeDiscount || {}).some((m) => Object.values(m || {}).some((v) => v !== '' && v != null)))
const advice = computed(() => (draft.items.length >= 2 ? recommendPrice(draft.items, { groups: db.optionGroups, sizes: sizes.value, bundles: db.bundles, types: draft.types, allTypeIds: activeTypeIds.value, selfId: draft.id }) : null))
const subs = computed(() => (draft.items.length >= 3 ? subSuggestions(draft.items, { groups: db.optionGroups, sizes: sizes.value, bundles: db.bundles, types: draft.types, allTypeIds: activeTypeIds.value }) : []))
// สร้างได้เฉพาะชุดที่มีส่วนลดสมดุลแล้ว · ชุดขัดแย้งหรือไม่มีส่วนลดต้องแก้ชุดเดิมหรือราคาตัวเลือกก่อน
const creatable = (s) => !s.existing && s.rec.pct > 0 && s.rec.status !== 'conflict' && s.rec.status !== 'noprice'
const newSubs = computed(() => subs.value.filter((s) => creatable(s)))
// ใส่ราคาที่แนะนำลงช่องส่วนลดทุกขนาดของ "ทุกประเภท" · ยังไม่บันทึกจนกว่าจะกดบันทึก
function applyAdvice() {
  if (!advice.value) return
  scope.value = 'all'
  for (const sz of sizes.value) draft.discount[sz.id] = String(advice.value.amounts[sz.id] ?? 0)
  showToast(`ใส่ราคาแนะนำ ลด ${advice.value.pct}% แล้ว · กดบันทึกเมื่อพอใจ`)
}
// ข้อมูลชุดใหม่จากบันเดิ้ลทางเลือก: ชื่ออัตโนมัติ ประเภทเดียวกับที่เลือกอยู่ และราคาที่แนะนำ
function suggestionData(s) {
  const d = makeDraft(null, styles.value, typesAll.value)
  d.name = s.name
  d.items = s.items.map((x) => ({ groupId: x.groupId, optionId: x.optionId }))
  d.types = [...draft.types]
  for (const sz of sizes.value) d.discount[sz.id] = String(s.rec.amounts[sz.id] ?? 0)
  return JSON.parse(JSON.stringify(d))
}
// บันทึกชุดใหม่ด้วยกติกาเดียวกับหน้าแก้ไข (รวมการกันชุดซ้ำ) · คืนข้อความผิดพลาดถ้าบันทึกไม่ได้
function saveNewBundle(d) {
  const r = checkBundle(d, { groups: db.optionGroups, sizes: sizes.value, types: typesAll.value, styles: styles.value, bundles: db.bundles, original: null })
  if (r.errors.length) return r.errors[0]
  saveBundle(d)
  return ''
}
function createSuggestion(s) {
  if (!creatable(s)) return
  const err = saveNewBundle(suggestionData(s))
  if (err) showToast(err, 8000, 'error')
  else showToast(`สร้าง "${s.name}" แล้ว · ลด ${s.rec.pct}%`)
}
function createAllNew() {
  let made = 0
  let failed = ''
  for (const s of newSubs.value) {
    const err = saveNewBundle(suggestionData(s))
    if (err) failed = err
    else made++
  }
  if (failed) showToast(`สร้างได้ ${made} ชุด · ${failed}`, 8000, 'error')
  else showToast(`สร้าง ${made} ชุดแล้ว`)
}

// ---------- 1 ตัวเลือก ----------
const picked = (g, o) => draft.items.some((x) => x.groupId === g.id && x.optionId === o.id)
function toggleItem(g, o) {
  const i = draft.items.findIndex((x) => x.groupId === g.id && x.optionId === o.id)
  if (i >= 0) draft.items.splice(i, 1)
  else draft.items.push({ groupId: g.id, optionId: o.id })
}
// ตัวเลือกที่ปิดอยู่แสดงเฉพาะที่ถูกเลือกไว้แล้ว (จะได้เอาออกได้)
const visibleGroups = computed(() => {
  const s = itemQ.value.trim().toLowerCase()
  return itemGroups.value
    .map((g) => ({
      g,
      shown: (g.options || []).filter((o) => (o.active !== false || picked(g, o)) && (!s || o.name.toLowerCase().includes(s) || g.name.toLowerCase().includes(s))),
    }))
    .filter((x) => x.shown.length)
})

// ---------- 3 ประเภท ----------
const typeOpts = computed(() => typesAll.value.filter((t) => t.active !== false || draft.types.includes(t.id)))
const typeNames = (ids) => ids.map((id) => typesAll.value.find((t) => t.id === id)?.name).filter(Boolean).join(', ')
function toggleType(id) {
  const i = draft.types.indexOf(id)
  if (i >= 0) draft.types.splice(i, 1)
  else draft.types.push(id)
}

// ---------- 4 ส่วนลด ----------
// แท็บ: ทุกประเภท + ประเภทที่ชุดนี้ใช้ได้ (ถ้าไม่จำกัดประเภท = ทุกประเภทที่เปิดใช้งาน)
const scopeTypes = computed(() => (draft.types.length ? typesAll.value.filter((t) => draft.types.includes(t.id)) : activeTypes.value))
const scopes = computed(() => [{ key: 'all', label: 'ทุกประเภท' }, ...scopeTypes.value.map((t) => ({ key: t.id, label: t.name }))])
watch(
  () => scopes.value.map((s) => s.key).join('|'),
  () => {
    if (!scopes.value.some((s) => s.key === scope.value)) scope.value = 'all'
  },
)
const tKey = computed(() => (scope.value === 'all' ? null : scope.value))
// ช่องส่วนลดของแท็บที่เลือก (ทุกประเภท = ส่วนลดกลาง · ประเภท = ส่วนลดแยกของประเภทนั้น)
const cells = computed(() => (scope.value === 'all' ? draft.discount : draft.typeDiscount[scope.value]))
const scopeFilled = (key) => {
  const m = key === 'all' ? draft.discount : draft.typeDiscount[key]
  return sizes.value.some((sz) => String(m?.[sz.id] ?? '') !== '')
}
const scopeHint = computed(() => {
  if (scope.value === 'all') {
    return draft.types.length
      ? `ค่าทุกประเภทใช้กับ ${typeNames(draft.types)} ยกเว้นประเภทที่ตั้งแยกไว้`
      : 'ค่าทุกประเภทใช้กับทุกประเภท ยกเว้นประเภทที่ตั้งแยกไว้'
  }
  const name = typesAll.value.find((t) => t.id === scope.value)?.name || ''
  return `${name}: ช่องที่ว่างใช้ค่าของ "ทุกประเภท" · กรอก 0 = ไม่ลดในประเภทนี้`
})
const rows = computed(() =>
  sizes.value.map((sz) => {
    const reg = hasItems.value ? regularTotal(draft.items, db.optionGroups, tKey.value, sz.id) : 0
    const eff = effectiveDiscount(draft, tKey.value, sz.id)
    return {
      id: sz.id,
      name: sz.name,
      reg,
      left: Math.max(0, reg - eff),
      over: hasItems.value && eff > reg + EPS,
      placeholder: scope.value === 'all' ? '0' : String(Number(draft.discount[sz.id]) || 0),
    }
  }),
)
function fillAll() {
  if (fillAmount.value === '') return
  for (const sz of sizes.value) cells.value[sz.id] = fillAmount.value
}
function fillPercent() {
  for (const r of rows.value) cells.value[r.id] = String(percentOf(r.reg, fillPct.value))
}
function clearScope() {
  for (const sz of sizes.value) delete cells.value[sz.id]
}

// ---------- 5 รูปแบบตกแต่ง (ไม่บังคับ) ----------
const hasOwnStyle = computed(() => styles.value.some((st) => draft.styleMode[st.id] === 'own'))

// ---------- บันทึก ----------
function cancel() {
  router.push(LIST)
}
async function save() {
  if (blocked.value) {
    document.getElementById('bd-checks')?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    return
  }
  const data = JSON.parse(JSON.stringify({ ...draft, name: finalName.value }))
  if (!(await confirmDeactivate(db.bundles, data, data.name))) return
  saveBundle(data)
  showToast(`บันทึก "${data.name}" แล้ว`)
  router.push(LIST)
}
</script>

<template>
  <ManageShell
    v-if="found"
    narrow
    guard
    :toolbar="false"
    :title="isNew ? 'บันเดิ้ลใหม่' : 'แก้ไขบันเดิ้ล'"
    :subtitle="finalName"
    :back="LIST"
  >
    <div class="space-y-4">
      <!-- 1 ตัวเลือก -->
      <section class="card" aria-labelledby="bd-items">
        <div class="mb-3 flex items-start gap-3">
          <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-semibold text-white">1</span>
          <div class="min-w-0">
            <h2 id="bd-items" class="font-semibold text-stone-900">เลือกตัวเลือกที่ลูกค้าต้องเลือกครบ</h2>
            <p class="text-sm text-stone-500">เลือกจากกลุ่มเดียวกันหรือต่างกันก็ได้ · ลูกค้าต้องเลือกครบทุกตัวจึงจะได้ส่วนลด</p>
          </div>
        </div>
        <label class="relative mb-3 block">
          <span class="sr-only">ค้นหาตัวเลือก</span>
          <AppIcon name="search" class="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-stone-400" />
          <input v-model="itemQ" type="search" class="input bg-white pl-10" placeholder="ค้นหาตัวเลือก" />
        </label>
        <p v-if="!itemGroups.length" class="text-sm text-stone-500">ยังไม่มีกลุ่มตัวเลือกที่ใช้ได้ · ตั้งกลุ่มที่หน้า ตัวเลือก + ราคา</p>
        <div v-else-if="!visibleGroups.length" class="text-sm text-stone-500">ไม่พบตัวเลือกที่ตรงกับคำค้น</div>
        <div v-else class="space-y-3">
          <div v-for="{ g, shown } in visibleGroups" :key="g.id">
            <div class="mb-1.5 text-xs font-semibold text-stone-500">{{ g.name }}</div>
            <div class="flex flex-wrap gap-2">
              <button
                v-for="o in shown"
                :key="o.id"
                type="button"
                class="chip"
                :class="picked(g, o) ? 'chip-on' : 'chip-off'"
                :aria-pressed="picked(g, o)"
                :data-bundle-item="`${g.id}:${o.id}`"
                @click="toggleItem(g, o)"
              >{{ o.name }}<span v-if="o.active === false" class="text-xs opacity-75">(ปิดอยู่)</span></button>
            </div>
          </div>
        </div>
        <p class="mt-3 rounded-xl bg-stone-50 p-3 text-sm" :class="hasItems ? 'text-stone-800' : 'text-stone-500'" data-bundle-selected>
          {{ hasItems ? `เลือกแล้ว ${draft.items.length} อย่าง: ${selectedText}` : 'ยังไม่ได้เลือกตัวเลือก' }}
        </p>
      </section>

      <!-- บันเดิ้ลทางเลือกจากตัวเลือกที่เลือก (เลือกตั้งแต่ 3 อย่างขึ้นไป) -->
      <section v-if="subs.length" class="card" aria-labelledby="bd-subs" data-sub-section>
        <div class="mb-3 flex items-start gap-3">
          <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-500 text-sm font-semibold text-white">+</span>
          <div class="min-w-0">
            <h2 id="bd-subs" class="font-semibold text-stone-900">บันเดิ้ลทางเลือกที่เป็นไปได้ ({{ subs.length }} ชุด)</h2>
            <p class="text-sm text-stone-500">แยกจากตัวเลือกที่เลือกทุกคู่ · ราคาแนะนำลดแบบเดียวกันทุกขนาด · ชุดที่มีอยู่แล้วไม่สร้างซ้ำ</p>
          </div>
        </div>
        <ul class="space-y-2">
          <li
            v-for="(s, i) in subs"
            :key="i"
            class="rounded-xl border p-3"
            :class="s.existing ? 'border-stone-200 bg-stone-50' : creatable(s) ? 'border-emerald-200 bg-emerald-50/50' : 'border-rose-200 bg-rose-50/40'"
            data-sub-item
          >
            <div class="flex flex-wrap items-start gap-2">
              <div class="min-w-0 flex-1">
                <div class="font-semibold break-words text-stone-900">{{ s.name }}</div>
                <div class="text-sm text-stone-700">
                  แนะนำ <b>ลด {{ s.rec.pct }}%</b> ทุกขนาด
                  <span v-if="s.rec.sample" class="text-stone-500">· {{ s.rec.sample.size }} {{ bahtText(s.rec.sample.regular) }} → เหลือ {{ bahtText(s.rec.sample.net) }}</span>
                </div>
                <div v-if="s.existing" class="mt-0.5 text-xs text-stone-600" data-sub-status>
                  มีอยู่แล้ว{{ s.existing.active === false ? ' (ปิดอยู่)' : '' }} · {{ s.current ? `ตอนนี้ลดสูงสุด ${s.current}%` : 'ตอนนี้ยังไม่ลด' }}
                </div>
                <div v-else-if="creatable(s)" class="mt-0.5 text-xs text-emerald-800">ยังไม่มีชุดนี้ · สร้างได้</div>
                <div v-else class="mt-0.5 text-xs text-rose-700" data-sub-blocked>ยังไม่มีชุดนี้ · สร้างไม่ได้ตอนนี้ ({{ s.rec.conflicts.length ? 'ดูข้อขัดแย้งด้านล่าง' : 'ยังไม่มีส่วนลดที่สมดุล' }})</div>
              </div>
              <RouterLink v-if="s.existing" :to="`/admin/settings/bundles/${s.existing.id}`" class="btn-outline h-9 shrink-0 px-3 text-sm" data-sub-edit>แก้ชุดเดิม</RouterLink>
              <button v-else-if="creatable(s)" type="button" class="btn-primary h-9 shrink-0 px-3 text-sm" data-sub-create @click="createSuggestion(s)">สร้างชุดนี้</button>
            </div>
            <p v-for="(c, j) in s.rec.conflicts" :key="`c${j}`" class="mt-2 rounded-lg bg-rose-50 p-2 text-xs text-rose-800">{{ c }}</p>
            <p v-for="(w, j) in s.rec.warnings" :key="`w${j}`" class="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">{{ w }}</p>
            <details v-if="s.rec.reasons.length" class="mt-2">
              <summary class="cursor-pointer text-xs text-stone-500">เหตุผลของราคานี้</summary>
              <ul class="mt-1 list-disc space-y-0.5 pl-5 text-xs text-stone-600">
                <li v-for="(r, j) in s.rec.reasons" :key="j">{{ r }}</li>
              </ul>
            </details>
          </li>
        </ul>
        <button v-if="newSubs.length >= 2" type="button" class="btn-soft mt-3 h-10 w-full" data-sub-create-all @click="createAllNew">สร้างชุดที่ยังไม่มีทั้งหมด ({{ newSubs.length }} ชุด)</button>
      </section>

      <!-- 2 ชื่อ -->
      <section class="card" aria-labelledby="bd-name">
        <div class="mb-3 flex items-start gap-3">
          <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-semibold text-white">2</span>
          <div class="min-w-0">
            <h2 id="bd-name" class="font-semibold text-stone-900">ชื่อชุด</h2>
            <p class="text-sm text-stone-500">เว้นว่างได้ ระบบจะใช้ชื่อจากตัวเลือกให้</p>
          </div>
        </div>
        <input v-model="draft.name" type="text" maxlength="120" class="input" :placeholder="autoName || 'เช่น สตรอว์เบอร์รี + บลูเบอร์รี'" data-bundle-name />
        <p class="mt-1.5 text-xs text-stone-500">ลูกค้าจะเห็นว่า: {{ finalName || '—' }}</p>
      </section>

      <!-- 3 ประเภท -->
      <section class="card" aria-labelledby="bd-types">
        <div class="mb-3 flex items-start gap-3">
          <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-semibold text-white">3</span>
          <div class="min-w-0">
            <h2 id="bd-types" class="font-semibold text-stone-900">ใช้กับประเภทเค้กไหน</h2>
            <p class="text-sm text-stone-500">ไม่เลือกอะไร = ใช้ได้ทุกประเภท</p>
          </div>
        </div>
        <div class="flex flex-wrap gap-2" role="group" aria-label="ประเภทที่ใช้ได้">
          <button type="button" class="chip" :class="draft.types.length ? 'chip-off' : 'chip-on'" :aria-pressed="!draft.types.length" data-type-all @click="draft.types = []">ทุกประเภท</button>
          <button
            v-for="t in typeOpts"
            :key="t.id"
            type="button"
            class="chip"
            :class="draft.types.includes(t.id) ? 'chip-on' : 'chip-off'"
            :aria-pressed="draft.types.includes(t.id)"
            :data-type="t.id"
            @click="toggleType(t.id)"
          >{{ t.name }}<span v-if="t.active === false" class="text-xs opacity-75">(ปิดอยู่)</span></button>
        </div>
        <p class="mt-2 text-xs text-stone-500">{{ draft.types.length ? `ใช้ได้เฉพาะ ${typeNames(draft.types)}` : 'ใช้ได้ทุกประเภทที่เปิดใช้งาน' }}</p>
      </section>

      <!-- 4 ส่วนลด -->
      <section class="card" aria-labelledby="bd-disc">
        <div class="mb-3 flex items-start gap-3">
          <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-semibold text-white">4</span>
          <div class="min-w-0">
            <h2 id="bd-disc" class="font-semibold text-stone-900">ตั้งส่วนลดแต่ละขนาด</h2>
            <p class="text-sm text-stone-500">ส่วนลดคิดจากราคาปกติรวมของตัวเลือกที่เลือกครบ · "เหลือ" คือราคาที่ลูกค้าจ่าย</p>
          </div>
        </div>

        <!-- ราคาที่แนะนำ: วิเคราะห์จากบันเดิ้ลอื่นและราคาตัวเลือก พร้อมเหตุผล -->
        <div v-if="advice" class="mb-4 rounded-2xl border p-3" :class="advice.status === 'conflict' ? 'border-rose-200 bg-rose-50/50' : 'border-emerald-200 bg-emerald-50/50'" data-price-advice>
          <div class="flex flex-wrap items-center gap-2">
            <div class="min-w-0 flex-1">
              <div class="text-xs text-stone-500">ราคาที่แนะนำ · ลดน้อยที่สุดที่ยังจูงใจ</div>
              <div class="font-semibold text-stone-900" data-advice-pct>ลด {{ advice.pct }}% ทุกขนาด</div>
              <div v-if="advice.sample" class="text-xs text-stone-600">{{ advice.sample.size }} {{ bahtText(advice.sample.regular) }} → เหลือ {{ bahtText(advice.sample.net) }}</div>
            </div>
            <button type="button" class="btn-primary h-10 shrink-0 px-4" data-apply-advice @click="applyAdvice">ใช้ราคาที่แนะนำ</button>
          </div>
          <ul class="mt-2 list-disc space-y-0.5 pl-5 text-xs text-stone-600" data-advice-reasons>
            <li v-for="(r, i) in advice.reasons" :key="`r${i}`">{{ r }}</li>
          </ul>
          <p v-for="(c, i) in advice.conflicts" :key="`c${i}`" class="mt-2 rounded-lg bg-rose-50 p-2 text-xs text-rose-800">{{ c }}</p>
          <p v-for="(w, i) in advice.warnings" :key="`w${i}`" class="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">{{ w }}</p>
          <p v-if="hasTypeOverride" class="mt-2 text-xs text-stone-500">มีราคาแยกประเภทที่ตั้งไว้ ค่าเหล่านั้นยังใช้อยู่ · ใส่ราคาแนะนำจะเปลี่ยนเฉพาะ "ทุกประเภท"</p>
        </div>
        <div class="flex flex-wrap gap-2" role="group" aria-label="เลือกประเภทที่จะตั้งส่วนลด">
          <button
            v-for="s in scopes"
            :key="s.key"
            type="button"
            class="chip"
            :class="scope === s.key ? 'chip-on' : 'chip-off'"
            :aria-pressed="scope === s.key"
            :data-scope="s.key"
            @click="scope = s.key"
          >{{ s.label }}<span v-if="scopeFilled(s.key)" class="text-xs" aria-hidden="true">●</span></button>
        </div>
        <p class="mt-2 text-xs text-stone-500" data-scope-hint>{{ scopeHint }}</p>

        <div class="mt-4 grid gap-2 sm:grid-cols-2">
          <div class="flex items-center gap-2">
            <input v-model="fillAmount" type="text" v-num.dec class="input h-10 min-w-0 flex-1" placeholder="ลดเท่ากันทุกขนาด (บาท)" aria-label="ลดเท่ากันทุกขนาด (บาท)" data-fill-input />
            <button type="button" class="btn-soft h-10 shrink-0 px-3 disabled:opacity-40" :disabled="fillAmount === ''" data-fill-amount @click="fillAll">ใช้ทุกขนาด</button>
          </div>
          <div class="flex items-center gap-2">
            <input v-model="fillPct" type="text" v-num.dec class="input h-10 min-w-0 flex-1" placeholder="ลดกี่ % ของราคาปกติ" aria-label="ลดกี่เปอร์เซ็นต์ของราคาปกติ" />
            <button type="button" class="btn-soft h-10 shrink-0 px-3 disabled:opacity-40" :disabled="!hasItems || !(Number(fillPct) > 0)" data-fill-percent @click="fillPercent">คิดจากราคาปกติ</button>
          </div>
        </div>
        <div class="mt-2 text-right">
          <button type="button" class="text-sm text-stone-500 underline underline-offset-2 hover:text-stone-800 disabled:opacity-40" :disabled="!scopeFilled(scope)" data-clear-scope @click="clearScope">ล้างส่วนลดของแท็บนี้</button>
        </div>

        <div class="mt-3" data-discount-table>
          <div class="grid grid-cols-[4.25rem_minmax(0,1fr)_minmax(0,1.15fr)_minmax(0,1fr)] items-center gap-2 px-1 text-xs font-medium text-stone-500 sm:grid-cols-[7rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
            <span>ขนาด</span>
            <span class="text-right">ราคาปกติ</span>
            <span class="text-right">ลด (บาท)</span>
            <span class="text-right">เหลือ (บาท)</span>
          </div>
          <ul class="mt-1.5 space-y-1.5">
            <li
              v-for="r in rows"
              :key="r.id"
              class="rounded-xl border p-2"
              :class="r.over ? 'border-rose-300 bg-rose-50/60' : 'border-stone-200'"
              :data-size-row="r.id"
            >
              <div class="grid grid-cols-[4.25rem_minmax(0,1fr)_minmax(0,1.15fr)_minmax(0,1fr)] items-center gap-2 sm:grid-cols-[7rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
                <span class="truncate text-sm font-semibold text-stone-900">{{ r.name }}</span>
                <span class="text-right text-sm text-stone-600" data-reg>{{ hasItems ? qty(r.reg) : '—' }}</span>
                <input
                  v-model="cells[r.id]"
                  type="text"
                  v-num.dec
                  class="input h-10 max-w-[9rem] justify-self-end px-2 text-right"
                  :placeholder="r.placeholder"
                  :aria-label="`ส่วนลด ${r.name} (บาท)`"
                  :aria-invalid="r.over"
                  :data-disc="`${scope}:${r.id}`"
                />
                <span class="text-right text-sm font-semibold" :class="r.over ? 'text-rose-700' : 'text-emerald-700'" data-left>{{ hasItems ? qty(r.left) : '—' }}</span>
              </div>
              <p v-if="r.over" class="mt-1 text-xs font-medium text-rose-700">ลดเกินราคาปกติ ({{ bahtText(r.reg) }})</p>
            </li>
          </ul>
        </div>
      </section>

      <!-- ผลตรวจข้อมูล -->
      <section
        v-if="check.errors.length || check.warnings.length || check.info.length"
        id="bd-checks"
        class="space-y-2"
        aria-live="polite"
        data-bundle-checks
      >
        <p v-for="(e, i) in check.errors" :key="`e${i}`" class="flex items-start gap-2 rounded-xl bg-rose-50 p-3 text-sm text-rose-800">
          <AppIcon name="alert" :size="16" class="mt-0.5 shrink-0" /><span class="min-w-0">{{ e }}</span>
        </p>
        <p v-for="(w, i) in check.warnings" :key="`w${i}`" class="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{{ w }}</p>
        <p v-for="(n, i) in check.info" :key="`i${i}`" class="rounded-xl bg-sky-50 p-3 text-sm text-sky-900">{{ n }}</p>
      </section>

      <!-- 5 รูปแบบตกแต่ง (ไม่บังคับ) -->
      <details v-if="styles.length" class="card" :open="hasOwnStyle" data-style-section>
        <summary class="flex cursor-pointer list-none items-center justify-between gap-2 font-semibold text-stone-900">
          <span>ราคาแยกตามรูปแบบตกแต่ง <span class="text-xs font-normal text-stone-500">(ไม่บังคับ)</span></span>
          <AppIcon name="next" :size="16" class="shrink-0 text-stone-400" />
        </summary>
        <p class="mt-2 text-sm text-stone-500">ปกติใช้ส่วนลดด้านบน · ถ้ารูปแบบนี้ต้องลดต่างออกไป ให้เลือก "ราคาของรูปแบบนี้" แล้วกรอกส่วนลดแยก (ช่องว่าง = ไม่ลดในขนาดนั้น)</p>
        <div class="mt-3 space-y-3">
          <div v-for="st in styles" :key="st.id" class="rounded-xl border border-stone-200 p-3">
            <div class="flex flex-wrap items-center gap-2">
              <span class="min-w-0 flex-1 font-medium text-stone-800">{{ st.name }}</span>
              <div class="flex flex-wrap gap-1.5">
                <button
                  v-for="m in [{ v: 'central', l: 'ใช้ส่วนลดด้านบน' }, { v: 'own', l: 'ราคาของรูปแบบนี้' }]"
                  :key="m.v"
                  type="button"
                  class="chip"
                  :class="draft.styleMode[st.id] === m.v ? 'chip-on' : 'chip-off'"
                  :aria-pressed="draft.styleMode[st.id] === m.v"
                  :data-style-mode="`${st.id}:${m.v}`"
                  @click="draft.styleMode[st.id] = m.v"
                >{{ m.l }}</button>
              </div>
            </div>
            <div v-if="draft.styleMode[st.id] === 'own'" class="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <label v-for="sz in sizes" :key="sz.id" class="text-xs text-stone-500">
                {{ sz.name }} (บาท)
                <input v-model="draft.styleDiscount[st.id][sz.id]" type="text" v-num.dec class="input mt-1 h-10 px-2" :data-style-disc="`${st.id}:${sz.id}`" placeholder="0" />
              </label>
            </div>
          </div>
        </div>
      </details>

      <!-- สถานะ -->
      <section class="card">
        <AppSwitch v-model="draft.active" label="เปิดใช้งาน (ลูกค้าเลือกได้และได้ส่วนลด)" class="flex" />
      </section>

      <!-- แถบบันทึก (ติดล่าง เหนือเมนูล่างบนมือถือ) -->
      <div class="sticky bottom-[calc(env(safe-area-inset-bottom)+5.25rem)] z-10 flex items-center gap-2 rounded-2xl border border-stone-200 bg-white/95 p-3 shadow-lg backdrop-blur lg:bottom-3">
        <p class="min-w-0 flex-1 truncate text-sm" :class="blocked ? 'font-medium text-rose-700' : 'text-stone-600'" data-save-status>
          {{ blocked ? 'ยังบันทึกไม่ได้ · ดูข้อที่ต้องแก้ด้านบน' : hasItems ? `ชุดนี้: ${finalName}` : 'ยังไม่ได้เลือกตัวเลือก' }}
        </p>
        <button type="button" class="btn-outline h-11 shrink-0 px-4" data-cancel @click="cancel">ยกเลิก</button>
        <button type="button" class="btn-primary h-11 shrink-0 px-4" data-save @click="save">บันทึกบันเดิ้ล</button>
      </div>
    </div>
  </ManageShell>

  <div v-else class="card py-10 text-center text-stone-500">
    ไม่พบบันเดิ้ลนี้ <RouterLink :to="LIST" class="text-brand-700 underline">กลับไปหน้าบันเดิ้ล</RouterLink>
  </div>
</template>
