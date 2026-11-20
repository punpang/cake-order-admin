<script setup>
// ข้อผิดพลาดของแอปพนักงาน (เก็บ 30 วัน · เฉพาะผู้จัดการ) · ใช้ดูว่าแอปพังที่หน้าไหน บ่อยแค่ไหน หลังเปิดใช้จริง
import { computed, onMounted, ref } from 'vue'
import { db } from '../../data/store'
import { dateTime } from '../../lib/format'
import { askConfirm } from '../../lib/confirm'
import { fetchErrorLog, clearErrorLog } from '../../lib/errorReport'
import ManageShell from '../../components/ManageShell.vue'

const rows = ref([])
const busy = ref(false)
const err = ref('')
const msg = ref('')
const open = ref(null)

async function load() {
  busy.value = true
  err.value = msg.value = ''
  try {
    const r = await fetchErrorLog()
    if (r.error) err.value = r.error
    else rows.value = r.items
  } finally { busy.value = false }
}
async function clearAll() {
  if (!(await askConfirm({ title: 'ล้างบันทึกข้อผิดพลาด', message: `ลบทั้ง ${rows.value.length} รายการ · ลบแล้วกู้คืนไม่ได้`, okText: 'ล้างทั้งหมด', danger: true }))) return
  const r = await clearErrorLog()
  if (r.error) return (err.value = r.error)
  rows.value = []
  msg.value = 'ล้างแล้ว'
}
const staffName = (id) => db.users.find((u) => u.id === id)?.name || 'พนักงาน'
const total = computed(() => rows.value.reduce((s, r) => s + (r.n || 1), 0))
onMounted(load)
</script>

<template>
  <ManageShell narrow :toolbar="false" title="ข้อผิดพลาดของแอป" subtitle="แอปพนักงานส่งข้อผิดพลาดมาเก็บอัตโนมัติ · ข้อผิดพลาดเดิมนับรวม · เก็บ 30 วัน">
    <div class="mb-3 flex flex-wrap items-center gap-2">
      <p class="mr-auto text-sm text-stone-600" aria-live="polite">{{ busy ? 'กำลังโหลด…' : `${rows.length} รายการ · เกิดรวม ${total.toLocaleString()} ครั้ง` }}</p>
      <button type="button" class="btn-outline h-11 px-4" :disabled="busy" @click="load">โหลดใหม่</button>
      <button v-if="rows.length" type="button" class="btn-outline h-11 px-4 text-rose-700" :disabled="busy" @click="clearAll">ล้างทั้งหมด</button>
    </div>
    <p v-if="err" class="mb-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-800" role="alert">{{ err }}</p>
    <p v-if="msg" class="mb-3 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800" role="status">{{ msg }}</p>
    <p v-if="!busy && !err && !rows.length" class="card py-10 text-center text-stone-500">ยังไม่มีข้อผิดพลาด 🎉</p>

    <ul class="space-y-3">
      <li v-for="r in rows" :key="r.id" class="card">
        <button type="button" class="w-full text-left" :aria-expanded="open === r.id" @click="open = open === r.id ? null : r.id">
          <span class="flex items-start gap-2">
            <span class="min-w-0 flex-1 break-words font-medium text-stone-900">{{ r.message }}</span>
            <span class="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">{{ r.n }} ครั้ง</span>
          </span>
          <span class="mt-1 block text-xs text-stone-500">ล่าสุด {{ dateTime(r.last_at) }} · {{ staffName(r.staff_id) }} · {{ r.url || '-' }}</span>
        </button>
        <div v-if="open === r.id" class="mt-3 space-y-2 border-t border-stone-100 pt-3 text-xs text-stone-600">
          <p>พบครั้งแรก {{ dateTime(r.at) }} · build {{ r.build || '-' }}</p>
          <p class="break-words">{{ r.ua || '-' }}</p>
          <pre v-if="r.stack" class="max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-stone-50 p-2 text-[11px] text-stone-700">{{ r.stack }}</pre>
        </div>
      </li>
    </ul>
  </ManageShell>
</template>
