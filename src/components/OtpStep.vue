<script setup>
import { onMounted, onUnmounted, ref } from 'vue'
import { requestOtp, verifyOtp } from '../data/store'
import { OTP, OTP_PURPOSE } from '../lib/customerAuth'
import { formatPhone } from '../lib/format'
import AppIcon from './AppIcon.vue'

// ขั้นยืนยัน OTP: ขอรหัสอัตโนมัติเมื่อเปิด → กรอกรหัส 6 หลัก → ส่ง token ให้ขั้นถัดไป
// เซิร์ฟเวอร์ส่ง SMS จริงและไม่คืนรหัสให้หน้าจอ
const props = defineProps({ phone: { type: String, default: '' }, purpose: { type: String, required: true } })
const emit = defineEmits(['verified', 'cancel'])

const code = ref('')
const error = ref('')
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
const busy = ref(false) // รอเซิร์ฟเวอร์ตอบ (ส่งรหัส/ตรวจรหัส) กันกดซ้ำ
async function send() {
  if (busy.value) return
  busy.value = true
  const r = await requestOtp(props.phone, props.purpose)
  busy.value = false
  if (r.ok) {
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
  if (busy.value) return
  busy.value = true
  const r = await verifyOtp(props.phone, props.purpose, code.value)
  busy.value = false
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

    <template v-if="!fatal">
      <div>
        <label class="label" for="otp-code">รหัส OTP</label>
        <input id="otp-code" v-model="code" type="text" v-num maxlength="6" autocomplete="one-time-code" placeholder="••••••" class="input text-center tracking-[0.5em]" @keyup.enter="submit" />
      </div>
      <p v-if="error" class="flex items-center gap-2 text-sm text-rose-700"><AppIcon name="alert" :size="16" /> {{ error }}</p>
      <div class="flex flex-wrap gap-2">
        <button type="button" class="btn-primary flex-1" :disabled="code.length !== 6 || busy" @click="submit">{{ busy ? 'กำลังตรวจสอบ…' : 'ยืนยัน' }}</button>
        <button type="button" class="btn-outline" :disabled="wait > 0 || busy" @click="send">{{ wait > 0 ? `ขอใหม่ได้ใน ${wait} วิ` : 'ขอรหัสใหม่' }}</button>
      </div>
    </template>
    <p v-else-if="error" class="flex items-center gap-2 text-sm text-rose-700"><AppIcon name="alert" :size="16" /> {{ error }}</p>

    <button type="button" class="text-sm text-stone-500 underline" @click="emit('cancel')">ย้อนกลับ</button>
  </div>
</template>
