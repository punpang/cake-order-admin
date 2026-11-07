<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { staffSignIn } from '../lib/staffAuth'
import { session, can } from '../data/store'
import { firstHome } from '../lib/adminSystems'

const router = useRouter()
const email = ref('')
const password = ref('')
const busy = ref(false)
const error = ref('')

async function submit() {
  if (busy.value) return
  error.value = ''
  busy.value = true
  const r = await staffSignIn(email.value, password.value)
  busy.value = false
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
      <p v-if="error" class="text-sm text-rose-700" role="alert">{{ error }}</p>
      <button type="submit" class="btn-primary w-full" :disabled="busy">{{ busy ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ' }}</button>
    </form>
  </div>
</template>
