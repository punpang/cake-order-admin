<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { db, openOrderLink, customerOrderView } from '../../data/store'
import { supabaseEnabled } from '../../lib/supabase'
import { staffState } from '../../lib/staffAuth'
import { LINK_ERROR } from '../../lib/orderLink'
import CustomerOrderView from '../../components/CustomerOrderView.vue'
import AppIcon from '../../components/AppIcon.vue'

// หน้าออร์เดอร์ด้วยลิงก์ (สาธารณะ ไม่ต้องล็อกอิน) · ดู + ส่งสลิป/ขอขยายเวลาเท่านั้น · ไม่ส่ง referrer, ห้ามดัชนี
const route = useRoute()
const res = ref(null)
const metas = []
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
  load()
})
async function load() {
  res.value = null
  const token = String(route.params.token || '')
  // โหมด Supabase + ไม่ใช่เบราว์เซอร์ของพนักงาน: ขอข้อมูลจากเซิร์ฟเวอร์ (ลิงก์เปิดข้ามเครื่องได้)
  if (supabaseEnabled && !staffState.staff) {
    const [{ fetchRemoteLink, injectRemoteLink }, { rowToOrder }] = await Promise.all([import('../../lib/remoteLink'), import('../../lib/ordersSync')])
    const r = await fetchRemoteLink(token)
    if (r?.netError) return (res.value = { netError: true })
    if (r?.blocked) return (res.value = { error: r.error, blocked: true })
    if (r?.order) injectRemoteLink(db, r, rowToOrder)
  }
  res.value = openOrderLink(token)
}
onBeforeUnmount(() => metas.forEach((m) => m.remove()))
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
      <button type="button" class="btn-primary mt-4 h-11 px-6" @click="load">ลองใหม่</button>
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
