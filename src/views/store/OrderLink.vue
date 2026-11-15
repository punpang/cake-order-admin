<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { db, openOrderLink, customerOrderView } from '../../data/store'
import { getSupabase, supabaseEnabled } from '../../lib/supabase'
import { staffState } from '../../lib/staffAuth'
import { LINK_ERROR } from '../../lib/orderLink'
import { startChatPing } from '../../lib/chatPing'
import CustomerOrderView from '../../components/CustomerOrderView.vue'
import AppIcon from '../../components/AppIcon.vue'

// หน้าออร์เดอร์ด้วยลิงก์ (สาธารณะ ไม่ต้องล็อกอิน) · ดู + ส่งสลิป/ขอขยายเวลาเท่านั้น · ไม่ส่ง referrer, ห้ามดัชนี
// ร้านเปลี่ยนออร์เดอร์ → สัญญาณ Realtime (ช่องของออร์เดอร์) → โหลดใหม่เงียบ ๆ · ไม่มีสัญญาณ = โหลดใหม่ทุก 60 วินาทีขณะแท็บเปิดอยู่
const POLL_OFF_MS = 60000
const route = useRoute()
const res = ref(null)
const metas = []
let ping = null
let pingTopic = ''
let pingTimer = null
let pollTimer = null
function meta(name, content) {
  const m = document.createElement('meta')
  m.name = name
  m.content = content
  document.head.appendChild(m)
  metas.push(m)
}
onMounted(() => {
  meta('referrer', 'no-referrer')
  meta('robots', 'noindex, nofollow')
  load(false)
  pollTimer = setInterval(() => { if (!document.hidden && !ping?.isLive()) load(true) }, POLL_OFF_MS)
})
// โหลดครั้งแรกแสดงสถานะกำลังโหลด · โหลดเงียบ (quiet) คงหน้าเดิมไว้ และไม่แสดงข้อผิดพลาดชั่วคราว
async function load(quiet) {
  if (!quiet) res.value = null
  const token = String(route.params.token || '')
  // โหมด Supabase + ไม่ใช่เบราว์เซอร์ของพนักงาน: ขอข้อมูลจากเซิร์ฟเวอร์ (ลิงก์เปิดข้ามเครื่องได้)
  if (supabaseEnabled && !staffState.staff) {
    const [{ fetchRemoteLink, injectRemoteLink }, { rowToOrder }] = await Promise.all([import('../../lib/remoteLink'), import('../../lib/ordersSync')])
    const r = await fetchRemoteLink(token, { refresh: !!quiet })
    if (quiet && (r?.netError || r?.blocked)) return
    if (r?.netError) return (res.value = { netError: true })
    if (r?.blocked) return (res.value = { error: r.error, blocked: true })
    if (r?.order) injectRemoteLink(db, r, rowToOrder)
    if (r?.orderTopic) watchOrder(r.orderTopic)
  }
  res.value = openOrderLink(token)
}
// ช่องของออร์เดอร์ (จากเซิร์ฟเวอร์หลังตรวจลิงก์แล้ว) · ถ้าค่าเปลี่ยน เลิกฟังช่องเดิมแล้วฟังช่องใหม่
function watchOrder(topic) {
  if (topic === pingTopic) return
  pingTopic = topic
  ping?.stop()
  ping = null
  getSupabase().then((c) => { if (c && pingTopic === topic) ping = startChatPing(c, topic, onOrderPing) }).catch(() => {})
}
// สัญญาณจากร้าน → โหลดใหม่เงียบ ๆ (สัญญาณที่มาถี่รวมเป็นครั้งเดียว)
function onOrderPing() {
  clearTimeout(pingTimer)
  pingTimer = setTimeout(() => load(true), 300)
}
onBeforeUnmount(() => {
  metas.forEach((m) => m.remove())
  clearInterval(pollTimer)
  clearTimeout(pingTimer)
  ping?.stop()
  ping = null
})
const o = computed(() => res.value?.order)
const ctx = computed(() => ({ token: String(route.params.token || '') }))
function refresh() {
  const v = customerOrderView(ctx.value)
  if (v) res.value = { ...res.value, order: v }
}
</script>

<template>
  <div class="mx-auto max-w-xl px-4 py-6">
    <div v-if="!res" class="flex flex-col items-center gap-3 py-16 text-stone-400"><span class="brand-ring lg" aria-hidden="true"></span>กำลังโหลด…</div>
    <div v-else-if="res.netError" class="card py-12 text-center" role="alert">
      <AppIcon name="alert" :size="28" class="mx-auto text-stone-300" />
      <p class="mt-3 font-medium text-stone-700">เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ในขณะนี้</p>
      <p class="mt-1 text-sm text-stone-500">ลิงก์ของคุณยังไม่ได้ตรวจสอบ ตรวจอินเทอร์เน็ตแล้วลองใหม่</p>
      <button type="button" class="btn-primary mt-4 h-11 px-6" @click="load(false)">ลองใหม่</button>
    </div>
    <div v-else-if="res.error" class="card py-12 text-center">
      <AppIcon name="alert" :size="28" class="mx-auto text-stone-300" />
      <p class="mt-3 font-medium text-stone-700">{{ res.error || LINK_ERROR }}</p>
      <p class="mt-1 text-sm text-stone-500">ขอลิงก์ใหม่ได้จากร้าน</p>
    </div>
    <template v-else>
      <CustomerOrderView :order="o" :ctx="ctx" @refresh="refresh" />
      <p class="mt-4 text-center text-xs text-stone-400">ลิงก์นี้ใช้ดูออร์เดอร์และแจ้งชำระเท่านั้น · จะหมดอายุเมื่อไม่ได้เปิดดูเกินกำหนด</p>
    </template>
  </div>
</template>
