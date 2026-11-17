<script setup>
// ปุ่มแชทลอยมุมขวาล่างของหน้าร้าน · กดแล้วเปิดแผงแชทกับร้าน (ใช้ AccountChat ตัวเดิม)
// ลูกค้าที่ยังไม่เข้าสู่ระบบจะเห็นปุ่มให้ไปเข้าสู่ระบบในแผงเดียวกัน
// ลิงก์ #/?chat=1 (ปุ่มใน rich menu) เปิดแผงนี้ทันที
import { computed, defineAsyncComponent, h, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { customerSession } from '../data/store'
import { cookieUi } from '../lib/consent'
import AppIcon from './AppIcon.vue'

// แถบคุกกี้แสดงอยู่: ยกปุ่มขึ้นไปเหนือแถบ (ไม่ให้ถูกบัง) · แถบปิดแล้วกลับตำแหน่งเดิม
const fabStyle = computed(() => (cookieUi.top > 0 ? { bottom: `${cookieUi.top + 4}px` } : null))

// โหลดโค้ดแชทเมื่อเปิดแผงครั้งแรกเท่านั้น (ไม่รวมในไฟล์หลักของหน้าร้าน → เปิดเว็บครั้งแรกเร็วขึ้น)
// โหลดไม่สำเร็จ (เน็ตหลุด) แสดงข้อความให้ปิดแล้วเปิดใหม่ · ระหว่างโหลดแสดง "กำลังเปิดแชท…"
const note = (text) => () => h('p', { class: 'flex flex-1 items-center justify-center px-6 text-center text-sm text-stone-500', role: 'status' }, text)
const AccountChat = defineAsyncComponent({
  loader: () => import('../views/account/AccountChat.vue'),
  loadingComponent: note('กำลังเปิดแชท…'),
  errorComponent: note('เปิดแชทไม่สำเร็จ กรุณาตรวจอินเทอร์เน็ต แล้วปิดและเปิดแชทอีกครั้ง'),
  delay: 150,
})

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

// หน้าเข้าสู่ระบบ/สมัคร/ลืม PIN/ยินยอม: ไม่แสดงปุ่มแชท (ไม่ให้ทับปุ่มหลักของหน้า) และปิดแผงถ้าเปิดค้างไว้
const onAuthPage = computed(() => /^\/account\/(login|register|forgot|consent)(\/|$)/.test(route.path))
watch(onAuthPage, (v) => { if (v) hide() })

onMounted(() => {
  fromLink()
  document.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => document.removeEventListener('keydown', onKey))
</script>

<template>
  <button
    v-if="!open && !onAuthPage"
    type="button"
    class="chat-fab fixed right-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-30 flex h-14 w-14 items-center justify-center rounded-full bg-brand-600 text-white shadow-lg shadow-brand-600/30 transition hover:bg-brand-700 focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-300 md:right-6 md:bottom-6"
    :style="fabStyle"
    aria-label="แชทกับร้าน"
    @click="show"
  >
    <AppIcon name="chat" :size="26" />
  </button>

  <div v-if="open" class="fixed inset-0 z-50 sm:inset-auto sm:right-6 sm:bottom-6" role="dialog" aria-modal="false" aria-labelledby="chat-panel-title">
    <div class="flex h-full flex-col overflow-hidden bg-cream sm:h-[600px] sm:w-[380px] sm:rounded-3xl sm:border sm:border-stone-200 sm:shadow-2xl">
      <header class="flex shrink-0 items-center gap-3 border-b border-stone-200 bg-white px-4 py-2.5">
        <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-100 text-brand-600">
          <AppIcon name="chat" :size="20" />
        </span>
        <div class="min-w-0 flex-1">
          <h2 id="chat-panel-title" class="font-display text-lg leading-tight text-stone-900">แชทกับร้าน</h2>
          <p class="truncate text-xs text-stone-500">ร้านจะตอบกลับในหน้านี้</p>
        </div>
        <button
          type="button"
          class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-stone-600 hover:bg-stone-100"
          aria-label="ปิดแชท"
          @click="hide"
        >
          <AppIcon name="x" :size="20" />
        </button>
      </header>

      <div v-if="loggedIn" class="flex min-h-0 flex-1 flex-col">
        <AccountChat />
      </div>
      <div v-else class="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <span class="flex h-16 w-16 items-center justify-center rounded-full bg-brand-100 text-brand-600">
          <AppIcon name="lock" :size="30" />
        </span>
        <p class="mt-4 font-display text-lg text-stone-900">เข้าสู่ระบบก่อนคุยกับร้าน</p>
        <p class="mt-1 text-sm text-stone-600">ใช้เบอร์โทรและ PIN ของคุณ</p>
        <RouterLink to="/account/login" class="btn-primary mt-5 w-full max-w-xs" @click="hide">เข้าสู่ระบบ</RouterLink>
      </div>
    </div>
  </div>
</template>
