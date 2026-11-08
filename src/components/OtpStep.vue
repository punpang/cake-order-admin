<script setup>
import { onMounted, onUnmounted, ref } from 'vue'
import { requestOtp, verifyOtp } from '../data/store'
import { OTP, OTP_PURPOSE } from '../lib/customerAuth'
import { formatPhone } from '../lib/format'
import AppIcon from './AppIcon.vue'

// ขั้นยืนยัน OTP: ขอรหัสอัตโนมัติเมื่อเปิด → กรอกรหัส 6 หลัก → ส่ง token ให้ขั้นถัดไป
// โหมดจำลอง: แสดงรหัสบนจอ · โหมดออนไลน์: เซิร์ฟเวอร์ส่ง SMS จริงและไม่คืนรหัส (ไม่มี simCode → ไม่แสดงกล่องจำลอง)
const props = defineProps({ phone: { type: String, default: '' }, purpose: { type: String, required: true } })
const emit = defineEmits(['verified', 'cancel'])

const code = ref('')
const error = ref('')
const sim = ref('')
const sentTo = ref('')
const fatal = ref(false)
const wait = ref(0)
let timer = null

function tick(sec) {
  wait.value = sec
  clearInterval(timer)
  timer = setInterval(() => {
    wait.value = Math.max(0, wait.value - 1)
    if (!wait.value) clearInterval(timer)
  }, 1000)
}
async function send() {
  const r = await requestOtp(props.phone, props.purpose)
  if (r.ok) {
    sim.value = r.simCode || ''
    sentTo.value = r.phone
    error.value = ''
    code.value = ''
    fatal.value = false
    tick(Math.ceil(OTP.resendMs / 1000))
  } else {
    error.value = r.error
    if (r.wait) tick(r.wait)
    else if (!sentTo.value) fatal.value = true
  }
}
async function submit() {
  const r = await verifyOtp(props.phone, props.purpose, code.value)
  if (r.ok) return emit('verified', r)
  error.value = r.error
  code.value = ''
}
onMounted(send)
onUnmounted(() => clearInterval(timer))
</script>

<template>
  <div class="space-y-4">
    <p class="text-sm text-stone-600">
      ยืนยันตัวตนเพื่อ<b>{{ OTP_PURPOSE[purpose] }}</b>
      <template v-if="sentTo"> · ส่งรหัส 6 หลักไปที่ <b>{{ formatPhone(sentTo) }}</b> (หมดอายุใน 5 นาที)</template>
    </p>

    <div v-if="sim" class="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
      <b>โหมดจำลอง</b> ยังไม่ได้ส่ง SMS จริง รหัสของคุณคือ <b class="text-lg tracking-widest">{{ sim }}</b>
    </div>

    <template v-if="!fatal">
      <div>
        <label class="label" for="otp-code">รหัส OTP</label>
        <input id="otp-code" v-model="code" type="text" v-num maxlength="6" autocomplete="one-time-code" placeholder="••••••" class="input text-center tracking-[0.5em]" @keyup.enter="submit" />
      </div>
      <p v-if="error" class="flex items-center gap-2 text-sm text-rose-600"><AppIcon name="alert" :size="16" /> {{ error }}</p>
      <div class="flex flex-wrap gap-2">
        <button type="button" class="btn-primary flex-1" :disabled="code.length !== 6" @click="submit">ยืนยัน</button>
        <button type="button" class="btn-outline" :disabled="wait > 0" @click="send">{{ wait > 0 ? `ขอใหม่ได้ใน ${wait} วิ` : 'ขอรหัสใหม่' }}</button>
      </div>
    </template>
    <p v-else-if="error" class="flex items-center gap-2 text-sm text-rose-600"><AppIcon name="alert" :size="16" /> {{ error }}</p>

    <button type="button" class="text-sm text-stone-500 underline" @click="emit('cancel')">ย้อนกลับ</button>
  </div>
</template>
