<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { registerAccount } from '../../data/store'
import { phoneValid, phoneDigits } from '../../lib/format'
import PhoneInput from '../../components/PhoneInput.vue'
import PinInput from '../../components/PinInput.vue'
import OtpStep from '../../components/OtpStep.vue'
import AppIcon from '../../components/AppIcon.vue'
import CakeArt from '../../components/art/CakeArt.vue'

// สมัคร: กรอกเบอร์ → ยืนยัน OTP → (ชื่อ ถ้าเป็นเบอร์ใหม่) ตั้ง PIN
// เบอร์ที่ร้านมีในระบบอยู่แล้ว จะผูกกับลูกค้าเดิมหลังยืนยัน OTP (เห็นออร์เดอร์/คะแนนเดิม)
const router = useRouter()
const step = ref(1)
const phone = ref('')
const token = ref('')
const known = ref(false)
const name = ref('')
const pin = ref('')
const pin2 = ref('')
const agree = ref(false)
const error = ref('')
const busy = ref(false)

function toOtp() {
  error.value = ''
  if (!phoneValid(phone.value)) return (error.value = 'กรอกเบอร์โทรให้ถูกต้อง')
  step.value = 2
}
function verified(r) {
  token.value = r.token
  known.value = !!r.knownCustomer
  step.value = 3
}
async function submit() {
  error.value = ''
  if (!known.value && !name.value.trim()) return (error.value = 'กรอกชื่อ')
  if (pin.value !== pin2.value) return (error.value = 'PIN ที่ยืนยันไม่ตรงกัน')
  if (!agree.value) return (error.value = 'ต้องยอมรับนโยบายความเป็นส่วนตัวและเงื่อนไขการใช้งาน')
  busy.value = true
  const r = await registerAccount({ token: token.value, phone: phoneDigits(phone.value), name: name.value, pin: pin.value, consent: agree.value })
  busy.value = false
  if (r.ok) router.replace('/account')
  else error.value = r.error
}
</script>

<template>
  <div class="mx-auto max-w-sm px-4 pt-8">
    <div class="relative mx-auto mb-3 h-24 w-28 overflow-hidden rounded-[2rem] shadow-md" aria-hidden="true"><CakeArt kind="cream" /></div>
    <h1 class="text-center text-[28px] text-stone-900">สมัครสมาชิก</h1>
    <p class="mt-1 text-center text-sm text-stone-600">ขั้นตอน {{ step }} จาก 3</p>
    <div class="mx-auto mt-2 flex max-w-48 gap-1.5" aria-hidden="true"><span v-for="n in 3" :key="n" class="h-2 flex-1 rounded-full" :class="n <= step ? 'bg-brand-500' : 'bg-stone-200'"></span></div>
    <div class="card mt-5">
      <form v-if="step === 1" class="space-y-4" @submit.prevent="toOtp">
        <div><label class="label">เบอร์โทร</label><PhoneInput v-model="phone" /></div>
        <p v-if="error" class="flex items-center gap-2 text-sm text-rose-600"><AppIcon name="alert" :size="16" /> {{ error }}</p>
        <button class="btn-primary w-full">ขอรหัสยืนยัน (OTP)</button>
        <p class="text-center text-sm text-stone-500">มีบัญชีแล้ว? <RouterLink to="/account/login" class="text-brand-700 underline">เข้าสู่ระบบ</RouterLink></p>
      </form>

      <OtpStep v-else-if="step === 2" :phone="phoneDigits(phone)" purpose="register" @verified="verified" @cancel="step = 1" />

      <form v-else class="space-y-4" @submit.prevent="submit">
        <p v-if="known" class="rounded-xl bg-brand-50 p-3 text-sm text-brand-800">พบข้อมูลลูกค้าของเบอร์นี้ในร้านแล้ว บัญชีจะผูกกับข้อมูลเดิม</p>
        <div v-else><label class="label">ชื่อ <span class="text-rose-500">*</span></label><input v-model="name" class="input" maxlength="100" autocomplete="name" /></div>
        <div><label class="label">ตั้ง PIN 6 หลัก</label><PinInput v-model="pin" autocomplete="new-password" /></div>
        <div><label class="label">ยืนยัน PIN</label><PinInput v-model="pin2" autocomplete="new-password" /></div>
        <p class="text-xs text-stone-400">ห้ามใช้ PIN ที่เดาง่าย เช่น 111111, 123456 หรือเลขท้ายเบอร์โทร</p>
        <label class="flex items-start gap-2 text-sm text-stone-700">
          <input v-model="agree" type="checkbox" class="mt-0.5 h-5 w-5 shrink-0 accent-brand-600" />
          <span>ฉันได้อ่านและยอมรับ <RouterLink to="/legal/privacy" target="_blank" class="text-brand-700 underline">นโยบายความเป็นส่วนตัว (PDPA)</RouterLink> และ <RouterLink to="/legal/terms" target="_blank" class="text-brand-700 underline">เงื่อนไขการใช้งาน</RouterLink> (รวมกติกาคะแนนสะสม)</span>
        </label>
        <p v-if="error" class="flex items-center gap-2 text-sm text-rose-600"><AppIcon name="alert" :size="16" /> {{ error }}</p>
        <button class="btn-primary w-full" :disabled="busy">{{ busy ? 'กำลังสมัคร…' : 'สมัครสมาชิก' }}</button>
      </form>
    </div>
  </div>
</template>
