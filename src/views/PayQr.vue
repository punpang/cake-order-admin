<script setup>
// เครื่องมือสร้าง QR พร้อมเพย์แบบ Biller (แอดมินและพนักงานขาย · สิทธิ์ reportPayment)
import BillerQr from '../components/BillerQr.vue'
</script>

<template>
  <div>
    <div class="mb-3 min-w-0">
      <h1 class="page-title">สร้าง QR ชำระเงิน</h1>
      <p class="text-sm text-stone-500">กรอกยอด รหัสร้านค้า และรหัสอ้างอิง (POS / ORD) แล้วให้ลูกค้าสแกนด้วยแอปธนาคาร</p>
    </div>
    <section class="card md:max-w-2xl">
      <BillerQr />
    </section>
  </div>
</template>
