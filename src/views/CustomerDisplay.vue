<script setup>
// จอแสดงให้ลูกค้า (หน้า /display) · รับสถานะจากแอป POS ผ่าน window.__displayUpdate (แอป Android ส่งเข้ามา)
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { money } from '../lib/format'

const state = ref({ status: 'idle', shopName: '' })
const qrSrc = ref('')

function apply(s) {
  state.value = s && typeof s === 'object' ? s : { status: 'idle', shopName: '' }
}
onMounted(() => {
  window.__displayUpdate = apply
})
onBeforeUnmount(() => {
  if (window.__displayUpdate === apply) delete window.__displayUpdate
})

watch(
  () => state.value.qr?.payload,
  async (payload) => {
    if (!payload) {
      qrSrc.value = ''
      return
    }
    try {
      const QR = await import('qrcode')
      qrSrc.value = await (QR.default || QR).toDataURL(payload, { margin: 1, width: 420, errorCorrectionLevel: 'M' })
    } catch {
      qrSrc.value = ''
    }
  },
  { immediate: true },
)
</script>

<template>
  <div class="flex min-h-dvh flex-col bg-cream p-8 text-stone-800">
    <header class="text-center">
      <div class="text-3xl font-semibold text-brand-900">{{ state.shopName }}</div>
    </header>

    <section v-if="state.status === 'shopping'" class="mt-6 flex flex-1 flex-col">
      <ul class="flex-1 space-y-3">
        <li v-for="(l, i) in state.lines" :key="i" class="flex items-start justify-between gap-4 border-b border-stone-200 pb-3 text-2xl">
          <span class="min-w-0 break-words">{{ l.qty }} × {{ l.name }}</span>
          <span class="shrink-0 font-semibold">{{ money(l.amount) }}</span>
        </li>
      </ul>
      <div class="mt-6 flex items-end justify-between rounded-3xl bg-brand-50 p-6">
        <span class="text-2xl text-brand-800">ยอดรวม</span>
        <span class="text-6xl font-bold text-brand-900">{{ money(state.total) }}</span>
      </div>
    </section>

    <section v-else-if="state.status === 'paying'" class="flex flex-1 flex-col items-center justify-center gap-3">
      <div class="text-center">
        <div class="text-2xl text-brand-800">ยอดชำระ</div>
        <div class="text-5xl font-bold text-brand-900">{{ money(state.total) }}</div>
      </div>
      <div v-if="state.qr" class="flex flex-col items-center gap-3">
        <img v-if="qrSrc" :src="qrSrc" alt="QR พร้อมเพย์สำหรับชำระเงิน" class="h-[36vh] w-[36vh] rounded-2xl bg-white p-3" />
        <p class="text-2xl">สแกน QR เพื่อชำระ {{ money(state.qr.amount) }}</p>
      </div>
      <ul v-if="state.payLines?.length" class="w-full max-w-xl space-y-2 text-xl">
        <li v-for="(p, i) in state.payLines" :key="i" class="flex justify-between rounded-2xl bg-white p-3">
          <span>{{ p.method }}</span>
          <span>{{ money(p.amount) }}{{ p.done ? ' ✓' : '' }}</span>
        </li>
      </ul>
      <p v-if="state.remaining > 0" class="text-xl text-amber-800">ยังขาด {{ money(state.remaining) }}</p>
    </section>

    <section v-else-if="state.status === 'thanks'" class="flex flex-1 flex-col items-center justify-center text-center">
      <p class="text-5xl font-semibold text-emerald-800">ขอบคุณค่ะ</p>
      <p class="mt-4 text-3xl">ชำระแล้ว {{ money(state.total) }}</p>
    </section>

    <section v-else class="flex flex-1 flex-col items-center justify-center text-center">
      <p class="text-4xl font-semibold text-brand-800">ยินดีต้อนรับค่ะ</p>
    </section>
  </div>
</template>
