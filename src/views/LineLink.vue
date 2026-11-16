<script setup>
import { onMounted, ref } from 'vue'
import { loginPin } from '../data/store'
import { phoneValid, phoneDigits } from '../lib/format'
import { isPin } from '../lib/customerAuth'
import { initLiff, linkLine } from '../lib/line'
import { readSessionToken } from '../lib/customerRemote'
import PhoneInput from '../components/PhoneInput.vue'
import PinInput from '../components/PinInput.vue'

// เชื่อมบัญชี LINE กับบัญชีลูกค้า: เปิดจาก LINE → ยืนยันตัวกับ LINE → เข้าสู่ระบบด้วยเบอร์และ PIN → ผูกบัญชี
const phase = ref('loading') // loading | login | linking | done | error
const error = ref('')
const phone = ref('')
const pin = ref('')
const busy = ref(false)
let accessToken = ''

async function linkNow() {
  phase.value = 'linking'
  const r = await linkLine(accessToken)
  if (r.ok) return (phase.value = 'done')
  if (r.needLogin) return (phase.value = 'login')
  error.value = r.error
  phase.value = 'error'
}

onMounted(async () => {
  const r = await initLiff()
  if (!r.ok) {
    error.value = r.error
    phase.value = 'error'
    return
  }
  accessToken = r.accessToken
  if (readSessionToken()) await linkNow()
  else phase.value = 'login'
})

async function submit() {
  error.value = ''
  if (!phoneValid(phone.value)) return (error.value = 'กรอกเบอร์โทรให้ถูกต้อง')
  if (!isPin(pin.value)) return (error.value = 'PIN ต้องเป็นตัวเลข 6 หลัก')
  busy.value = true
  const r = await loginPin(phoneDigits(phone.value), pin.value)
  busy.value = false
  if (!r.ok) {
    error.value = r.error
    pin.value = ''
    return
  }
  await linkNow()
}
</script>

<template>
  <div class="mx-auto max-w-sm px-4 pt-8">
    <h1 class="text-center text-[26px] text-stone-900">เชื่อมบัญชี LINE</h1>

    <div v-if="phase === 'loading' || phase === 'linking'" class="card mt-5 text-center text-stone-600" role="status">
      {{ phase === 'linking' ? 'กำลังเชื่อมบัญชี LINE…' : 'กำลังเชื่อมกับ LINE…' }}
    </div>

    <form v-else-if="phase === 'login'" class="card mt-5 space-y-4" @submit.prevent="submit">
      <p class="text-sm text-stone-600">เข้าสู่ระบบด้วยเบอร์และ PIN เพื่อเชื่อมกับบัญชี LINE นี้ (ทำครั้งเดียว)</p>
      <div><label class="label">เบอร์โทร</label><PhoneInput v-model="phone" /></div>
      <div><label class="label">PIN 6 หลัก</label><PinInput v-model="pin" /></div>
      <p v-if="error" class="text-sm text-rose-700" role="alert">{{ error }}</p>
      <button class="btn-primary w-full" :disabled="busy">{{ busy ? 'กำลังเชื่อมบัญชี…' : 'เข้าสู่ระบบและเชื่อมบัญชี' }}</button>
    </form>

    <div v-else-if="phase === 'done'" class="card mt-5 space-y-3 text-center">
      <p class="font-semibold text-emerald-800">เชื่อมบัญชี LINE แล้วค่ะ</p>
      <RouterLink to="/account" class="btn-primary block w-full">ดูคะแนนและบัญชี</RouterLink>
      <RouterLink to="/menu" class="btn-outline block w-full">สั่งเค้ก</RouterLink>
    </div>

    <div v-else class="card mt-5 space-y-3 text-center">
      <p class="text-rose-700" role="alert">{{ error }}</p>
      <button class="btn-outline w-full" @click="$router.go(0)">ลองใหม่</button>
    </div>
  </div>
</template>
