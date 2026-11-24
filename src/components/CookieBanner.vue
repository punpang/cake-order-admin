<script setup>
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { db, recordCookieConsent } from '../data/store'
import { cookieUi, readCookieConsent, writeCookieConsent, cookieNeedsAsk } from '../lib/consent'
import AppSwitch from './AppSwitch.vue'

// แบนเนอร์คุกกี้ (หน้าร้าน/ระบบลูกค้า): ไม่ใช้คุกกี้ที่ไม่จำเป็นจนกว่าจะยินยอม · มีเพียงคุกกี้วิเคราะห์ (แนะนำแบบเค้ก) ที่ต้องยินยอมก่อน
const version = computed(() => db.legal.docs.cookie.version)
const pending = ref(cookieNeedsAsk(readCookieConsent(), version.value))
const detail = ref(false)
const pick = reactive({ analytics: false })
const visible = computed(() => pending.value || cookieUi.open)

watch(
  () => cookieUi.open,
  (o) => {
    if (!o) return
    const c = readCookieConsent()
    Object.assign(pick, { analytics: !!c?.analytics })
    detail.value = true
  },
)
watch(version, () => (pending.value = cookieNeedsAsk(readCookieConsent(), version.value)))

// บอกตำแหน่งขอบบนของแถบให้ปุ่มลอย (แชท) ขยับหนี ไม่ให้แถบบังปุ่ม · วัดใหม่เมื่อแถบเปลี่ยนขนาดหรือหมุนจอ
const el = ref(null)
const measure = () => {
  cookieUi.top = el.value ? Math.max(0, Math.round(window.innerHeight - el.value.getBoundingClientRect().top)) : 0
  // เว้นที่ท้ายหน้าเท่าความสูงแถบ เพื่อเลื่อนดูเนื้อหา/ปุ่มที่อยู่ใต้แถบได้ (เช่น ลิงก์สมัครสมาชิก)
  document.body.style.paddingBottom = cookieUi.top ? `${cookieUi.top}px` : ''
}
const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
watch(el, (n, o) => {
  if (o) ro?.unobserve(o)
  if (n) ro?.observe(n)
  nextTick(measure)
  if (!n) { cookieUi.top = 0; document.body.style.paddingBottom = '' }
})
window.addEventListener('resize', measure)
onBeforeUnmount(() => {
  ro?.disconnect()
  window.removeEventListener('resize', measure)
  cookieUi.top = 0
  document.body.style.paddingBottom = ''
})

function save(choice) {
  const c = writeCookieConsent(version.value, choice)
  recordCookieConsent(c)
  pending.value = false
  cookieUi.open = false
  detail.value = false
}
</script>

<template>
  <section v-if="visible" ref="el" class="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-40 px-3 pb-2 sm:px-3 sm:pb-2 md:bottom-0 md:pb-[calc(env(safe-area-inset-bottom)+0.5rem)]" role="region" aria-label="การตั้งค่าคุกกี้">
    <div class="mx-auto max-w-4xl rounded-3xl bg-matcha-soft p-2.5 shadow-2xl sm:grid sm:grid-cols-[1fr_auto] sm:items-center sm:gap-x-4 sm:p-2.5">
      <!-- เดสก์ท็อปแสดงประโยคเต็มพร้อมหัวข้อ · มือถือใช้ประโยคสั้นที่ยังบอกทางเลือกคุกกี้วิเคราะห์ก่อนกดยอมรับ เพื่อให้แถบเตี้ย -->
      <p class="text-sm text-stone-800">
        <!-- มือถือ: ซ่อนหัวข้อ ใช้ประโยคสั้นที่ยังบอกครบทั้งคุกกี้ที่จำเป็นและคุกกี้วิเคราะห์ที่เลือกได้ (แถบบางลง ไม่บังปุ่มหลักของหน้า) -->
        <span class="max-sm:hidden"><b class="font-display text-stone-900">เว็บไซต์นี้ใช้คุกกี้</b> · </span>
        <span class="sm:hidden">ใช้คุกกี้ที่จำเป็น · เลือกเปิดคุกกี้วิเคราะห์ได้</span>
        <span class="max-sm:hidden">ใช้คุกกี้ที่จำเป็นเพื่อให้เว็บทำงาน · วิเคราะห์เปิดเองได้</span>
        <RouterLink to="/legal/cookie" class="ml-1 inline-block py-3 -my-3 font-medium text-stone-900 underline"><span class="sm:hidden">นโยบาย</span><span class="max-sm:hidden">อ่านนโยบายคุกกี้</span></RouterLink>
      </p>
      <div v-if="detail" class="mt-3 space-y-2.5 rounded-xl bg-white/70 p-3 text-sm">
        <div class="flex items-center justify-between gap-3"><span><b>จำเป็น</b> · เปิดตลอด</span><span class="rounded-full bg-stone-200 px-2 py-0.5 text-xs">เปิด</span></div>
        <div class="flex items-center justify-between gap-3"><span><b>วิเคราะห์</b> · ช่วยแนะนำแบบเค้กจากการดูของคุณ</span><AppSwitch v-model="pick.analytics" /></div>
      </div>
      <div class="mt-2 flex flex-wrap gap-2 sm:row-span-2 sm:mt-0 sm:justify-end">
        <button class="btn-primary min-w-0 flex-1 basis-0 border-2! border-choco! bg-choco! px-2 hover:bg-stone-700! h-11 sm:min-w-36 sm:flex-none" @click="save({ analytics: true })">ยอมรับทั้งหมด</button>
        <button class="btn-outline min-w-0 flex-1 basis-0 border-2! border-stone-800! bg-white! px-2 text-stone-900! h-11 sm:min-w-36 sm:flex-none" title="ใช้เฉพาะคุกกี้ที่จำเป็น" @click="save({ analytics: false })">ปฏิเสธ</button>
        <button v-if="!detail" class="btn-outline border-0! max-sm:h-11" @click="detail = true">ตั้งค่า</button>
        <button v-else class="btn-outline border-0!" @click="save({ ...pick })">บันทึกการเลือก</button>
      </div>
    </div>
  </section>
</template>
