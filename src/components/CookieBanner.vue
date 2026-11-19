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
  <section v-if="visible" ref="el" class="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-40 p-3 md:bottom-0 md:pb-[calc(env(safe-area-inset-bottom)+0.75rem)]" role="region" aria-label="การตั้งค่าคุกกี้">
    <div class="mx-auto max-w-2xl rounded-3xl bg-matcha-soft p-3.5 shadow-2xl sm:p-4">
      <!-- ประโยคเดียวกันทุกขนาดจอ เพื่อให้เห็นทางเลือกคุกกี้วิเคราะห์ก่อนกดยอมรับ · หัวข้ออยู่ในบรรทัดเดียวกับคำอธิบาย ให้แถบเตี้ย -->
      <p class="text-sm text-stone-800">
        <b class="font-display text-stone-900">เว็บไซต์นี้ใช้คุกกี้</b> ·
        เราใช้คุกกี้ที่จำเป็นเพื่อให้เว็บทำงาน และคุกกี้วิเคราะห์ที่คุณเลือกเปิดเองได้
        <RouterLink to="/legal/cookie" class="ml-1 font-medium text-stone-900 underline">อ่านนโยบายคุกกี้</RouterLink>
      </p>
      <div v-if="detail" class="mt-3 space-y-2.5 rounded-xl bg-white/70 p-3 text-sm">
        <div class="flex items-center justify-between gap-3"><span><b>จำเป็น</b> · เปิดตลอด</span><span class="rounded-full bg-stone-200 px-2 py-0.5 text-xs">เปิด</span></div>
        <div class="flex items-center justify-between gap-3"><span><b>วิเคราะห์</b> · ช่วยแนะนำแบบเค้กจากการดูของคุณ</span><AppSwitch v-model="pick.analytics" /></div>
      </div>
      <div class="mt-2.5 flex flex-wrap gap-2 sm:mt-3">
        <button class="btn-primary flex-1 bg-choco! hover:bg-stone-700!" @click="save({ analytics: true })">ยอมรับทั้งหมด</button>
        <button class="btn-outline flex-1 border-0!" title="ใช้เฉพาะคุกกี้ที่จำเป็น" @click="save({ analytics: false })">ปฏิเสธ</button>
        <button v-if="!detail" class="btn-outline border-0!" @click="detail = true">ตั้งค่า</button>
        <button v-else class="btn-outline border-0!" @click="save({ ...pick })">บันทึกการเลือก</button>
      </div>
    </div>
  </section>
</template>
