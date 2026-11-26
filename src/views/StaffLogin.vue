<script setup>
import { ref, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { staffSignIn } from '../lib/staffAuth'
import { turnstileOn, turnstileSiteKey, loadTurnstile } from '../lib/turnstile'
import { session, can } from '../data/store'
import { firstHome } from '../lib/adminSystems'

const router = useRouter()
const email = ref('')
const password = ref('')
const busy = ref(false)
const error = ref('')

// Turnstile (เปิดเมื่อ build มี VITE_TURNSTILE_SITE_KEY) · โทเคนใช้ได้ครั้งเดียว จึงรีเซ็ตทุกครั้งที่ส่งฟอร์ม
const captchaOn = turnstileOn()
const captchaEl = ref(null)
const captchaToken = ref('')
let captchaId = null

function resetCaptcha() {
  captchaToken.value = ''
  if (captchaId !== null && window.turnstile) { try { window.turnstile.reset(captchaId) } catch { /* ไม่เป็นไร */ } }
}

onMounted(async () => {
  if (!captchaOn) return
  try {
    const ts = await loadTurnstile()
    await nextTick()
    if (!captchaEl.value) return
    captchaId = ts.render(captchaEl.value, {
      sitekey: turnstileSiteKey(),
      callback: (token) => { captchaToken.value = token },
      'expired-callback': () => { captchaToken.value = '' },
      'error-callback': () => { captchaToken.value = '' },
    })
  } catch {
    error.value = 'โหลดตัวยืนยันไม่ได้ กรุณารีเฟรชหน้า'
  }
})

onBeforeUnmount(() => {
  if (captchaId !== null && window.turnstile) { try { window.turnstile.remove(captchaId) } catch { /* ไม่เป็นไร */ } }
})

async function submit() {
  if (busy.value) return
  error.value = ''
  if (captchaOn && !captchaToken.value) { error.value = 'กรุณายืนยันว่าไม่ใช่บอทก่อนเข้าสู่ระบบ'; return }
  busy.value = true
  const r = await staffSignIn(email.value, password.value, captchaToken.value)
  busy.value = false
  resetCaptcha()
  if (r.error) { error.value = r.error; return }
  session.role = r.staff.role
  password.value = ''
  router.replace(firstHome(can))
}
</script>

<template>
  <div class="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4 py-10">
    <h1 class="page-title mb-1 text-center">เข้าสู่ระบบหลังบ้าน</h1>
    <p class="mb-6 text-center text-sm text-stone-600">สำหรับพนักงานร้านเท่านั้น</p>
    <form class="card space-y-3 p-5" @submit.prevent="submit">
      <label class="block text-sm font-medium text-stone-700">อีเมล
        <input v-model="email" type="email" class="input mt-1" autocomplete="username" required />
      </label>
      <label class="block text-sm font-medium text-stone-700">รหัสผ่าน
        <input v-model="password" type="password" class="input mt-1" autocomplete="current-password" required />
      </label>
      <div v-if="captchaOn" ref="captchaEl" class="flex justify-center"></div>
      <p v-if="error" class="text-sm text-danger-700" role="alert">{{ error }}</p>
      <button type="submit" class="btn-primary w-full" :disabled="busy">{{ busy ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ' }}</button>
    </form>
  </div>
</template>
