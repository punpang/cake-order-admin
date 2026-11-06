<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { openOrderLink, customerOrderView } from '../../data/store'
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
  res.value = openOrderLink(String(route.params.token || ''))
})
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
    <div v-if="!res" class="py-16 text-center text-stone-400">กำลังโหลด…</div>
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
