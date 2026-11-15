<script setup>
// หน้าลุ้นโชคของบิล (สาธารณะ ไม่ต้องล็อกอิน): เปิดจาก QR ท้ายใบเสร็จ → ดูจำนวนครั้งที่ลุ้นได้ → กดลุ้นทีละครั้ง
import { computed, onMounted, ref } from 'vue'
import { callLuckySpin } from '../../lib/luckyRemote'
import { dateTime } from '../../lib/format'

const props = defineProps({ token: { type: String, default: '' } })
const phase = ref('loading') // loading · ready (ลุ้นได้อีก หรือครบแล้ว) · spinning · error
const err = ref('')
const data = ref(null) // { draws, remaining, state, spins: [{ at, prize, code, codeExpiresAt, redeemed }] }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const remaining = computed(() => data.value?.remaining ?? 0)
const spins = computed(() => data.value?.spins || [])

function show(d) {
  data.value = d
  phase.value = 'ready'
}
function fail(message) {
  err.value = message
  phase.value = 'error'
}

async function load() {
  phase.value = 'loading'
  const r = await callLuckySpin(props.token, false)
  if (r.error) return fail(r.error)
  show(r.data)
}

async function spin() {
  if (phase.value !== 'ready' || remaining.value < 1) return
  phase.value = 'spinning'
  const [r] = await Promise.all([callLuckySpin(props.token, true), sleep(1400)]) // หมุนอย่างน้อย 1.4 วินาทีก่อนแสดงผล
  if (r.error) return fail(r.error)
  show(r.data)
}

onMounted(load)
</script>

<template>
  <main class="mx-auto max-w-md space-y-4 p-4">
    <header class="pt-4 text-center">
      <div class="text-sm font-medium text-brand-700">ลุ้นโชคท้ายบิล</div>
      <h1 class="text-2xl font-semibold text-stone-900">ลุ้นรางวัลจากบิลของคุณ</h1>
    </header>

    <section v-if="phase === 'loading'" class="card text-center text-stone-600">กำลังโหลด...</section>

    <section v-else-if="phase === 'error'" class="card text-center text-rose-700" role="alert">{{ err }}</section>

    <template v-else>
      <section class="card space-y-3 text-center">
        <p class="text-stone-700">บิลนี้ลุ้นได้ {{ data.draws }} ครั้ง</p>
        <div v-if="phase === 'spinning'" class="space-y-2">
          <div class="mx-auto h-28 w-28 animate-spin rounded-full border-8 border-brand-300 border-t-brand-700" aria-hidden="true" />
          <p class="text-stone-700">กำลังลุ้น...</p>
        </div>
        <template v-else>
          <button v-if="remaining > 0" type="button" class="btn-primary h-14 w-full text-lg" @click="spin">ลุ้นเลย (เหลือ {{ remaining }} ครั้ง)</button>
          <p v-else class="text-sm text-stone-600">ลุ้นครบทุกครั้งของบิลนี้แล้ว</p>
        </template>
      </section>

      <section v-for="(s, i) in spins" :key="s.at + i" class="card space-y-2 text-center">
        <div class="text-xs text-stone-500">ครั้งที่ {{ i + 1 }}</div>
        <template v-if="s.prize">
          <p class="text-xl font-semibold text-brand-800">{{ s.prize.name }}</p>
          <div class="rounded-2xl bg-brand-50 p-3">
            <div class="text-xs text-stone-600">รหัสรางวัล (แสดงให้พนักงานที่ร้าน)</div>
            <div class="font-mono text-2xl font-bold tracking-widest text-stone-900">{{ s.code }}</div>
            <div class="mt-1 text-xs text-stone-600">ใช้ได้ถึง {{ dateTime(s.codeExpiresAt) }}</div>
          </div>
          <p v-if="s.redeemed" class="text-sm font-medium text-emerald-700">รับรางวัลที่ร้านแล้ว</p>
        </template>
        <p v-else class="text-stone-700">ครั้งนี้ยังไม่ได้รางวัล</p>
      </section>
    </template>

    <p class="text-center text-xs text-stone-500">เก็บหน้านี้หรือรหัสไว้ แล้วแสดงให้พนักงานที่ร้านเพื่อรับรางวัล</p>
  </main>
</template>
