<script setup>
// QR พร้อมเพย์แบบ Biller ของรายการแจ้งชำระหนึ่งรายการ: Biller ID ของร้าน (ตั้งค่าร้าน) · Ref 1 = POS/ORD · Ref 2 = รหัสสุ่มของรายการ · ยอดฝังใน QR
import { computed, ref, watch } from 'vue'
import { db } from '../data/store'
import { billerIdOf, promptPayBillerPayload } from '../lib/promptpay'
import { money } from '../lib/format'

const props = defineProps({
  amount: { type: Number, required: true },
  ref1: { type: String, required: true },
  ref2: { type: String, required: true },
})

const biller = computed(() => billerIdOf(db.shop?.billerId))
const payload = computed(() => (biller.value ? promptPayBillerPayload(biller.value, props.amount, props.ref1, props.ref2) : null))

const qr = ref('')
watch(payload, async (p) => {
  qr.value = ''
  if (!p) return
  try {
    const QR = await import('qrcode')
    qr.value = await (QR.default || QR).toDataURL(p, { margin: 1, width: 240, errorCorrectionLevel: 'M' })
  } catch {
    qr.value = ''
  }
}, { immediate: true })
</script>

<template>
  <div class="text-center">
    <p v-if="!biller" class="text-left text-xs text-amber-700">ยังไม่ได้ตั้ง Biller ID ของร้าน (ตั้งค่าร้าน › ช่องทางรับชำระ) จึงสร้าง QR ไม่ได้</p>
    <template v-else-if="payload">
      <img v-if="qr" :src="qr" alt="QR พร้อมเพย์ (Biller)" class="mx-auto h-56 w-56" />
      <p v-else class="py-8 text-stone-400">กำลังสร้าง QR…</p>
      <p class="text-base font-semibold text-stone-900">{{ money(amount) }}</p>
      <p class="text-xs text-stone-500">รหัสอ้างอิง {{ ref1 }} · รหัสสุ่ม {{ ref2 }}</p>
    </template>
    <p v-else class="text-left text-xs text-rose-700">ข้อมูล QR ไม่ครบ (ยอดหรือรหัสอ้างอิง)</p>
  </div>
</template>
