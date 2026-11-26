<script setup>
import ThaiDateField from '../../components/ThaiDateField.vue'
import { computed, onMounted, reactive, ref } from 'vue'
import ManageShell from '../../components/ManageShell.vue'
import { getSupabase } from '../../lib/supabase'
import { filesEnabled, filesApi, filesBase } from '../../lib/storage'
import { askConfirm } from '../../lib/confirm'
import MoneyInput from '../../components/MoneyInput.vue'
import { dateTime } from '../../lib/format'
import { clearImageLimitsCache } from '../../lib/imageLimits'
import { openLightbox } from '../../lib/lightbox'

// พื้นที่รูป: ตั้งจำนวนวันลบอัตโนมัติ (สลิป/รูปอ้างอิง) + ค้นหาและลบรูปแบบแมนนวล · รูปงานลบได้ (เข้าถังขยะ)
// s = ป้ายสั้นบนปุ่ม · l = คำอธิบายเต็ม (title)
const TYPES = [{ v: 'all', s: 'ทั้งหมด', l: 'ทั้งหมด (ส่วนตัว)' }, { v: 'slip', s: 'สลิป', l: 'สลิป' }, { v: 'ref', s: 'รูปอ้างอิง', l: 'รูปอ้างอิง' }, { v: 'work', s: 'รูปงาน', l: 'รูปงาน (ดูอย่างเดียว)' }, { v: 'public', s: 'รูปสาธารณะ', l: 'รูปสาธารณะ (สินค้า/หน้าร้าน)' }, { v: 'trash', s: 'ถังขยะ', l: 'ถังขยะ (กู้คืนได้)' }]
const trashBucket = ref('private')
const STATUSES = [{ v: '', l: 'ทุกสถานะ' }, { v: 'delivered', l: 'ส่งมอบแล้ว' }, { v: 'cancelled', l: 'ยกเลิก' }, { v: 'order_confirmed', l: 'ยืนยันแล้ว' }, { v: 'preparing', l: 'กำลังเตรียม' }, { v: 'prepared', l: 'เตรียมแล้ว' }]
const ret = reactive({ slipDays: 180, refDays: 180, trashDays: 30, loaded: false })
const lim = reactive({ maxMB: 5, maxPx: 2000, loaded: false })
const filter = reactive({ type: 'all', status: '', code: '', uploadedFrom: '', uploadedTo: '', closedFrom: '', closedTo: '' })
const items = ref([])
const cursor = ref(null)
const picked = ref(new Set())
const busy = ref(false)
const msg = ref('')
const err = ref('')
const preview = ref(null)
const listBucket = ref('private') // bucket ของรายการที่แสดงอยู่ (ใช้กับการลบ)
const thumbs = reactive({}) // key → ลิงก์รูปตัวอย่าง
// ลิงก์รูปตัวอย่าง: รูปสาธารณะเปิดตรง ๆ · รูปส่วนตัวขอลิงก์ชั่วคราวจาก Worker (ขอครั้งเดียวต่อรายการ)
async function loadThumbs(list) {
  const c = await getSupabase()
  for (const it of list.slice(0, 60)) {
    if (thumbs[it.key]) continue
    if (it.type === 'public' || it.bucket === 'public') { thumbs[it.key] = `${filesBase()}/p/${it.key}`; continue }
    try { const r = await filesApi(c, '/sign', { key: it.key }); thumbs[it.key] = r.url } catch { thumbs[it.key] = '' }
  }
}

const deletable = (it) => it.deletable && !it.referenced
const bodyBucket = () => ({ bucket: listBucket.value })
const pickedKeys = computed(() => [...picked.value])
const selectedSize = computed(() => items.value.filter((i) => picked.value.has(i.key)).reduce((s, i) => s + (i.size || 0), 0))
const fmtSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)
const toggle = (key) => { const s = new Set(picked.value); s.has(key) ? s.delete(key) : s.add(key); picked.value = s }

async function client() { const c = await getSupabase(); if (!c) throw new Error('ยังไม่ได้เชื่อมต่อฐานข้อมูล'); return c }
async function run(fn) {
  msg.value = ''; err.value = ''; busy.value = true
  try { await fn() } catch (e) { err.value = e.message || 'เกิดข้อผิดพลาด' } finally { busy.value = false }
}
async function loadRetention() {
  const r = await filesApi(await client(), '/admin/retention/get')
  Object.assign(ret, { slipDays: r.slipDays, refDays: r.refDays, trashDays: r.trashDays, loaded: true })
  const l = await filesApi(await client(), '/admin/limits/get')
  Object.assign(lim, { maxMB: l.maxMB, maxPx: l.maxPx, loaded: true })
}
const saveAll = () => run(async () => {
  const c = await client()
  const r = await filesApi(c, '/admin/retention/set', { slipDays: Number(ret.slipDays), refDays: Number(ret.refDays), trashDays: Number(ret.trashDays) })
  Object.assign(ret, { slipDays: r.slipDays, refDays: r.refDays, trashDays: r.trashDays })
  const l = await filesApi(c, '/admin/limits/set', { maxMB: Number(lim.maxMB), maxPx: Number(lim.maxPx) })
  Object.assign(lim, { maxMB: l.maxMB, maxPx: l.maxPx })
  clearImageLimitsCache()
  msg.value = 'บันทึกการตั้งค่าแล้ว'
})
const searchBody = (cur) => ({ cursor: cur || undefined, bucket: filter.type === 'trash' ? trashBucket.value : 'private', filter: { type: filter.type, status: filter.status, code: filter.code.trim(), uploadedFrom: filter.uploadedFrom, uploadedTo: filter.uploadedTo, closedFrom: filter.closedFrom, closedTo: filter.closedTo } })
const search = () => run(async () => {
  picked.value = new Set(); preview.value = null
  listBucket.value = filter.type === 'public' ? 'public' : 'private'
  const r = await filesApi(await client(), '/admin/list', searchBody(null))
  items.value = r.items; cursor.value = r.cursor
  loadThumbs(r.items)
})
const more = () => run(async () => {
  const r = await filesApi(await client(), '/admin/list', searchBody(cursor.value))
  items.value = [...items.value, ...r.items]; cursor.value = r.cursor
  loadThumbs(r.items)
})
const selectAllDeletable = () => { picked.value = new Set(items.value.filter(deletable).map((i) => i.key)) }
const clearPicked = () => { picked.value = new Set(); preview.value = null }

const dryRun = () => run(async () => {
  if (!pickedKeys.value.length) throw new Error('เลือกรายการก่อน')
  preview.value = await filesApi(await client(), '/admin/delete', { keys: pickedKeys.value, dryRun: true, ...bodyBucket() })
})
const trashMode = computed(() => filter.type === 'trash')
const restoreSelected = () => run(async () => {
  if (!pickedKeys.value.length) throw new Error('เลือกรายการก่อน')
  const r = await filesApi(await client(), '/admin/trash/restore', { keys: pickedKeys.value, bucket: trashBucket.value })
  const gone = new Set(pickedKeys.value)
  items.value = items.value.filter((i) => !gone.has(i.key))
  picked.value = new Set()
  msg.value = `กู้คืนแล้ว ${r.done} ไฟล์${r.skipped?.length ? ` · ข้าม ${r.skipped.length} ไฟล์ (มีไฟล์เดิมอยู่แล้ว)` : ''}`
})
const purgeSelected = () => run(async () => {
  if (!pickedKeys.value.length) throw new Error('เลือกรายการก่อน')
  const ok = await askConfirm({ title: 'ลบถาวร', message: `ลบ ${pickedKeys.value.length} ไฟล์จากถังขยะถาวร ไม่สามารถกู้คืนได้`, okText: 'ลบถาวร', danger: true })
  if (!ok) return
  const r = await filesApi(await client(), '/admin/trash/purge', { keys: pickedKeys.value, bucket: trashBucket.value })
  const gone = new Set(pickedKeys.value)
  items.value = items.value.filter((i) => !gone.has(i.key))
  picked.value = new Set()
  msg.value = `ลบถาวรแล้ว ${r.done} ไฟล์`
})
const removeSelected = () => run(async () => {
  if (!pickedKeys.value.length) throw new Error('เลือกรายการก่อน')
  const ok = await askConfirm({ title: 'ลบรูปที่เลือก', message: `ลบ ${pickedKeys.value.length} ไฟล์ (${fmtSize(selectedSize.value)}) ถาวร ไม่สามารถกู้คืนได้`, okText: 'ลบถาวร', danger: true })
  if (!ok) return
  const r = await filesApi(await client(), '/admin/delete', { keys: pickedKeys.value, ...bodyBucket() })
  const gone = new Set(pickedKeys.value)
  items.value = items.value.filter((i) => !gone.has(i.key))
  picked.value = new Set(); preview.value = null
  msg.value = `ลบแล้ว ${r.deleted} ไฟล์${r.refused?.length ? ` · ข้าม ${r.refused.length} ไฟล์ (${r.refused[0].reason})` : ''}`
})
onMounted(() => { if (filesEnabled()) run(loadRetention) })
</script>

<template>
  <ManageShell title="พื้นที่รูป & การลบรูป" subtitle="ลบอัตโนมัติ: สลิป/รูปอ้างอิง หลังออเดอร์ปิดตามจำนวนวัน · รูปงานลบได้ (เข้าถังขยะก่อน กู้คืนได้)" :toolbar="false">
    <div v-if="!filesEnabled()" class="card text-sm text-warning-800">ยังไม่ได้ตั้งค่า VITE_FILES_URL จึงจัดการพื้นที่รูปไม่ได้</div>
    <div v-else class="space-y-3">
      <!-- ตั้งค่า: พับไว้ได้ ค่าเริ่มต้นซ่อน -->
      <details class="card group">
        <summary class="flex cursor-pointer list-none items-center justify-between gap-2 font-semibold text-stone-900">
          <span>ตั้งค่าการลบและขนาดรูป</span>
          <span class="text-xs font-normal text-stone-500 group-open:hidden">{{ ret.slipDays }}/{{ ret.refDays }}/{{ ret.trashDays }} วัน · {{ lim.maxMB }} MB · {{ lim.maxPx }}px</span>
        </summary>
        <div class="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
          <label class="block"><span class="label">สลิป (วัน)</span><input v-model.number="ret.slipDays" type="number" min="30" max="3650" class="input" /></label>
          <label class="block"><span class="label">รูปอ้างอิง (วัน)</span><input v-model.number="ret.refDays" type="number" min="30" max="3650" class="input" /></label>
          <label class="block"><span class="label">ถังขยะ (วัน)</span><input v-model.number="ret.trashDays" type="number" min="30" max="3650" class="input" /></label>
          <label class="block"><span class="label">ขนาดไฟล์ (MB)</span><MoneyInput v-model.number="lim.maxMB" min="1" max="20" class="input" /></label>
          <label class="block"><span class="label">ด้านยาว (px)</span><input v-model.number="lim.maxPx" type="number" min="500" max="4000" step="100" class="input" /></label>
        </div>
        <p class="mt-2 text-xs text-stone-500">วันขั้นต่ำ 30 · ระบบย่อรูปที่ใหญ่เกินอัตโนมัติก่อนอัปโหลด</p>
        <button type="button" class="btn-primary mt-3 h-9 px-4" :disabled="busy || !ret.loaded || !lim.loaded" @click="saveAll">บันทึกการตั้งค่า</button>
      </details>

      <!-- ค้นหา: แถวเดียว + ตัวกรองเพิ่มเติมพับได้ -->
      <section class="card space-y-2">
        <!-- ประเภท: ปุ่มชิป (แตะง่ายบน iPad แทน dropdown) -->
        <div class="flex flex-wrap gap-2" role="group" aria-label="ประเภท">
          <button
            v-for="t in TYPES"
            :key="t.v"
            type="button"
            class="chip h-10 px-3.5 text-sm"
            :class="filter.type === t.v ? 'chip-on' : 'chip-off'"
            :aria-pressed="filter.type === t.v"
            :title="t.l"
            @click="filter.type = t.v"
          >{{ t.s }}</button>
        </div>
        <div class="grid grid-cols-[1fr_auto] gap-2">
          <input v-model="filter.code" class="input" placeholder="เลขออร์เดอร์ เช่น 001122" aria-label="เลขออร์เดอร์" />
          <button type="button" class="btn-primary h-10 px-4" :disabled="busy" @click="search">ค้นหา</button>
        </div>
        <details class="text-sm">
          <summary class="cursor-pointer py-2 text-stone-600">ตัวกรองเพิ่มเติม</summary>
          <div class="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <select v-model="filter.status" class="input" aria-label="สถานะออเดอร์"><option v-for="s in STATUSES" :key="s.v" :value="s.v">{{ s.l }}</option></select>
            <ThaiDateField v-model="filter.uploadedFrom" :past="5" label="อัปโหลดตั้งแต่" />
            <ThaiDateField v-model="filter.uploadedTo" :past="5" label="อัปโหลดถึง" />
            <ThaiDateField v-model="filter.closedFrom" :past="5" label="ออเดอร์ปิดตั้งแต่" />
            <ThaiDateField v-model="filter.closedTo" :past="5" label="ออเดอร์ปิดถึง" />
          </div>
        </details>
      </section>

      <p v-if="msg" class="rounded-xl bg-success-50 p-3 text-sm text-success-800">{{ msg }}</p>
      <p v-if="err" class="rounded-xl bg-danger-50 p-3 text-sm text-danger-700">{{ err }}</p>

      <section v-if="items.length" class="card space-y-2">
        <div class="flex flex-wrap items-center gap-1.5 text-sm">
          <span class="mr-auto text-stone-600">พบ {{ items.length }} · เลือก {{ pickedKeys.length }} ({{ fmtSize(selectedSize) }})</span>
          <button type="button" class="btn-outline h-8 px-2.5 text-xs" @click="selectAllDeletable">เลือกทั้งหมด</button>
          <button type="button" class="btn-outline h-8 px-2.5 text-xs" @click="clearPicked">ล้าง</button>
          <button type="button" class="btn-outline h-8 px-2.5 text-xs" :disabled="busy || !pickedKeys.length" @click="dryRun">ดูตัวอย่าง</button>
        </div>
        <div class="flex flex-wrap items-center gap-1.5">
          <template v-if="trashMode">
            <select v-model="trashBucket" class="input h-8 w-auto py-0 text-xs" aria-label="ถัง"><option value="private">ถังส่วนตัว</option><option value="public">ถังรูปสาธารณะ</option></select>
            <button type="button" class="btn-primary h-8 px-3 text-xs" :disabled="busy || !pickedKeys.length" @click="restoreSelected">กู้คืน</button>
            <button type="button" class="btn-danger h-8 px-3 text-xs" :disabled="busy || !pickedKeys.length" @click="purgeSelected">ลบถาวร</button>
          </template>
          <button v-else type="button" class="btn-danger h-8 px-3 text-xs" :disabled="busy || !pickedKeys.length" @click="removeSelected">ย้ายที่เลือกไปถังขยะ</button>
        </div>
        <p v-if="preview" class="rounded-xl bg-warning-50 p-2.5 text-xs text-warning-800">ตัวอย่าง: จะลบ {{ preview.wouldDelete.length }} ไฟล์ · ข้าม {{ preview.refused.length }} ไฟล์<span v-if="preview.refused.length"> ({{ preview.refused[0].reason }})</span></p>
        <ul class="divide-y divide-stone-100">
          <li v-for="it in items" :key="it.key" class="flex items-center gap-2.5 py-1.5 text-sm">
            <input type="checkbox" class="h-4 w-4 shrink-0" :checked="picked.has(it.key)" :disabled="!deletable(it)" :aria-label="`เลือก ${it.key}`" @change="toggle(it.key)" />
            <button v-if="thumbs[it.key]" type="button" class="shrink-0 cursor-zoom-in" aria-label="ดูรูปขนาดใหญ่" @click="openLightbox(thumbs[it.key], it.code || it.key)"><img :src="thumbs[it.key]" alt="" loading="lazy" class="h-11 w-11 rounded-lg object-cover" /></button>
            <span v-else class="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-stone-100 text-xs text-stone-400">ไม่มีรูป</span>
            <div class="min-w-0 flex-1">
              <div class="truncate font-medium text-stone-900">{{ it.type === 'public' ? it.key : (it.code || it.orderId) + ' · ' + (it.type === 'slip' ? 'สลิป' : it.type === 'ref' ? 'รูปอ้างอิง' : 'รูปงาน') }}</div>
              <div class="truncate text-xs text-stone-500">{{ it.status || 'ไม่พบออร์เดอร์' }} · {{ fmtSize(it.size) }}<span v-if="it.uploaded"> · {{ dateTime(it.uploaded) }}</span></div>
            </div>
            <span v-if="it.referenced" class="shrink-0 rounded-full bg-info-50 px-2 py-0.5 text-xs text-info-700">ยังถูกใช้งาน</span>
            <span v-else-if="!it.deletable" class="shrink-0 rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-600">ลบไม่ได้</span>
          </li>
        </ul>
        <button v-if="cursor" type="button" class="btn-outline h-8 px-3 text-xs" :disabled="busy" @click="more">โหลดเพิ่ม</button>
      </section>
    </div>
  </ManageShell>
</template>
