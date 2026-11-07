<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { loginPin } from '../../data/store'
import { phoneValid, phoneDigits } from '../../lib/format'
import { isPin } from '../../lib/customerAuth'
import PhoneInput from '../../components/PhoneInput.vue'
import PinInput from '../../components/PinInput.vue'
import AppIcon from '../../components/AppIcon.vue'
import CakeArt from '../../components/art/CakeArt.vue'

// เข้าสู่ระบบลูกค้า: เบอร์โทร + PIN 6 หลัก
const router = useRouter()
const phone = ref('')
const pin = ref('')
const error = ref('')
const busy = ref(false)
async function submit() {
  error.value = ''
  if (!phoneValid(phone.value)) return (error.value = 'กรอกเบอร์โทรให้ถูกต้อง')
  if (!isPin(pin.value)) return (error.value = 'PIN ต้องเป็นตัวเลข 6 หลัก')
  busy.value = true
  const r = await loginPin(phoneDigits(phone.value), pin.value)
  busy.value = false
  if (r.ok) router.replace('/account')
  else {
    error.value = r.error
    pin.value = ''
  }
}
</script>

<template>
  <div class="mx-auto max-w-sm px-4 pt-8">
    <div class="relative mx-auto mb-3 h-24 w-28 overflow-hidden rounded-[2rem] shadow-md" aria-hidden="true"><CakeArt kind="strawberry" /></div>
    <h1 class="text-center text-[28px] text-stone-900">เข้าสู่ระบบ</h1>
    <p class="mt-1 text-center text-sm text-stone-600">ดูออร์เดอร์ คะแนนสะสม และจัดการข้อมูลของคุณ</p>
    <form class="card mt-5 space-y-4" @submit.prevent="submit">
      <div><label class="label">เบอร์โทร</label><PhoneInput v-model="phone" /></div>
      <div><label class="label">PIN 6 หลัก</label><PinInput v-model="pin" /></div>
      <p v-if="error" class="flex items-center gap-2 text-sm text-rose-600"><AppIcon name="alert" :size="16" /> {{ error }}</p>
      <button class="btn-primary w-full" :disabled="busy">เข้าสู่ระบบ</button>
      <div class="flex justify-between text-sm">
        <RouterLink to="/account/forgot" class="text-stone-500 underline">ลืม PIN</RouterLink>
        <RouterLink to="/account/register" class="text-brand-700 underline">สมัครสมาชิก</RouterLink>
      </div>
    </form>
  </div>
</template>
