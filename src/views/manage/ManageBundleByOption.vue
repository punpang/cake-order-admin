<script setup>
import { computed, ref, watch } from 'vue'
import { db, saveBundle } from '../../data/store'
import { showToast } from '../../lib/toast'
import { checkBundle, findItemOption, findDuplicate, bahtText } from '../../lib/bundleEditor'
import { MAIN_KEYS } from '../../lib/constants'
import { bundlesWithOption, usageOf, discountRows, setDiscountAt, createBundleDraft, applicableTypes, cakePriceFor } from '../../lib/bundleByOption'
import ManageShell from '../../components/ManageShell.vue'

// เลือกตัวเลือกรองหนึ่งตัว แล้วเห็นทุกชุดที่มีตัวเลือกนั้น ว่าชุดไหนใช้ได้หรือถูกข้ามเมื่อไร และตั้งส่วนลดต่อประเภทและขนาด
const itemGroups = computed(() => db.optionGroups.filter((g) => !MAIN_KEYS.includes(g.key) && g.type !== 'text' && g.active !== false))
const sizes = computed(() => (db.optionGroups.find((x) => x.key === 'size')?.options || []).filter((x) => x.active !== false))
const types = computed(() => (db.optionGroups.find((x) => x.key === 'type')?.options || []).filter((x) => x.active !== false))
const styles = computed(() => (db.optionGroups.find((x) => x.key === 'style')?.options || []).filter((x) => x.active !== false))
const ctx = computed(() => ({ groups: db.optionGroups, sizes: sizes.value, types: db.optionGroups.find((x) => x.key === 'type')?.options || [], styles: styles.value }))

const groupId = ref(null)
const optionId = ref(null)
const curGroup = computed(() => itemGroups.value.find((g) => g.id === groupId.value) || itemGroups.value[0] || null)
const groupOptions = computed(() => (curGroup.value?.options || []).filter((o) => o.active !== false))
const curOption = computed(() => groupOptions.value.find((o) => o.id === optionId.value) || groupOptions.value[0] || null)
watch(curGroup, () => { optionId.value = null })

// ตัวเลือกเค้กที่ใช้คำนวณราคาเต็ม (ประเภท + เนื้อ + ขนาด) ต่อชุด · ค่าเริ่มต้นคือตัวแรกที่ใช้ได้
const flavors = computed(() => (db.optionGroups.find((x) => x.key === 'flavor')?.options || []).filter((x) => x.active !== false))
const cakePick = ref({})
function cakeOf(b) {
  const d = cakePick.value[b.id] || {}
  const applicable = applicableTypes(b, db.optionGroups, types.value)
  return {
    typeId: d.typeId ?? applicable[0] ?? null,
    flavorId: d.flavorId ?? flavors.value[0]?.id ?? null,
    sizeId: d.sizeId ?? curSize.value?.id ?? sizes.value[0]?.id ?? null,
  }
}
const setCake = (bid, key, v) => { cakePick.value = { ...cakePick.value, [bid]: { ...(cakePick.value[bid] || {}), [key]: v } } }
const curSize = computed(() => sizes.value[0] || null)

// คีย์ของช่องในแถว: ประเภทว่าง = ทุกประเภท
const cellKey = (typeId, sizeId) => `${typeId ?? ''}|${sizeId}`
const parseKey = (k) => {
  const i = k.indexOf('|')
  const t = k.slice(0, i)
  return { typeId: t === '' ? null : t, sizeId: k.slice(i + 1) }
}

// ชุดที่มีตัวเลือกนี้ พร้อมสถานะและแถวต่อประเภทและขนาด
const linked = computed(() => {
  if (!curGroup.value || !curOption.value) return []
  const x = { groupId: curGroup.value.id, optionId: curOption.value.id }
  return bundlesWithOption(db.bundles, x, sizes.value).map((b) => ({
    b,
    usage: usageOf(b, db.bundles, sizes.value),
    rows: discountRows(b, db.optionGroups, sizes.value, types.value),
    items: (b.items || []).map((i) => findItemOption(db.optionGroups, i)?.name || 'ตัวเลือกที่ถูกลบแล้ว'),
  }))
})

// การแก้ไขส่วนลดที่ยังไม่บันทึก: edits[bundleId][cellKey] = ข้อความที่พิมพ์ ('' = ลบ)
const edits = ref({})
const setEdit = (bid, key, v) => {
  edits.value = { ...edits.value, [bid]: { ...(edits.value[bid] || {}), [key]: v } }
}
const pendingCount = computed(() => Object.values(edits.value).reduce((n, m) => n + Object.keys(m).length, 0))
const statusText = (u) => ({
  ok: { text: 'ใช้ได้', cls: 'text-success-700' },
  skipped: { text: 'ถูกข้ามเมื่อเลือกครบชุดที่ใหญ่กว่า', cls: 'text-warning-700' },
  nodiscount: { text: 'ยังไม่มีส่วนลด', cls: 'text-stone-400' },
  off: { text: 'ปิดใช้งาน', cls: 'text-stone-400' },
})[u.status]

// บันทึกการแก้ไขที่ค้างอยู่: คำนวณทุกชุดและตรวจก่อน ถ้ามีชุดใดไม่ผ่านจะไม่บันทึกเลย
function saveEdits() {
  const next = []
  for (const [bid, m] of Object.entries(edits.value)) {
    const original = db.bundles.find((b) => b.id === bid)
    if (!original) continue
    let draft = original
    for (const [key, raw] of Object.entries(m)) {
      const { typeId, sizeId } = parseKey(key)
      const val = String(raw ?? '').trim() === '' ? null : raw
      draft = setDiscountAt(draft, typeId, sizeId, val)
    }
    const r = checkBundle(draft, { ...ctx.value, bundles: db.bundles, original })
    if (r.errors.length) {
      showToast(`${original.name}: ${r.errors[0]}`, 8000, 'error')
      return
    }
    next.push(draft)
  }
  for (const d of next) saveBundle(d)
  edits.value = {}
  showToast(`บันทึกแล้ว ${next.length} ชุด`)
}

// สร้างชุดใหม่จากตัวเลือกที่เลือก (ข้ามกลุ่มรองได้)
const picked = ref([])
const newDiscount = ref({})
const togglePick = (x) => {
  const k = `${x.groupId}:${x.optionId}`
  picked.value = picked.value.some((p) => `${p.groupId}:${p.optionId}` === k)
    ? picked.value.filter((p) => `${p.groupId}:${p.optionId}` !== k)
    : [...picked.value, x]
}
const isPicked = (x) => picked.value.some((p) => p.groupId === x.groupId && p.optionId === x.optionId)
const draftItems = computed(() => {
  if (!curOption.value || !curGroup.value) return []
  const base = { groupId: curGroup.value.id, optionId: curOption.value.id }
  return isPicked(base) ? picked.value : [base, ...picked.value]
})
const draftRows = computed(() => discountRows(createBundleDraft(draftItems.value, db.optionGroups), db.optionGroups, sizes.value, types.value))
function createNew() {
  let d = createBundleDraft(draftItems.value, db.optionGroups)
  for (const [key, v] of Object.entries(newDiscount.value)) {
    if (String(v).trim() === '') continue
    const { typeId, sizeId } = parseKey(key)
    d = setDiscountAt(d, typeId, sizeId, v)
  }
  const dup = findDuplicate(d.items, db.bundles)
  if (dup) { showToast(`ซ้ำกับบันเดิ้ล "${dup.name}" แก้ชุดเดิมแทน`, 6000, 'error'); return }
  const r = checkBundle(d, { ...ctx.value, bundles: db.bundles, original: null })
  if (r.errors.length) { showToast(r.errors[0], 6000, 'error'); return }
  saveBundle(d)
  picked.value = []
  newDiscount.value = {}
  showToast(`สร้างชุด "${d.name}" แล้ว`)
}
</script>

<template>
  <ManageShell title="บันเดิ้ลตามตัวเลือก" subtitle="เลือกตัวเลือกหนึ่งตัวแล้วดูทุกชุดที่มีตัวเลือกนั้น" back="/admin/settings/bundles" :toolbar="false" :guard="pendingCount > 0">
    <div class="space-y-4 pb-28">
      <p v-if="!itemGroups.length" class="card p-4 text-sm text-stone-500">ยังไม่มีกลุ่มตัวเลือกรองที่ใช้ทำชุด</p>

      <div class="flex flex-wrap gap-2" data-group-picker>
        <button v-for="g in itemGroups" :key="g.id" type="button" class="rounded-full border px-3 py-1.5 text-sm" :class="curGroup?.id === g.id ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-stone-200 bg-white text-stone-600'" @click="groupId = g.id">{{ g.name }}</button>
      </div>
      <div class="flex flex-wrap gap-2" data-option-picker>
        <button v-for="o in groupOptions" :key="o.id" type="button" class="rounded-full border px-3 py-1.5 text-sm" :class="curOption?.id === o.id ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-stone-200 bg-white text-stone-600'" @click="optionId = o.id">{{ o.name }}</button>
      </div>

      <section class="space-y-3" data-linked>
        <h2 class="text-sm font-semibold text-stone-800">ชุดที่มี {{ curOption?.name }} ({{ linked.length }})</h2>
        <p v-if="!linked.length" class="card p-4 text-sm text-stone-500">ยังไม่มีชุดที่มีตัวเลือกนี้</p>
        <div v-for="r in linked" :key="r.b.id" class="card space-y-2 p-3" :data-bundle="r.b.id">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <p class="truncate text-sm font-medium">{{ r.b.name }}</p>
              <p class="text-xs text-stone-500">{{ r.items.join(' + ') }}</p>
            </div>
            <RouterLink :to="`/admin/settings/bundles/${r.b.id}`" class="shrink-0 text-xs text-brand-700 underline">แก้ชุดนี้</RouterLink>
          </div>
          <p class="text-xs" :class="statusText(r.usage).cls" :data-status="r.usage.status">
            {{ statusText(r.usage).text }}<span v-if="r.usage.conflicts.length">: {{ r.usage.conflicts.map((c) => c.name).join(', ') }}</span>
          </p>
          <div class="space-y-2 rounded-xl bg-stone-50 p-2" :data-cake="r.b.id">
            <p class="text-xs font-medium text-stone-600">ราคาเค้กเต็มของตัวเลือกนี้</p>
            <div class="flex flex-wrap gap-2">
              <select class="input h-9 w-auto text-sm" :value="cakeOf(r.b).typeId" :aria-label="`ประเภท ${r.b.name}`" @change="setCake(r.b.id, 'typeId', $event.target.value)">
                <option v-for="t in types.filter((x) => applicableTypes(r.b, db.optionGroups, types).includes(x.id))" :key="t.id" :value="t.id">{{ t.name }}</option>
              </select>
              <select class="input h-9 w-auto text-sm" :value="cakeOf(r.b).flavorId" :aria-label="`เนื้อเค้ก ${r.b.name}`" @change="setCake(r.b.id, 'flavorId', $event.target.value)">
                <option v-for="f in flavors" :key="f.id" :value="f.id">{{ f.name }}</option>
              </select>
              <select class="input h-9 w-auto text-sm" :value="cakeOf(r.b).sizeId" :aria-label="`ขนาด ${r.b.name}`" @change="setCake(r.b.id, 'sizeId', $event.target.value)">
                <option v-for="z in sizes" :key="z.id" :value="z.id">{{ z.name }}</option>
              </select>
            </div>
            <p class="text-sm text-stone-700" data-cake-price>
              ราคาเต็ม {{ bahtText(cakePriceFor(r.b, db.optionGroups, cakeOf(r.b)).before) }} → หลังบันเดิ้ลนี้ {{ bahtText(cakePriceFor(r.b, db.optionGroups, cakeOf(r.b)).after) }}
            </p>
          </div>
          <div v-for="row in r.rows" :key="cellKey(row.typeId, row.sizeId)" class="flex items-center justify-between gap-2 text-sm">
            <span class="text-stone-600">{{ row.typeName ? `${row.typeName} · ` : '' }}{{ row.sizeName }} · ราคาปกติ {{ bahtText(row.regular) }} · หลังหักส่วนลด {{ bahtText(row.after) }}</span>
            <input type="number" inputmode="numeric" min="0" class="input h-9 w-24 text-right" :value="edits[r.b.id]?.[cellKey(row.typeId, row.sizeId)] ?? row.amount" :data-row="`${r.b.id}|${cellKey(row.typeId, row.sizeId)}`" :aria-label="`ส่วนลด ${r.b.name} ${row.typeName} ${row.sizeName}`" @input="setEdit(r.b.id, cellKey(row.typeId, row.sizeId), $event.target.value)" />
          </div>
        </div>
      </section>

      <section class="card space-y-3 p-3" data-new-bundle>
        <h2 class="text-sm font-semibold text-stone-800">สร้างชุดใหม่จาก {{ curOption?.name }}</h2>
        <p class="text-xs text-stone-500">เลือกตัวเลือกรองอื่นเพิ่มได้จากทุกกลุ่ม</p>
        <div v-for="g in itemGroups" :key="g.id" class="space-y-1">
          <p class="text-xs font-medium text-stone-600">{{ g.name }}</p>
          <div class="flex flex-wrap gap-2">
            <label v-for="o in g.options.filter((x) => x.active !== false)" :key="o.id" class="flex items-center gap-1 rounded-full border border-stone-200 px-2.5 py-1 text-sm">
              <input type="checkbox" :checked="isPicked({ groupId: g.id, optionId: o.id }) || (curOption?.id === o.id && g.id === curGroup?.id)" :disabled="curOption?.id === o.id && g.id === curGroup?.id" @change="togglePick({ groupId: g.id, optionId: o.id })" />
              {{ o.name }}
            </label>
          </div>
        </div>
        <div v-if="draftItems.length >= 2" class="space-y-2">
          <div v-for="row in draftRows" :key="cellKey(row.typeId, row.sizeId)" class="flex items-center justify-between gap-2 text-sm">
            <span class="text-stone-600">{{ row.typeName ? `${row.typeName} · ` : '' }}{{ row.sizeName }} · ราคาปกติ {{ bahtText(row.regular) }} · หลังหักส่วนลด {{ bahtText(row.after) }}</span>
            <input type="number" inputmode="numeric" min="0" class="input h-9 w-24 text-right" :value="newDiscount[cellKey(row.typeId, row.sizeId)] ?? ''" :aria-label="`ส่วนลดชุดใหม่ ${row.typeName} ${row.sizeName}`" @input="newDiscount = { ...newDiscount, [cellKey(row.typeId, row.sizeId)]: $event.target.value }" />
          </div>
          <button type="button" class="btn-primary h-10 px-4 text-sm" data-create @click="createNew">สร้างชุด</button>
        </div>
      </section>
    </div>

    <div class="sticky bottom-[calc(env(safe-area-inset-bottom)+5.25rem)] z-10 flex items-center gap-2 rounded-2xl border border-stone-200 bg-white/95 p-3 shadow-lg backdrop-blur lg:bottom-3">
      <p class="min-w-0 flex-1 truncate text-sm text-stone-600">{{ pendingCount ? `ยังไม่บันทึก ${pendingCount} ช่อง` : 'ไม่มีการแก้ไขที่ค้างอยู่' }}</p>
      <button type="button" class="btn-primary h-11 shrink-0 px-4" :disabled="!pendingCount" data-save-edits @click="saveEdits">บันทึกส่วนลด</button>
    </div>
  </ManageShell>
</template>
