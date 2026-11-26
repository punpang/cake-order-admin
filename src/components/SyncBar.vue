<script setup>
import { computed, ref, watch, onBeforeUnmount } from 'vue'
import { syncSummary, syncOnline, syncRetryAll, syncRealtime, queuedNotices, ackQueuedNotices } from '../lib/syncStatus'
import { staffState, reloadStaffData } from '../lib/staffAuth'
import { supabaseEnabled } from '../lib/supabase'

// แถบสถานะการบันทึก/โหลดข้อมูลกับเซิร์ฟเวอร์ (หลังบ้าน โหมด Supabase) — ซ่อนเมื่อทุกอย่างตรงกับเซิร์ฟเวอร์แล้ว
const sum = computed(() => syncSummary.value)
const loadFailed = computed(() => staffState.loadFailed || [])
const rtDown = computed(() => syncRealtime.state === 'down')
// กำลังบันทึก/รอบันทึก: แสดงแถบเมื่อค้างเกิน 1.5 วินาทีเท่านั้น (งานที่เสร็จเร็วไม่ต้องกะพริบ)
const busy = computed(() => sum.value.state === 'pending' || sum.value.state === 'saving')
const slow = ref(false)
let slowTimer = 0
watch(busy, (on) => {
  clearTimeout(slowTimer)
  slow.value = false
  if (on) slowTimer = setTimeout(() => { slow.value = true }, 1500)
}, { immediate: true })
onBeforeUnmount(() => clearTimeout(slowTimer))
const legacyShow = computed(() => !!(supabaseEnabled && (loadFailed.value.length || !syncOnline.online || (busy.value ? slow.value : (sum.value.state !== 'idle' || rtDown.value)))))
// แถบค้าง: รหัสออร์เดอร์ที่เข้าคิวผู้จัดการจากเครื่องนี้ (รหัสเท่านั้น) จนกดรับทราบหรือออกจากระบบ
const notices = computed(() => queuedNotices.list)
const noticeCodes = computed(() => {
  const c = notices.value.map((x) => x.code)
  return c.length > 3 ? `${c.slice(0, 3).join(', ')} และอีก ${c.length - 3} รายการ` : c.join(', ')
})
const show = computed(() => supabaseEnabled && (legacyShow.value || notices.value.length > 0))
</script>

<template>
  <div v-if="show" class="sticky top-14 z-10 text-sm" data-sync-bar>
    <div v-if="notices.length" class="head-safe flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-danger-700 px-4 py-2 text-white" role="status" data-queued-notice>
      <span>ส่งเข้าคิวผู้จัดการแล้ว: {{ noticeCodes }}<span class="hidden sm:inline"> · ผู้จัดการจะตรวจก่อนส่งซ้ำหรือปิด</span></span>
      <button type="button" class="min-h-11 rounded-full bg-white px-4 text-xs font-semibold text-danger-800" @click="ackQueuedNotices">รับทราบ</button>
    </div>
    <template v-if="legacyShow">
      <div v-if="loadFailed.length" class="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-danger-700 px-4 py-2 text-white" role="alert">
        <span>โหลดข้อมูลจากเซิร์ฟเวอร์ไม่สำเร็จ ({{ loadFailed.join(', ') }}) · ข้อมูลที่เห็นอาจไม่ครบ</span>
        <button type="button" class="rounded-full bg-white px-3 py-1 text-xs font-semibold text-danger-800" @click="reloadStaffData">ลองโหลดใหม่</button>
      </div>
      <div v-else-if="!syncOnline.online" class="bg-amber-600 px-4 py-2 text-center text-white" role="status">ออฟไลน์ — ข้อมูลที่แก้จะบันทึกเมื่อกลับมาออนไลน์ (ยังไม่ขึ้นเซิร์ฟเวอร์)</div>
      <div v-else-if="sum.state === 'failed'" class="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-danger-700 px-4 py-2 text-white" role="alert">
        <span>บันทึกขึ้นเซิร์ฟเวอร์ไม่สำเร็จ ({{ sum.msgs.join(' · ') }}) · ระบบลองใหม่เอง</span>
        <button type="button" class="rounded-full bg-white px-3 py-1 text-xs font-semibold text-danger-800" @click="syncRetryAll">ลองใหม่ตอนนี้</button>
      </div>
      <div v-else-if="sum.state === 'idle' && rtDown" class="bg-amber-600 px-4 py-1.5 text-center text-xs text-white" role="status" data-rt-down>ข้อมูลสดขาดการเชื่อมต่อ — ระบบดึงข้อมูลใหม่ทุก 45 วินาทีแทน และจะเชื่อมต่อใหม่เอง</div>
      <div v-else class="flex items-center justify-center gap-2 bg-stone-800 px-4 py-1.5 text-xs text-white" role="status"><span class="brand-ring on-brand" aria-hidden="true"></span>{{ sum.state === 'saving' ? 'กำลังบันทึกขึ้นเซิร์ฟเวอร์…' : 'รอบันทึก…' }}</div>
    </template>
  </div>
</template>
