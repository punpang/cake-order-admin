<script setup>
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { resetPin } from '../../data/store'
import { phoneValid, phoneDigits } from '../../lib/format'
import { safeNext } from '../../lib/safeUrl'
import PhoneInput from '../../components/PhoneInput.vue'
import PinInput from '../../components/PinInput.vue'
import OtpStep from '../../components/OtpStep.vue'
import AppIcon from '../../components/AppIcon.vue'
import CakeArt from '../../components/art/CakeArt.vue'

// ลืม PIN: กรอกเบอร์ → ยืนยัน OTP → ตั้ง PIN ใหม่ (ปลดล็อกบัญชีด้วย)
const router = useRouter()
const route = useRoute()
// ตั้ง PIN ใหม่แล้วกลับไปเข้าสู่ระบบ โดยคง next ไว้ (เช่น มาจากหน้าเชื่อมบัญชี LINE)
const next = computed(() => safeNext(route.query.next))
const step = ref(1)
const phone = ref('')
const token = ref('')
const pin = ref('')
const pin2 = ref('')
const error = ref('')
const busy = ref(false)

function toOtp() {
  error.value = ''
  if (!phoneValid(phone.value)) return (error.value = 'กรอกเบอร์โทรให้ถูกต้อง')
  step.value = 2
}
async function submit() {
  error.value = ''
  if (pin.value !== pin2.value) return (error.value = 'PIN ที่ยืนยันไม่ตรงกัน')
  busy.value = true
  const r = await resetPin({ token: token.value, phone: phoneDigits(phone.value), pin: pin.value })
  busy.value = false
  if (r.ok) router.replace({ path: '/account/login', query: next.value ? { next: next.value } : {} })
  else error.value = r.error
}
</script>

<template>
  <div class="mx-auto max-w-sm px-4 pt-10">
    <div class="relative mx-auto mb-3 h-24 w-28 overflow-hidden rounded-[2rem] shadow-md" aria-hidden="true"><CakeArt kind="piped" /></div>
    <h1 class="text-center text-[28px] text-stone-900">ลืม PIN</h1>
    <div class="card mt-5">
      <form v-if="step === 1" class="space-y-4" @submit.prevent="toOtp">
        <div><label class="label">เบอร์โทรที่สมัครไว้</label><PhoneInput v-model="phone" /></div>
        <p v-if="error" class="flex items-center gap-2 text-sm text-danger-700"><AppIcon name="alert" :size="16" /> {{ error }}</p>
        <button class="btn-primary w-full">ขอรหัสยืนยัน (OTP)</button>
        <p class="text-center text-sm"><RouterLink :to="{ path: '/account/login', query: next ? { next } : {} }" class="inline-flex min-h-11 items-center text-stone-500 underline">กลับไปเข้าสู่ระบบ</RouterLink></p>
      </form>
      <OtpStep v-else-if="step === 2" :phone="phoneDigits(phone)" purpose="reset" @verified="(r) => { token = r.token; step = 3 }" @cancel="step = 1" />
      <form v-else class="space-y-4" @submit.prevent="submit">
        <div><label class="label">PIN ใหม่ 6 หลัก</label><PinInput v-model="pin" autocomplete="new-password" /></div>
        <div><label class="label">ยืนยัน PIN ใหม่</label><PinInput v-model="pin2" autocomplete="new-password" /></div>
        <p v-if="error" class="flex items-center gap-2 text-sm text-danger-700"><AppIcon name="alert" :size="16" /> {{ error }}</p>
        <button class="btn-primary w-full" :disabled="busy">{{ busy ? 'กำลังบันทึก…' : 'ตั้ง PIN ใหม่' }}</button>
      </form>
    </div>
  </div>
</template>
