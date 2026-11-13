<script setup>
// QR พร้อมเพย์แบบ Biller: Biller ID (ของร้าน) · รหัสร้านค้า = Ref 1 · รหัสอ้างอิง POS/ORD = Ref 2 · ยอดฝังใน QR
// ใช้ในหน้าเครื่องมือ QR และในหน้ารายละเอียดออร์เดอร์ · ทุกช่องแก้ได้ (ค่าเริ่มต้นมาจากตั้งค่าร้าน)
import { computed, ref, watch } from 'vue'
import { db } from '../data/store'
import { billerIdOf, promptPayBillerPayload, shopCodeOf, shopRefOk } from '../lib/promptpay'
import { money } from '../lib/format'

const props = defineProps({
  amount: { type: String, default: '' },
  refCode: { type: String, default: '' },
})

const biller = ref(String(db.shop?.billerId ?? ''))
const shopCode = ref(String(db.shop?.merchantCode ?? ''))
const amt = ref(props.amount)
const refText = ref(props.refCode)

const refUp = computed(() => String(refText.value ?? '').trim().toUpperCase())
const amount = computed(() => {
  const s = String(amt.value ?? '').replace(/,/g, '').trim()
  return s === '' ? null : Number(s)
})
const amountOk = computed(() => amount.value != null && Number.isFinite(amount.value) && amount.value > 0 && amount.value <= 9999999.99)
const billerOk = computed(() => !!billerIdOf(biller.value))
const shopCodeOk = computed(() => !!shopCodeOf(shopCode.value))
const refOk = computed(() => shopRefOk(refUp.value))
const payload = computed(() => (amountOk.value && billerOk.value && shopCodeOk.value && refOk.value
  ? promptPayBillerPayload(biller.value, amount.value, refUp.value, shopCode.value)
  : null))

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
  <div class="space-y-3">
    <div class="grid gap-3 sm:grid-cols-2">
      <div>
        <label class="label" for="bqr-amount">จำนวนเงิน (บาท)</label>
        <input id="bqr-amount" v-model="amt" type="text" inputmode="decimal" class="input" placeholder="เช่น 540" />
      </div>
      <div>
        <label class="label" for="bqr-biller">Biller ID (15 หลัก)</label>
        <input id="bqr-biller" v-model="biller" type="text" inputmode="numeric" maxlength="15" class="input" placeholder="เช่น 010753600010286" />
      </div>
      <div>
        <label class="label" for="bqr-shop">รหัสร้านค้า (Ref 1)</label>
        <input id="bqr-shop" v-model="shopCode" type="text" inputmode="numeric" maxlength="20" class="input" placeholder="เช่น 014000000517185" />
      </div>
      <div>
        <label class="label" for="bqr-ref">รหัสอ้างอิงร้านค้า (POS / ORD · Ref 2)</label>
        <input id="bqr-ref" v-model="refText" type="text" class="input" placeholder="เช่น ORD131126000123" />
      </div>
    </div>
    <p v-if="!billerOk" class="text-xs text-amber-700">ใส่ Biller ID 15 หลักก่อนสร้าง QR · ตั้งค่าไว้ที่ตั้งค่าร้านได้</p>
    <p v-if="!shopCodeOk" class="text-xs text-amber-700">ใส่รหัสร้านค้า (ตัวเลข) ก่อนสร้าง QR · ตั้งค่าไว้ที่ตั้งค่าร้านได้</p>
    <p v-if="refUp && !refOk" class="text-xs text-rose-700">รหัสอ้างอิงต้องขึ้นต้นด้วย POS หรือ ORD ตามด้วยตัวเลข เช่น ORD131126000123</p>
    <p v-if="amt !== '' && !amountOk" class="text-xs text-rose-700">จำนวนเงินต้องมากกว่า 0 และไม่เกิน 9,999,999.99</p>
    <div v-if="payload" class="text-center">
      <img v-if="qr" :src="qr" alt="QR พร้อมเพย์ (Biller)" class="mx-auto h-56 w-56" />
      <p v-else class="py-8 text-stone-400">กำลังสร้าง QR…</p>
      <p class="text-base font-semibold text-stone-900">{{ money(amount) }}</p>
      <p class="text-xs text-stone-500">รหัสร้านค้า {{ shopCodeOf(shopCode) }} · รหัสอ้างอิง {{ refUp }}</p>
    </div>
  </div>
</template>
