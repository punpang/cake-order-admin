<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import ManageShell from '../../components/ManageShell.vue'
import { getSupabase } from '../../lib/supabase'
import { filesEnabled, filesApi } from '../../lib/storage'
import { askConfirm } from '../../lib/confirm'
import { dateTime } from '../../lib/format'

// พื้นที่รูป: ตั้งจำนวนวันลบอัตโนมัติ (สลิป/รูปอ้างอิง) + ค้นหาและลบรูปแบบแมนนวล · รูปงานลบไม่ได้
const TYPES = [{ v: 'all', l: 'ทั้งหมด (ส่วนตัว)' }, { v: 'slip', l: 'สลิป' }, { v: 'ref', l: 'รูปอ้างอิง' }, { v: 'work', l: 'รูปงาน (ดูอย่างเดียว)' }, { v: 'public', l: 'รูปสาธารณะ (สินค้า/หน้าร้าน)' }]
const STATUSES = [{ v: '', l: 'ทุกสถานะ' }, { v: 'delivered', l: 'ส่งมอบแล้ว' }, { v: 'cancelled', l: 'ยกเลิก' }, { v: 'order_confirmed', l: 'ยืนยันแล้ว' }, { v: 'preparing', l: 'กำลังเตรียม' }, { v: 'prepared', l: 'เตรียมแล้ว' }]
const ret = reactive({ slipDays: 180, refDays: 180, loaded: false })
const filter = reactive({ type: 'all', status: '', code: '', uploadedFrom: '', uploadedTo: '', closedFrom: '', closedTo: '' })
const items = ref([])
const cursor = ref(null)
const picked = ref(new Set())
const busy = ref(false)
const msg = ref('')
const err = ref('')
const preview = ref(null)
const listBucket = ref('private') // bucket ของรายการที่แสดงอยู่ (ใช้กับการลบ)

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
  Object.assign(ret, { slipDays: r.slipDays, refDays: r.refDays, loaded: true })
}
const saveRetention = () => run(async () => {
  const r = await filesApi(await client(), '/admin/retention/set', { slipDays: Number(ret.slipDays), refDays: Number(ret.refDays) })
  Object.assign(ret, { slipDays: r.slipDays, refDays: r.refDays })
  msg.value = 'บันทึกจำนวนวันแล้ว'
})
const searchBody = (cur) => ({ cursor: cur || undefined, filter: { type: filter.type, status: filter.status, code: filter.code.trim(), uploadedFrom: filter.uploadedFrom, uploadedTo: filter.uploadedTo, closedFrom: filter.closedFrom, closedTo: filter.closedTo } })
const search = () => run(async () => {
  picked.value = new Set(); preview.value = null
  listBucket.value = filter.type === 'public' ? 'public' : 'private'
  const r = await filesApi(await client(), '/admin/list', searchBody(null))
  items.value = r.items; cursor.value = r.cursor
})
const more = () => run(async () => {
  const r = await filesApi(await client(), '/admin/list', searchBody(cursor.value))
  items.value = [...items.value, ...r.items]; cursor.value = r.cursor
})
const selectAllDeletable = () => { picked.value = new Set(items.value.filter(deletable).map((i) => i.key)) }
const clearPicked = () => { picked.value = new Set(); preview.value = null }

const dryRun = () => run(async () => {
  if (!pickedKeys.value.length) throw new Error('เลือกรายการก่อน')
  preview.value = await filesApi(await client(), '/admin/delete', { keys: pickedKeys.value, dryRun: true, ...bodyBucket() })
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
  <ManageShell title="พื้นที่รูป & การลบรูป" subtitle="ลบอัตโนมัติ: สลิป/รูปอ้างอิง หลังออเดอร์ปิดตามจำนวนวัน · รูปงานไม่ถูกลบ" :toolbar="false">
    <div v-if="!filesEnabled()" class="card text-sm text-amber-800">ยังไม่ได้ตั้งค่า VITE_FILES_URL จึงจัดการพื้นที่รูปไม่ได้</div>
    <div v-else class="space-y-4">
      <section class="card space-y-3">
        <h2 class="font-semibold text-stone-900">ลบอัตโนมัติ (ทุกวัน)</h2>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label class="block"><span class="label">สลิป: ลบหลังออเดอร์ปิดแล้ว (วัน)</span><input v-model.number="ret.slipDays" type="number" min="30" max="3650" class="input" /></label>
          <label class="block"><span class="label">รูปอ้างอิง: ลบหลังออเดอร์ปิดแล้ว (วัน)</span><input v-model.number="ret.refDays" type="number" min="30" max="3650" class="input" /></label>
        </div>
        <p class="text-xs text-stone-500">ค่าขั้นต่ำ 30 วัน · รูปงานไม่มีการลบอัตโนมัติ</p>
        <button type="button" class="btn-primary h-10 px-4" :disabled="busy || !ret.loaded" @click="saveRetention">บันทึกจำนวนวัน</button>
      </section>

      <section class="card space-y-3">
        <h2 class="font-semibold text-stone-900">ค้นหารูปเพื่อลบ</h2>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label class="block"><span class="label">ประเภท</span><select v-model="filter.type" class="input"><option v-for="t in TYPES" :key="t.v" :value="t.v">{{ t.l }}</option></select></label>
          <label class="block"><span class="label">สถานะออเดอร์</span><select v-model="filter.status" class="input"><option v-for="s in STATUSES" :key="s.v" :value="s.v">{{ s.l }}</option></select></label>
          <label class="block"><span class="label">เลขออร์เดอร์</span><input v-model="filter.code" class="input" placeholder="เช่น 001122" /></label>
          <label class="block"><span class="label">อัปโหลดตั้งแต่</span><input v-model="filter.uploadedFrom" type="date" class="input" /></label>
          <label class="block"><span class="label">อัปโหลดถึง</span><input v-model="filter.uploadedTo" type="date" class="input" /></label>
          <label class="block"><span class="label">ออเดอร์ปิดตั้งแต่</span><input v-model="filter.closedFrom" type="date" class="input" /></label>
          <label class="block"><span class="label">ออเดอร์ปิดถึง</span><input v-model="filter.closedTo" type="date" class="input" /></label>
        </div>
        <button type="button" class="btn-primary h-10 px-4" :disabled="busy" @click="search">ค้นหา</button>
      </section>

      <p v-if="msg" class="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{{ msg }}</p>
      <p v-if="err" class="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{{ err }}</p>

      <section v-if="items.length" class="card space-y-3">
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-sm text-stone-600">พบ {{ items.length }} ไฟล์ · เลือก {{ pickedKeys.length }} ({{ fmtSize(selectedSize) }})</span>
          <button type="button" class="btn-outline h-9 px-3" @click="selectAllDeletable">เลือกทั้งหมดที่ลบได้</button>
          <button type="button" class="btn-outline h-9 px-3" @click="clearPicked">ล้างการเลือก</button>
          <button type="button" class="btn-outline h-9 px-3" :disabled="busy || !pickedKeys.length" @click="dryRun">ดูตัวอย่างก่อนลบ</button>
          <button type="button" class="btn-danger h-9 px-3" :disabled="busy || !pickedKeys.length" @click="removeSelected">ลบที่เลือก</button>
        </div>
        <p v-if="preview" class="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">ตัวอย่าง: จะลบ {{ preview.wouldDelete.length }} ไฟล์ · ข้าม {{ preview.refused.length }} ไฟล์<span v-if="preview.refused.length"> ({{ preview.refused[0].reason }})</span></p>
        <ul class="divide-y divide-stone-100">
          <li v-for="it in items" :key="it.key" class="flex items-center gap-3 py-2 text-sm">
            <input type="checkbox" :checked="picked.has(it.key)" :disabled="!deletable(it)" :aria-label="`เลือก ${it.key}`" @change="toggle(it.key)" />
            <div class="min-w-0 flex-1">
              <div class="truncate font-medium text-stone-900">{{ it.type === 'public' ? it.key : (it.code || it.orderId) + ' · ' + (it.type === 'slip' ? 'สลิป' : it.type === 'ref' ? 'รูปอ้างอิง' : 'รูปงาน') }}</div>
              <div class="text-xs text-stone-500">{{ it.status || 'ไม่พบออร์เดอร์' }} · {{ fmtSize(it.size) }}<span v-if="it.uploaded"> · {{ dateTime(it.uploaded) }}</span></div>
            </div>
            <span v-if="it.referenced" class="rounded-full bg-sky-50 px-2 py-0.5 text-xs text-sky-700">ยังถูกใช้งาน</span>
            <span v-else-if="!it.deletable" class="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-600">ลบไม่ได้</span>
          </li>
        </ul>
        <button v-if="cursor" type="button" class="btn-outline h-9 px-3" :disabled="busy" @click="more">โหลดเพิ่ม</button>
      </section>
    </div>
  </ManageShell>
</template>
