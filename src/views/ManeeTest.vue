<script setup>
// หน้าทดสอบการรับยอดแม่มณี: รายงานแอปที่ส่งเข้ามา + รายการรับยอดล่าสุด รีเฟรชอัตโนมัติ · เฉพาะพนักงานที่มีสิทธิ์ POS (ดูนโยบาย RLS)
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { supabaseEnabled, getSupabase } from '../lib/supabase'
import { dateTime, money } from '../lib/format'
import ManageShell from '../components/ManageShell.vue'

const rows = ref([])
const inbox = ref([])
const openId = ref(null)
const recentInbox = computed(() => inbox.value.slice(0, 50))
const toggle = (id) => { openId.value = openId.value === id ? null : id }
const names = ref([])
const newName = ref('')
const nameErr = ref('')
const err = ref('')
const loadedAt = ref('')
let timer = null

// เพิ่ม/ลบชื่อแอปแม่มณี (ชื่อที่แสดงบนโทรศัพท์) · รายการหลายชื่อได้
async function addName() {
  nameErr.value = ''
  const n = newName.value.trim()
  if (!n) return
  if (names.value.some((x) => x.name.toLowerCase() === n.toLowerCase())) { nameErr.value = 'มีชื่อนี้อยู่แล้ว'; return }
  try {
    const c = await getSupabase()
    const r = await c.from('manee_app_names').insert({ name: n })
    if (r.error) { nameErr.value = 'เพิ่มไม่สำเร็จ: ' + r.error.message; return }
    newName.value = ''
    await load()
  } catch {
    nameErr.value = 'เพิ่มไม่สำเร็จ'
  }
}
async function removeName(n) {
  nameErr.value = ''
  try {
    const c = await getSupabase()
    const r = await c.from('manee_app_names').delete().eq('name', n)
    if (r.error) { nameErr.value = 'ลบไม่สำเร็จ: ' + r.error.message; return }
    await load()
  } catch {
    nameErr.value = 'ลบไม่สำเร็จ'
  }
}

// ปิดบังตัวเลขยาว 6 หลักขึ้นไป (เลขบัญชี/อ้างอิง) ก่อนแสดงผล
const masked = (t) => String(t ?? '').replace(/\d{6,}/g, '••••••')

// สรุปตามแอป: จำนวนครั้ง, ครั้งล่าสุด, จำนวนที่บันทึกได้, เหตุผลล่าสุด
const byApp = computed(() => {
  const m = new Map()
  for (const r of inbox.value) {
    const key = r.app || '(ไม่ระบุ)'
    if (!m.has(key)) m.set(key, { app: key, name: r.app_name || '', count: 0, stored: 0, last: r.received_at, reason: r.reason })
    const x = m.get(key)
    x.count += 1
    if (r.stored) x.stored += 1
  }
  return [...m.values()].sort((a, b) => (a.last < b.last ? 1 : -1))
})

async function load() {
  if (!supabaseEnabled) { err.value = 'โหมดจำลอง: ไม่ได้เชื่อม Supabase'; return }
  try {
    const c = await getSupabase()
    const [t, i, n] = await Promise.all([
      c.from('manee_transfers').select('id, amount, received_at, app, text, created_at').order('created_at', { ascending: false }).limit(20),
      c.from('manee_inbox').select('id, received_at, app, app_name, event, text, stored, reason').order('received_at', { ascending: false }).limit(500),
      c.from('manee_app_names').select('name').order('name'),
    ])
    if (t.error || i.error || n.error) { err.value = 'อ่านข้อมูลไม่ได้: ' + (t.error?.message || i.error?.message || n.error?.message); return }
    rows.value = t.data || []
    inbox.value = i.data || []
    names.value = n.data || []
    err.value = ''
    loadedAt.value = dateTime(new Date().toISOString())
  } catch {
    err.value = 'อ่านข้อมูลไม่ได้'
  }
}

const count = computed(() => rows.value.length)

onMounted(() => { load(); timer = setInterval(load, 5000) })
onBeforeUnmount(() => clearInterval(timer))
</script>

<template>
  <ManageShell narrow :toolbar="false" title="ทดสอบรับยอดแม่มณี" subtitle="แอปที่ส่งเข้ามา · รายการรับยอดล่าสุด · รีเฟรชทุก 5 วินาที">
    <p v-if="err" class="rounded-2xl bg-rose-50 p-3 text-sm text-rose-700" role="alert">{{ err }}</p>
    <p v-else class="text-sm text-stone-600">
      {{ count ? `รับยอดแล้ว ${count} รายการล่าสุด` : 'ยังไม่มีรายการรับยอดเข้ามา' }}
      <span v-if="loadedAt" class="text-xs text-stone-400"> · ตรวจล่าสุด {{ loadedAt }}</span>
    </p>

    <h2 class="mt-5 text-sm font-semibold text-stone-800">ชื่อแอปที่ถือว่าเป็นแม่มณี</h2>
    <p class="mt-1 text-xs text-stone-500">ใช้ชื่อที่แสดงบนโทรศัพท์ (ไม่สนตัวพิมพ์) เพิ่มได้หลายชื่อ</p>
    <ul class="mt-2 flex flex-wrap gap-2">
      <li v-for="x in names" :key="x.name" class="flex items-center gap-1 rounded-full bg-brand-50 px-3 py-1 text-sm text-brand-800">
        {{ x.name }}
        <button type="button" class="ml-1 text-brand-700" :aria-label="'ลบ ' + x.name" @click="removeName(x.name)">×</button>
      </li>
    </ul>
    <form class="mt-2 flex gap-2" @submit.prevent="addName">
      <input v-model="newName" type="text" maxlength="100" placeholder="ชื่อแอป เช่น แม่มณี" class="input h-11 flex-1" />
      <button type="submit" class="btn-primary h-11" :disabled="!newName.trim()">เพิ่ม</button>
    </form>
    <p v-if="nameErr" class="mt-2 text-sm text-rose-700" role="alert">{{ nameErr }}</p>

    <h2 class="mt-5 text-sm font-semibold text-stone-800">แอปที่ส่งเข้ามา</h2>
    <p v-if="!byApp.length" class="mt-2 text-sm text-stone-500">ยังไม่มีคำขอเข้ามา</p>
    <div v-else class="mt-2 overflow-x-auto rounded-2xl border border-stone-200 bg-white">
      <table class="w-full text-left text-sm">
        <thead class="bg-stone-50 text-xs text-stone-500">
          <tr><th class="p-2">แอป</th><th class="p-2">ครั้ง</th><th class="p-2">บันทึกได้</th><th class="p-2">ล่าสุด</th><th class="p-2">เหตุผลล่าสุด</th></tr>
        </thead>
        <tbody>
          <tr v-for="a in byApp" :key="a.app" class="border-t border-stone-100">
            <td class="p-2"><div class="font-medium text-stone-800">{{ a.name || '-' }}</div><div class="text-xs text-stone-500 break-all">{{ a.app }}</div></td>
            <td class="p-2">{{ a.count }}</td>
            <td class="p-2">{{ a.stored }}</td>
            <td class="p-2 text-xs">{{ dateTime(a.last) }}</td>
            <td class="p-2 text-xs">{{ a.reason }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <h2 class="mt-5 text-sm font-semibold text-stone-800">ข้อความที่ส่งเข้ามาล่าสุด</h2>
    <p class="mt-1 text-xs text-stone-500">กดแถวเพื่อดูรายละเอียด · แสดง 50 รายการล่าสุด</p>
    <p v-if="!recentInbox.length" class="mt-2 text-sm text-stone-500">ยังไม่มีข้อความ</p>
    <ul v-else class="mt-2 space-y-2">
      <li v-for="r in recentInbox" :key="r.id" class="rounded-2xl border border-stone-200 bg-white">
        <button type="button" class="flex w-full items-start justify-between gap-2 p-3 text-left" :aria-expanded="openId === r.id" @click="toggle(r.id)">
          <span class="min-w-0">
            <span class="block text-sm font-medium text-stone-800">{{ r.app_name || r.app || '-' }}</span>
            <span class="block truncate text-xs text-stone-500">{{ masked(r.text) }}</span>
          </span>
          <span class="shrink-0 text-right">
            <span class="block rounded-full px-2 py-0.5 text-xs" :class="r.stored ? 'bg-emerald-50 text-emerald-700' : 'bg-stone-100 text-stone-600'">{{ r.stored ? 'บันทึกแล้ว' : 'ไม่บันทึก' }}</span>
            <span class="mt-1 block text-xs text-stone-400">{{ dateTime(r.received_at) }}</span>
          </span>
        </button>
        <dl v-if="openId === r.id" class="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-2 border-t border-stone-100 p-3 text-sm">
          <dt class="text-stone-500">เวลารับ</dt><dd>{{ dateTime(r.received_at) }}</dd>
          <dt class="text-stone-500">ชื่อแอป</dt><dd>{{ r.app_name || '-' }}</dd>
          <dt class="text-stone-500">รหัสแอป</dt><dd class="break-all">{{ r.app || '-' }}</dd>
          <dt class="text-stone-500">เหตุการณ์</dt><dd class="break-all">{{ r.event || '-' }}</dd>
          <dt class="text-stone-500">สถานะ</dt><dd>{{ r.stored ? 'บันทึกเป็นยอดรับแล้ว' : 'ไม่บันทึก' }}</dd>
          <dt class="text-stone-500">เหตุผล</dt><dd>{{ r.reason || '-' }}</dd>
          <dt class="text-stone-500">ข้อความ</dt><dd class="break-words whitespace-pre-wrap">{{ masked(r.text) || '-' }}</dd>
        </dl>
      </li>
    </ul>

    <h2 class="mt-5 text-sm font-semibold text-stone-800">รายการรับยอดล่าสุด</h2>
    <ul class="mt-2 space-y-2">
      <li v-for="r in rows" :key="r.id" class="rounded-2xl border border-stone-200 bg-white p-3">
        <div class="flex items-center justify-between">
          <span class="font-semibold text-stone-800">{{ money(r.amount) }}</span>
          <span class="text-xs text-stone-500">{{ dateTime(r.received_at) }}</span>
        </div>
        <div class="mt-1 text-xs text-stone-500">แอป: {{ r.app || '-' }}</div>
        <div class="mt-1 break-words text-sm text-stone-700">{{ masked(r.text) }}</div>
      </li>
    </ul>
  </ManageShell>
</template>
