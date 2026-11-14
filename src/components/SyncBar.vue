<script setup>
import { computed } from 'vue'
import { syncSummary, syncOnline, syncRetryAll, syncRealtime } from '../lib/syncStatus'
import { staffState, reloadStaffData } from '../lib/staffAuth'
import { supabaseEnabled } from '../lib/supabase'

// แถบสถานะการบันทึก/โหลดข้อมูลกับเซิร์ฟเวอร์ (หลังบ้าน โหมด Supabase) — ซ่อนเมื่อทุกอย่างตรงกับเซิร์ฟเวอร์แล้ว
const sum = computed(() => syncSummary.value)
const loadFailed = computed(() => staffState.loadFailed || [])
const rtDown = computed(() => syncRealtime.state === 'down')
const show = computed(() => supabaseEnabled && (loadFailed.value.length || !syncOnline.online || sum.value.state !== 'idle' || rtDown.value))
</script>

<template>
  <div v-if="show" class="sticky top-14 z-10 text-sm" data-sync-bar>
    <div v-if="loadFailed.length" class="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-rose-700 px-4 py-2 text-white" role="alert">
      <span>โหลดข้อมูลจากเซิร์ฟเวอร์ไม่สำเร็จ ({{ loadFailed.join(', ') }}) · ข้อมูลที่เห็นอาจไม่ครบ</span>
      <button type="button" class="rounded-full bg-white px-3 py-1 text-xs font-semibold text-rose-800" @click="reloadStaffData">ลองโหลดใหม่</button>
    </div>
    <div v-else-if="!syncOnline.online" class="bg-amber-600 px-4 py-2 text-center text-white" role="status">ออฟไลน์ — ข้อมูลที่แก้จะบันทึกเมื่อกลับมาออนไลน์ (ยังไม่ขึ้นเซิร์ฟเวอร์)</div>
    <div v-else-if="sum.state === 'failed'" class="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-rose-700 px-4 py-2 text-white" role="alert">
      <span>บันทึกขึ้นเซิร์ฟเวอร์ไม่สำเร็จ ({{ sum.msgs.join(' · ') }}) · ระบบลองใหม่เอง</span>
      <button type="button" class="rounded-full bg-white px-3 py-1 text-xs font-semibold text-rose-800" @click="syncRetryAll">ลองใหม่ตอนนี้</button>
    </div>
    <div v-else-if="sum.state === 'idle' && rtDown" class="bg-amber-600 px-4 py-1.5 text-center text-xs text-white" role="status" data-rt-down>ข้อมูลสดขาดการเชื่อมต่อ — ระบบดึงข้อมูลใหม่ทุก 45 วินาทีแทน และจะเชื่อมต่อใหม่เอง</div>
    <div v-else class="flex items-center justify-center gap-2 bg-stone-800 px-4 py-1.5 text-xs text-white" role="status"><span class="brand-ring on-brand" aria-hidden="true"></span>{{ sum.state === 'saving' ? 'กำลังบันทึกขึ้นเซิร์ฟเวอร์…' : 'รอบันทึก…' }}</div>
  </div>
</template>
