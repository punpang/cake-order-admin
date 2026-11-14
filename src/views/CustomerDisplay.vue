<script setup>
// จอแสดงให้ลูกค้า (หน้า /display) · รับสถานะจากแอป POS ผ่าน window.__displayUpdate (แอป Android ส่งเข้ามา)
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { money } from '../lib/format'

const state = ref({ status: 'idle', shopName: '' })
const qrSrc = ref('')
// รายการมาก (มากกว่า 6) แสดงเป็นสองคอลัมน์ตัวอักษรเล็กลง เพื่อให้พอดีจอ
const many = computed(() => (state.value.lines || []).length > 6)

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
  <div class="flex h-dvh flex-col overflow-hidden bg-cream p-6 text-stone-800 sm:p-8">
    <header class="shrink-0 text-center">
      <div class="text-2xl font-semibold text-brand-900 sm:text-3xl">{{ state.shopName }}</div>
    </header>

    <section v-if="state.status === 'shopping'" class="mt-4 flex min-h-0 flex-1 flex-col">
      <ul class="min-h-0 flex-1 overflow-y-auto" :class="many ? 'grid gap-x-8 gap-y-2 sm:grid-cols-2' : 'space-y-3'">
        <li
          v-for="(l, i) in state.lines"
          :key="i"
          class="flex items-start justify-between gap-4 border-b border-stone-200 pb-2"
          :class="many ? 'text-xl' : 'text-2xl'"
        >
          <span class="min-w-0 break-words">{{ l.qty }} × {{ l.name }}</span>
          <span class="shrink-0 font-semibold">{{ money(l.amount) }}</span>
        </li>
      </ul>
      <div class="mt-4 flex shrink-0 items-end justify-between rounded-3xl bg-brand-50 p-5">
        <span class="text-xl text-brand-800 sm:text-2xl">ยอดรวม</span>
        <span class="text-5xl font-bold text-brand-900 sm:text-6xl">{{ money(state.total) }}</span>
      </div>
    </section>

    <section v-else-if="state.status === 'paying'" class="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 sm:flex-row sm:gap-10">
      <div class="flex min-w-0 flex-col items-center gap-3 sm:items-start">
        <div class="text-center sm:text-left">
          <div class="text-xl text-brand-800 sm:text-2xl">ยอดชำระ</div>
          <div class="text-5xl font-bold text-brand-900 sm:text-6xl">{{ money(state.total) }}</div>
        </div>
        <ul v-if="state.payLines?.length" class="w-full max-w-md space-y-2 text-lg sm:text-xl">
          <li v-for="(p, i) in state.payLines" :key="i" class="flex justify-between rounded-2xl bg-white p-3">
            <span>{{ p.method }}</span>
            <span>{{ money(p.amount) }}{{ p.done ? ' ✓' : '' }}</span>
          </li>
        </ul>
        <p v-if="state.remaining > 0" class="text-lg text-amber-800 sm:text-xl">ยังขาด {{ money(state.remaining) }}</p>
      </div>
      <div v-if="state.qr" class="flex shrink-0 flex-col items-center gap-2">
        <img
          v-if="qrSrc"
          :src="qrSrc"
          alt="QR พร้อมเพย์สำหรับชำระเงิน"
          class="h-[min(56vh,44vw)] w-[min(56vh,44vw)] rounded-2xl bg-white p-3"
        />
        <p class="text-lg sm:text-xl">สแกน QR เพื่อชำระ {{ money(state.qr.amount) }}</p>
      </div>
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
