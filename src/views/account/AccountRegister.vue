<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { registerAccount } from '../../data/store'
import { phoneValid, phoneDigits } from '../../lib/format'
import PhoneInput from '../../components/PhoneInput.vue'
import PinInput from '../../components/PinInput.vue'
import OtpStep from '../../components/OtpStep.vue'
import AppIcon from '../../components/AppIcon.vue'

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
  busy.value = true
  const r = await registerAccount({ token: token.value, phone: phoneDigits(phone.value), name: name.value, pin: pin.value })
  busy.value = false
  if (r.ok) router.replace('/account')
  else error.value = r.error
}
</script>

<template>
  <div class="mx-auto max-w-sm px-4 pt-10">
    <h1 class="text-2xl font-semibold text-stone-900">สมัครสมาชิก</h1>
    <p class="mt-1 text-sm text-stone-500">ขั้นตอน {{ step }} จาก 3</p>
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
        <p v-if="error" class="flex items-center gap-2 text-sm text-rose-600"><AppIcon name="alert" :size="16" /> {{ error }}</p>
        <button class="btn-primary w-full" :disabled="busy">สมัครสมาชิก</button>
      </form>
    </div>
  </div>
</template>
