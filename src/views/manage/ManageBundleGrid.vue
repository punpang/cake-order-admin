<script setup>
import { computed, ref, watch } from 'vue'
import { db, saveBundle } from '../../data/store'
import { askConfirm } from '../../lib/confirm'
import { showToast } from '../../lib/toast'
import { checkBundle, itemSetKey } from '../../lib/bundleEditor'
import { groupPairs, findPairBundle, cellState, suggestPrice, writeCell, hasAnyDiscount, pairNames } from '../../lib/bundleGrid'
import ManageShell from '../../components/ManageShell.vue'

// ตารางตั้งราคาชุดคู่ต่อกลุ่ม: เห็นทุกคู่ในกลุ่มบนจอเดียว กรอกราคาในช่องได้เลย แล้วบันทึกทั้งหมดพร้อมกัน
const opt = (key) => db.optionGroups.find((x) => x.key === key)?.options || []
const sizes = computed(() => opt('size').filter((x) => x.active !== false))
const types = computed(() => opt('type').filter((x) => x.active !== false))
const styles = computed(() => opt('style').filter((x) => x.active !== false))
const pickGroups = computed(() => db.optionGroups.filter((g) => !['size', 'type', 'style'].includes(g.key) && g.type !== 'text' && g.active !== false))
const ctx = computed(() => ({ groups: db.optionGroups, sizes: sizes.value, types: opt('type'), styles: styles.value }))

const groupId = ref(null)
const sizeId = ref(null)
const scopeKey = ref('all')
const curGroup = computed(() => pickGroups.value.find((g) => g.id === groupId.value) || pickGroups.value[0] || null)
const curSize = computed(() => sizes.value.find((s) => s.id === sizeId.value) || sizes.value[0] || null)
const scopes = computed(() => [
  { key: 'all', kind: 'all', label: 'ทุกชนิดเค้ก' },
  ...types.value.map((t) => ({ key: `type:${t.id}`, kind: 'type', id: t.id, label: t.name })),
  ...styles.value.map((s) => ({ key: `style:${s.id}`, kind: 'style', id: s.id, label: `รูปแบบ ${s.name}` })),
])
const curScope = computed(() => scopes.value.find((s) => s.key === scopeKey.value) || scopes.value[0])

// การแก้ไขที่ยังไม่บันทึก: edits[scopeKey][pairKey] = { items, sizes: { [sizeId]: ข้อความที่พิมพ์ ('' = ลบ) } }
const edits = ref({})
const pairKeyOf = (items) => itemSetKey(items)
const getEdit = (pk, sid) => edits.value[scopeKey.value]?.[pk]?.sizes?.[sid]
const hasEdit = (pk, sid) => getEdit(pk, sid) !== undefined
function setEdit(items, sid, value) {
  const pk = pairKeyOf(items)
  const scopeMap = { ...(edits.value[scopeKey.value] || {}) }
  const entry = scopeMap[pk] ? { ...scopeMap[pk], sizes: { ...scopeMap[pk].sizes } } : { items, sizes: {} }
  entry.sizes[sid] = value
  scopeMap[pk] = entry
  edits.value = { ...edits.value, [scopeKey.value]: scopeMap }
}
const pendingCount = computed(() => Object.values(edits.value).reduce((n, m) => n + Object.values(m).reduce((k, e) => k + Object.keys(e.sizes).length, 0), 0))

// แถวของตาราง: ครึ่งบนของเมทริกซ์ (คู่ไม่ซ้ำ) ของกลุ่ม + ขนาด + ช่องที่เลือก
const rows = computed(() => {
  if (!curGroup.value || !curSize.value) return []
  return groupPairs(curGroup.value).map((p) => {
    const bundle = findPairBundle(db.bundles, p.items)
    const st = cellState(bundle, curScope.value, curSize.value.id)
    const sug = st.state === 'empty' ? suggestPrice(db.bundles, db.optionGroups, p.items, curSize.value.id, curScope.value, curGroup.value.id) : null
    return { ...p, pk: pairKeyOf(p.items), bundle, st, sug }
  })
})

// โหมดเลือกหลายช่อง: ใส่ราคาเดียวให้ทุกคู่ที่เลือก (และทุกขนาดถ้าติ๊ก)
const selected = ref(new Set())
watch(groupId, () => { selected.value = new Set() })
const bulkAmount = ref('')
const bulkAllSizes = ref(false)
const toggle = (pk) => {
  const s = new Set(selected.value)
  s.has(pk) ? s.delete(pk) : s.add(pk)
  selected.value = s
}
function applyBulk() {
  const v = String(bulkAmount.value ?? '').trim()
  if (v === '' || !(Number(v) >= 0)) { showToast('ใส่ราคาเป็นตัวเลข 0 ขึ้นไป', 3000, 'error'); return }
  const sizeList = bulkAllSizes.value ? sizes.value.map((s) => s.id) : [curSize.value?.id]
  for (const r of rows.value) {
    if (!selected.value.has(r.pk)) continue
    for (const sid of sizeList) if (sid) setEdit(r.items, sid, v)
  }
  selected.value = new Set()
  bulkAmount.value = ''
}

const displayOf = (r) => {
  const e = getEdit(r.pk, curSize.value?.id)
  if (e !== undefined) return e
  return r.st.amount ?? ''
}
const stateLabel = (r) => {
  if (hasEdit(r.pk, curSize.value?.id)) return { text: 'แก้ไขแล้ว', cls: 'text-brand-700' }
  if (r.st.state === 'set') return { text: 'ตั้งแล้ว', cls: 'text-success-700' }
  if (r.st.state === 'inherit') return { text: 'รับจากทุกชนิด', cls: 'text-stone-400' }
  return { text: 'ยังไม่ตั้ง', cls: 'text-stone-400' }
}

// บันทึกทั้งหมด: คำนวณทุกชุดก่อน ตรวจทุกชุด แล้วค่อยบันทึก (ถ้ามีชุดใดไม่ผ่าน จะไม่บันทึกเลย)
async function saveAll() {
  const scopeMap = edits.value[scopeKey.value] || {}
  const scope = curScope.value
  const working = new Map()
  for (const [pk, entry] of Object.entries(scopeMap)) {
    for (const [sid, raw] of Object.entries(entry.sizes)) {
      const cur = working.get(pk) ?? findPairBundle(db.bundles, entry.items)
      const amount = String(raw ?? '').trim() === '' ? null : Number(raw)
      const next = writeCell(cur, { items: entry.items, groups: db.optionGroups, scope, sizeId: sid, amount })
      if (next) working.set(pk, next)
    }
  }
  if (!working.size) return
  const finals = []
  for (const [pk, b] of working) {
    const original = findPairBundle(db.bundles, scopeMap[pk].items)
    const final = { ...b }
    if (final.active !== false && !hasAnyDiscount(final)) {
      const ok = await askConfirm({ title: 'ปิดใช้งานชุดนี้?', message: `"${final.name || pairNames(final.items, db.optionGroups)}" ไม่มีส่วนลดแล้ว\nปิดใช้งานชุดนี้หรือไม่ (ไม่ลบชุด)`, okText: 'ปิดใช้งาน' })
      if (ok) final.active = false
    }
    const r = checkBundle(final, { ...ctx.value, bundles: db.bundles, original })
    if (r.errors.length) {
      showToast(`${pairNames(final.items, db.optionGroups)}: ${r.errors[0]}`, 8000, 'error')
      return
    }
    finals.push(final)
  }
  for (const f of finals) saveBundle(f)
  const cleared = { ...edits.value }
  delete cleared[scopeKey.value]
  edits.value = cleared
  showToast(`บันทึกแล้ว ${finals.length} ชุด`)
}
</script>

<template>
  <ManageShell title="ตารางราคาคู่" subtitle="ตั้งราคาชุดคู่ต่อกลุ่ม · ช่องว่าง = ยังไม่ตั้ง" back="/admin/settings/bundles" :guard="pendingCount > 0">
    <div class="space-y-4 pb-4">
      <p v-if="!pickGroups.length" class="card p-4 text-sm text-stone-500">ยังไม่มีกลุ่มตัวเลือกที่ใช้ทำชุดคู่</p>

      <div class="flex flex-wrap gap-2" data-group-picker>
        <button v-for="g in pickGroups" :key="g.id" type="button" class="rounded-full border px-3 py-1.5 text-sm" :class="curGroup?.id === g.id ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-stone-200 bg-white text-stone-600'" @click="groupId = g.id">{{ g.name }}</button>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <div class="flex gap-2" data-size-picker>
          <button v-for="s in sizes" :key="s.id" type="button" class="rounded-lg border px-3 py-1.5 text-sm" :class="curSize?.id === s.id ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-stone-200 bg-white text-stone-600'" @click="sizeId = s.id">{{ s.name }}</button>
        </div>
        <select v-model="scopeKey" class="input h-9 w-auto" data-scope-picker>
          <option v-for="s in scopes" :key="s.key" :value="s.key">{{ s.label }}</option>
        </select>
      </div>

      <div v-if="selected.size" class="card flex flex-wrap items-center gap-2 p-3" data-bulk-bar>
        <span class="text-sm">เลือก {{ selected.size }} คู่</span>
        <input v-model="bulkAmount" type="number" inputmode="numeric" min="0" class="input h-9 w-28" placeholder="ส่วนลด ฿" data-bulk-amount />
        <label class="flex items-center gap-1 text-sm"><input v-model="bulkAllSizes" type="checkbox" /> ทุกขนาด</label>
        <button type="button" class="btn-primary h-9 px-3 text-sm" data-bulk-apply @click="applyBulk">ใส่ให้ที่เลือก</button>
        <button type="button" class="btn-outline h-9 px-3 text-sm" @click="selected = new Set()">ยกเลิกการเลือก</button>
      </div>

      <div class="card divide-y divide-stone-100 overflow-hidden" data-grid>
        <div v-for="r in rows" :key="r.pk" class="flex items-center gap-2 p-3" :data-pair="r.pk">
          <input type="checkbox" class="h-4 w-4 shrink-0" :checked="selected.has(r.pk)" :aria-label="`เลือก ${r.rowName} + ${r.colName}`" @change="toggle(r.pk)" />
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium">{{ r.rowName }} + {{ r.colName }}</p>
            <p class="text-xs" :class="stateLabel(r).cls">{{ stateLabel(r).text }}</p>
          </div>
          <div class="flex shrink-0 items-center gap-1">
            <input
              type="number" inputmode="numeric" min="0"
              class="input h-10 w-24 text-right"
              :value="displayOf(r)"
              :placeholder="r.sug ? String(r.sug.amount) : '—'"
              :class="r.st.state === 'inherit' && !hasEdit(r.pk, curSize?.id) ? 'text-stone-400' : ''"
              :aria-label="`ส่วนลดของ ${r.rowName} + ${r.colName}`"
              @input="setEdit(r.items, curSize.id, $event.target.value)"
            />
            <button v-if="r.sug && !hasEdit(r.pk, curSize?.id)" type="button" class="h-10 rounded-lg border border-brand-200 px-2 text-xs text-brand-700" :data-suggest="r.pk" @click="setEdit(r.items, curSize.id, String(r.sug.amount))">รับ {{ r.sug.amount }} ฿</button>
            <RouterLink v-if="r.bundle && r.st.detail" :to="`/admin/settings/bundles/${r.bundle.id}`" class="h-10 rounded-lg border border-stone-200 px-2 text-xs leading-10 text-stone-600" :data-detail="r.pk">ดูรายละเอียด</RouterLink>
          </div>
        </div>
        <p v-if="!rows.length" class="p-4 text-sm text-stone-500">ไม่มีคู่ให้ตั้ง (ต้องมีตัวเลือกที่เปิดใช้งานอย่างน้อย 2 ตัวในกลุ่ม)</p>
      </div>

      <!-- แถบบันทึก (ติดล่าง เหนือเมนูล่างบนมือถือ เหมือนหน้าแก้ไขชุด) -->
      <div class="sticky bottom-[calc(env(safe-area-inset-bottom)+5.25rem)] z-10 flex items-center gap-2 rounded-2xl border border-stone-200 bg-white/95 p-3 shadow-lg backdrop-blur lg:bottom-3">
        <p class="min-w-0 flex-1 truncate text-sm" :class="pendingCount ? 'text-stone-700' : 'text-stone-500'">{{ pendingCount ? `ยังไม่บันทึก ${pendingCount} ช่อง` : 'ไม่มีการแก้ไขที่ค้างอยู่' }}</p>
        <button type="button" class="btn-primary h-11 shrink-0 px-4" :disabled="!pendingCount" data-save-grid @click="saveAll">บันทึกทั้งหมด</button>
      </div>
    </div>
  </ManageShell>
</template>
