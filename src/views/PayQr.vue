<script setup>
// เครื่องมือสร้าง QR ชำระ (แอดมินและพนักงานขาย · สิทธิ์ reportPayment)
// กรอกรหัสอ้างอิงร้านค้า POS/ORD ของออร์เดอร์ → ระบบสร้างรายการแจ้งชำระใหม่พร้อมรหัสสุ่ม แล้วแสดง QR
import { computed, ref } from 'vue'
import { db } from '../data/store'
import { shopRefOfCode, shopRefOk } from '../lib/promptpay'
import QrPaymentPanel from '../components/QrPaymentPanel.vue'

const refText = ref('')
const refUp = computed(() => String(refText.value ?? '').trim().toUpperCase())
const found = computed(() => (shopRefOk(refUp.value) ? db.orders.find((o) => shopRefOfCode(o.code) === refUp.value) || null : null))
</script>

<template>
  <div>
    <div class="head-safe mb-3 min-w-0">
      <h1 class="page-title">สร้าง QR ชำระเงิน</h1>
      <p class="text-sm text-stone-500">กรอกรหัสอ้างอิงร้านค้า (POS / ORD) ของออร์เดอร์ แล้วกำหนดยอด ระบบจะสร้างรายการแจ้งชำระและรหัสสุ่มให้ แล้วแสดง QR</p>
    </div>
    <section class="card space-y-3 md:max-w-2xl">
      <div>
        <label class="label" for="pq-ref">รหัสอ้างอิงร้านค้า (POS / ORD)</label>
        <input id="pq-ref" v-model="refText" type="text" class="input" placeholder="เช่น ORD131126000741" />
      </div>
      <p v-if="refUp && !found" class="text-xs text-danger-700">ไม่พบออร์เดอร์ที่มีรหัสอ้างอิงนี้ (รูปแบบ POS/ORD ตามด้วยตัวเลข ไม่มีขีด)</p>
      <QrPaymentPanel v-if="found" :key="found.id" :order="found" />
    </section>
  </div>
</template>
