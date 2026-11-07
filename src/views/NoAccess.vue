<script setup>
import { can } from '../data/store'
import AppIcon from '../components/AppIcon.vue'
</script>

<template>
  <div class="mx-auto max-w-md pt-10">
    <div class="card flex flex-col items-center gap-3 py-12 text-center">
      <span class="flex h-14 w-14 items-center justify-center rounded-2xl bg-stone-100 text-stone-400"><AppIcon name="shield" :size="28" /></span>
      <h1 class="text-base font-semibold text-stone-800">ไม่มีสิทธิ์เข้าหน้านี้</h1>
      <p class="text-sm text-stone-500">ผู้ใช้นี้ยังไม่ได้รับสิทธิ์ ขอให้ผู้ดูแลติ๊กสิทธิ์ให้ที่ จัดการ → ผู้ใช้</p>
      <RouterLink :to="can('viewAllOrders') || can('viewPrepOrders') || can('viewDeliveryOrders') ? '/admin/orders' : '/'" class="btn-soft">กลับ</RouterLink>
    </div>
  </div>
</template>
