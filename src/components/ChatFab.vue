<script setup>
// ปุ่มแชทลอยมุมขวาล่างของหน้าร้าน · กดแล้วเปิดแผงแชทกับร้าน (ใช้ AccountChat ตัวเดิม)
// ลูกค้าที่ยังไม่เข้าสู่ระบบจะเห็นปุ่มให้ไปเข้าสู่ระบบในแผงเดียวกัน
// ลิงก์ #/?chat=1 (ปุ่มใน rich menu) เปิดแผงนี้ทันที
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { customerSession } from '../data/store'
import AccountChat from '../views/account/AccountChat.vue'
import AppIcon from './AppIcon.vue'

const route = useRoute()
const router = useRouter()
const open = ref(false)
const loggedIn = computed(() => !!customerSession.customerId)

function show() { open.value = true }
function hide() { open.value = false }
function onKey(e) { if (e.key === 'Escape' && open.value) hide() }

// เปิดแผงเมื่อเข้าจากลิงก์ ?chat=1 (แล้วล้างพารามิเตอร์ออกจาก URL)
function fromLink() {
  if (route.query.chat !== '1') return
  show()
  const q = { ...route.query }
  delete q.chat
  router.replace({ path: route.path, query: q, hash: '' }).catch(() => {})
}

watch(() => route.query.chat, (v) => { if (v === '1') fromLink() })

onMounted(() => {
  fromLink()
  document.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => document.removeEventListener('keydown', onKey))
</script>

<template>
  <button
    v-if="!open"
    type="button"
    class="fixed right-4 bottom-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-brand-600 text-white shadow-lg shadow-brand-600/30 transition hover:bg-brand-700 focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-300 bottom-40 sm:right-6 sm:bottom-6"
    aria-label="แชทกับร้าน"
    @click="show"
  >
    <AppIcon name="chat" :size="26" />
  </button>

  <div v-if="open" class="fixed inset-0 z-50 sm:inset-auto sm:right-6 sm:bottom-6" role="dialog" aria-modal="false" aria-label="แชทกับร้าน">
    <div class="flex h-full flex-col overflow-hidden bg-cream shadow-2xl sm:h-[600px] sm:w-[380px] sm:rounded-3xl sm:border sm:border-stone-200">
      <div class="flex shrink-0 items-center justify-between border-b border-stone-200 bg-white px-4 py-3">
        <h2 class="font-display text-lg text-stone-900">แชทกับร้าน</h2>
        <button type="button" class="rounded-full p-2 text-stone-600 hover:bg-stone-100" aria-label="ปิดแชท" @click="hide">
          <AppIcon name="x" :size="20" />
        </button>
      </div>

      <div v-if="loggedIn" class="flex min-h-0 flex-1 flex-col">
        <AccountChat />
      </div>
      <div v-else class="card m-4 space-y-3 text-center">
        <p class="text-stone-700">เข้าสู่ระบบด้วยเบอร์และ PIN เพื่อคุยกับร้าน</p>
        <RouterLink to="/account/login" class="btn-primary block w-full" @click="hide">เข้าสู่ระบบ</RouterLink>
      </div>
    </div>
  </div>
</template>
