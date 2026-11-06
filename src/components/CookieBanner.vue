<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { db, recordCookieConsent } from '../data/store'
import { cookieUi, readCookieConsent, writeCookieConsent, cookieNeedsAsk } from '../lib/consent'
import AppSwitch from './AppSwitch.vue'

// แบนเนอร์คุกกี้ (หน้าร้าน/ระบบลูกค้า): ไม่ใช้คุกกี้ที่ไม่จำเป็นจนกว่าจะยินยอม · ปัจจุบันเว็บใช้เฉพาะที่จำเป็น
const version = computed(() => db.legal.docs.cookie.version)
const pending = ref(cookieNeedsAsk(readCookieConsent(), version.value))
const detail = ref(false)
const pick = reactive({ analytics: false, marketing: false })
const visible = computed(() => pending.value || cookieUi.open)

watch(
  () => cookieUi.open,
  (o) => {
    if (!o) return
    const c = readCookieConsent()
    Object.assign(pick, { analytics: !!c?.analytics, marketing: !!c?.marketing })
    detail.value = true
  },
)
watch(version, () => (pending.value = cookieNeedsAsk(readCookieConsent(), version.value)))

function save(choice) {
  const c = writeCookieConsent(version.value, choice)
  recordCookieConsent(c)
  pending.value = false
  cookieUi.open = false
  detail.value = false
}
</script>

<template>
  <section v-if="visible" class="fixed inset-x-0 bottom-0 z-40 p-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]" role="region" aria-label="การตั้งค่าคุกกี้">
    <div class="mx-auto max-w-2xl rounded-2xl border border-stone-200 bg-white p-4 shadow-2xl">
      <div class="font-semibold text-stone-900">เว็บไซต์นี้ใช้คุกกี้</div>
      <p class="mt-1 text-sm text-stone-600">
        เราใช้คุกกี้ที่จำเป็นเพื่อให้เว็บทำงานและจำการตั้งค่าของคุณ ตอนนี้ยังไม่มีคุกกี้วิเคราะห์หรือการตลาด หากเปิดใช้ในอนาคตจะขอความยินยอมก่อนเสมอ
        <RouterLink to="/legal/cookie" class="text-brand-700 underline">อ่านนโยบายคุกกี้</RouterLink>
      </p>
      <div v-if="detail" class="mt-3 space-y-2.5 rounded-xl bg-stone-50 p-3 text-sm">
        <div class="flex items-center justify-between gap-3"><span><b>จำเป็น</b> · เปิดตลอด</span><span class="rounded-full bg-stone-200 px-2 py-0.5 text-xs">เปิด</span></div>
        <div class="flex items-center justify-between gap-3"><span><b>วิเคราะห์</b> · ยังไม่ได้ใช้งาน</span><AppSwitch v-model="pick.analytics" /></div>
        <div class="flex items-center justify-between gap-3"><span><b>การตลาด</b> · ยังไม่ได้ใช้งาน</span><AppSwitch v-model="pick.marketing" /></div>
      </div>
      <div class="mt-3 flex flex-wrap gap-2">
        <button class="btn-primary flex-1" @click="save({ analytics: true, marketing: true })">ยอมรับทั้งหมด</button>
        <button class="btn-outline flex-1" @click="save({ analytics: false, marketing: false })">เฉพาะที่จำเป็น</button>
        <button v-if="!detail" class="btn-soft" @click="detail = true">ตั้งค่า</button>
        <button v-else class="btn-soft" @click="save({ ...pick })">บันทึกการเลือก</button>
      </div>
    </div>
  </section>
</template>
