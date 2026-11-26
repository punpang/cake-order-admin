<script setup>
// ประวัติ LINE: ดูอย่างเดียว · บอทตอบอัตโนมัติ ไม่มีช่องให้พนักงานพิมพ์ตอบลูกค้าใน LINE
import { onMounted, ref } from 'vue'
import ManageShell from '../../components/ManageShell.vue'
import { getSupabase, supabaseEnabled } from '../../lib/supabase'
import { dateTime } from '../../lib/format'

const users = ref([])
const picked = ref(null)
const msgs = ref([])
const busy = ref(false)
const err = ref('')

async function loadUsers() {
  if (!supabaseEnabled) return
  busy.value = true
  err.value = ''
  try {
    const c = await getSupabase()
    const r = await c.from('punpang_line_users')
      .select('line_user_id,display_name,followed,last_message_at')
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(100)
    if (r.error) throw r.error
    users.value = r.data || []
  } catch (e) {
    err.value = `โหลดรายชื่อไม่สำเร็จ: ${e.message || e}`
  } finally {
    busy.value = false
  }
}

async function open(u) {
  picked.value = u
  msgs.value = []
  err.value = ''
  try {
    const c = await getSupabase()
    const r = await c.from('punpang_line_messages')
      .select('direction,kind,text,source,created_at')
      .eq('line_user_id', u.line_user_id)
      .eq('direction', 'out')
      .order('created_at', { ascending: true })
      .limit(300)
    if (r.error) throw r.error
    msgs.value = r.data || []
  } catch (e) {
    err.value = `โหลดข้อความไม่สำเร็จ: ${e.message || e}`
  }
}

onMounted(loadUsers)
</script>

<template>
  <ManageShell narrow guard :toolbar="false" title="ประวัติ LINE" subtitle="ดูอย่างเดียว · บอทตอบอัตโนมัติ ไม่มีการตอบโดยพนักงาน">
    <p v-if="!supabaseEnabled" class="card text-sm text-stone-600">ยังไม่ได้เชื่อมฐานข้อมูล จึงยังไม่มีประวัติให้แสดง</p>
    <p v-if="err" class="text-sm text-danger-700">{{ err }}</p>
    <div v-if="supabaseEnabled" class="grid gap-3 md:grid-cols-[18rem_1fr]">
      <div class="card space-y-2">
        <h2 class="font-semibold text-stone-900">ผู้ใช้ LINE</h2>
        <p v-if="!users.length && !busy" class="text-sm text-stone-500">ยังไม่มีข้อความจาก LINE</p>
        <button
          v-for="u in users"
          :key="u.line_user_id"
          type="button"
          class="flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left"
          :class="picked?.line_user_id === u.line_user_id ? 'border-brand-500 bg-brand-50' : 'border-stone-200 bg-white'"
          @click="open(u)"
        >
          <span class="truncate font-medium text-stone-800">{{ u.display_name || 'ไม่ทราบชื่อ' }}</span>
          <span class="shrink-0 text-xs text-stone-500">{{ u.last_message_at ? dateTime(u.last_message_at) : '' }}</span>
        </button>
      </div>
      <div class="card space-y-2">
        <h2 class="font-semibold text-stone-900">{{ picked ? (picked.display_name || 'ไม่ทราบชื่อ') : 'เลือกผู้ใช้เพื่อดูประวัติ' }}</h2>
        <div v-for="(m, i) in msgs" :key="i" class="flex" :class="m.direction === 'out' ? 'justify-end' : 'justify-start'">
          <div class="max-w-[80%] rounded-2xl px-3 py-2 text-sm" :class="m.direction === 'out' ? 'bg-brand-100 text-stone-900' : 'bg-stone-100 text-stone-800'">
            <div class="whitespace-pre-wrap break-words">{{ m.text }}</div>
            <div class="mt-1 text-xs text-stone-500">{{ dateTime(m.created_at) }}<span v-if="m.direction === 'out' && m.source"> · {{ m.source }}</span></div>
          </div>
        </div>
      </div>
    </div>
  </ManageShell>
</template>
