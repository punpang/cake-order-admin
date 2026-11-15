<script setup>
// หน้าลุ้นโชคของบิล (สาธารณะ ไม่ต้องล็อกอิน): เปิดจาก QR ท้ายใบเสร็จ → ดูสถานะ → กดลุ้น (ได้ครั้งเดียวต่อบิล)
import { onMounted, ref } from 'vue'
import { callLuckySpin } from '../../lib/luckyRemote'
import { dateTime } from '../../lib/format'

const props = defineProps({ token: { type: String, default: '' } })
const phase = ref('loading') // loading · ready (ยังไม่ลุ้น) · spinning · done (ลุ้นแล้ว) · error
const err = ref('')
const res = ref(null)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function show(d) {
  res.value = d
  phase.value = d.state === 'done' ? 'done' : 'ready'
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
  if (phase.value !== 'ready') return
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

    <section v-else-if="phase === 'ready'" class="card space-y-3 text-center">
      <p class="text-stone-700">ลุ้นได้ 1 ครั้งต่อบิล กดปุ่มเพื่อลุ้นเลย</p>
      <button type="button" class="btn-primary h-14 w-full text-lg" @click="spin">ลุ้นเลย</button>
    </section>

    <section v-else-if="phase === 'spinning'" class="card space-y-3 text-center">
      <div class="mx-auto h-32 w-32 animate-spin rounded-full border-8 border-brand-300 border-t-brand-700" aria-hidden="true" />
      <p class="text-stone-700">กำลังลุ้น...</p>
    </section>

    <section v-else-if="phase === 'done'" class="card space-y-3 text-center">
      <template v-if="res.won">
        <p class="text-sm text-stone-600">ยินดีด้วย คุณได้รับ</p>
        <p class="text-2xl font-semibold text-brand-800">{{ res.prize.name }}</p>
        <div class="rounded-2xl bg-brand-50 p-4">
          <div class="text-xs text-stone-600">รหัสรางวัล (แสดงให้พนักงานที่ร้าน)</div>
          <div class="font-mono text-3xl font-bold tracking-widest text-stone-900">{{ res.code }}</div>
          <div class="mt-1 text-xs text-stone-600">ใช้ได้ถึง {{ dateTime(res.codeExpiresAt) }}</div>
        </div>
        <p v-if="res.redeemed" class="text-sm font-medium text-emerald-700">รับรางวัลที่ร้านแล้ว</p>
      </template>
      <template v-else>
        <p class="text-lg text-stone-800">ครั้งนี้ยังไม่ได้รางวัล</p>
        <p class="text-sm text-stone-600">ขอบคุณที่ร่วมสนุกค่ะ ครั้งหน้าลุ้นใหม่</p>
      </template>
    </section>

    <p class="text-center text-xs text-stone-500">เก็บหน้านี้หรือรหัสไว้ แล้วแสดงให้พนักงานที่ร้านเพื่อรับรางวัล</p>
  </main>
</template>
