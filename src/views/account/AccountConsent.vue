<script setup>
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { db, needsConsent, acceptConsent, customerLogout } from '../../data/store'
import { LEGAL_KINDS } from '../../lib/legalDefaults'
import LegalText from '../../components/LegalText.vue'

// เอกสารเวอร์ชันใหม่ → ต้องกดยอมรับก่อนใช้บัญชีต่อ (ไม่ยอมรับ = ออกจากระบบ)
const router = useRouter()
const kinds = computed(() => needsConsent())
const agree = ref(false)
const open = ref(null)
const err = ref('')
const busy = ref(false)
async function accept() {
  if (!agree.value || busy.value) return
  busy.value = true
  const r = await acceptConsent('reconsent')
  busy.value = false
  if (r.error) return (err.value = r.error)
  router.replace('/account')
}
function decline() {
  customerLogout()
  router.replace('/')
}
</script>

<template>
  <div class="mx-auto max-w-lg px-4 pt-8">
    <h1 class="text-[22px] text-stone-900">ขอให้ทบทวนและยอมรับก่อนใช้งานต่อ</h1>
    <p class="mt-1 text-sm text-stone-500">ร้านปรับปรุงเอกสารด้านล่าง กรุณาอ่านและยอมรับเพื่อใช้บัญชีต่อ</p>
    <div class="mt-4 space-y-2">
      <div v-for="k in kinds" :key="k" class="card p-0">
        <button type="button" class="flex w-full items-center justify-between gap-3 px-4 py-3 text-left" @click="open = open === k ? null : k">
          <span><b class="text-stone-900">{{ LEGAL_KINDS[k].label }}</b><span class="block text-xs text-stone-400">เวอร์ชัน {{ db.legal.docs[k].version }}</span></span>
          <span class="text-sm text-brand-700">{{ open === k ? 'ซ่อน' : 'อ่าน' }}</span>
        </button>
        <div v-if="open === k" class="max-h-80 overflow-y-auto border-t border-stone-100 px-4 py-3"><LegalText :kind="k" /></div>
      </div>
      <p v-if="!kinds.length" class="card text-center text-sm text-stone-500">ไม่มีเอกสารที่ต้องยอมรับ <RouterLink to="/account" class="text-brand-700 underline">ไปหน้าบัญชี</RouterLink></p>
    </div>
    <template v-if="kinds.length">
      <label class="mt-3 flex items-start gap-2 py-1.5 text-sm text-stone-700"><input v-model="agree" type="checkbox" class="mt-0.5 h-5 w-5 shrink-0 accent-brand-600" /> ฉันได้อ่านและยอมรับเอกสารข้างต้น</label>
      <p v-if="err" class="mt-2 text-sm text-rose-700">{{ err }}</p>
      <div class="mt-4 flex gap-2">
        <button class="btn-outline flex-1" @click="decline">ไม่ยอมรับ (ออกจากระบบ)</button>
        <button class="btn-primary flex-1" :disabled="!agree || busy" @click="accept">{{ busy ? 'กำลังบันทึก…' : 'ยอมรับและใช้งานต่อ' }}</button>
      </div>
    </template>
  </div>
</template>
