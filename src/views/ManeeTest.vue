<script setup>
// หน้าทดสอบการรับยอดแม่มณี: แสดงรายการที่เข้ามาล่าสุด รีเฟรชอัตโนมัติ · เฉพาะพนักงานที่มีสิทธิ์ POS (ดูนโยบาย RLS)
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { supabaseEnabled, getSupabase } from '../lib/supabase'
import { dateTime, money } from '../lib/format'
import ManageShell from '../components/ManageShell.vue'

const rows = ref([])
const err = ref('')
const loadedAt = ref('')
let timer = null

// ปิดบังตัวเลขยาว 6 หลักขึ้นไป (เลขบัญชี/อ้างอิง) ก่อนแสดงผล
const masked = (t) => String(t ?? '').replace(/\d{6,}/g, '••••••')

async function load() {
  if (!supabaseEnabled) { err.value = 'โหมดจำลอง: ไม่ได้เชื่อม Supabase'; return }
  try {
    const c = await getSupabase()
    const r = await c.from('manee_transfers').select('id, amount, received_at, app, text, created_at').order('created_at', { ascending: false }).limit(20)
    if (r.error) { err.value = 'อ่านข้อมูลไม่ได้: ' + r.error.message; return }
    rows.value = r.data || []
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
  <ManageShell narrow :toolbar="false" title="ทดสอบรับยอดแม่มณี" subtitle="รายการที่เข้ามาล่าสุด · รีเฟรชทุก 5 วินาที">
    <p v-if="err" class="rounded-2xl bg-rose-50 p-3 text-sm text-rose-700" role="alert">{{ err }}</p>
    <p v-else class="text-sm text-stone-600">
      {{ count ? `พบ ${count} รายการล่าสุด` : 'ยังไม่มีรายการเข้ามา — โอนเงินเข้าบัญชีแล้วรอสักครู่' }}
      <span v-if="loadedAt" class="text-xs text-stone-400"> · ตรวจล่าสุด {{ loadedAt }}</span>
    </p>
    <ul class="mt-3 space-y-2">
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
