<script setup>
// ไอคอนวาดมือ 4 ขั้นตอนสั่งซื้อ (i = 0..3: เค้ก / แชท / เงิน+ใบเสร็จ / รถส่งของ)
defineProps({ i: { type: Number, default: 0 } })
</script>

<template>
  <svg viewBox="0 0 64 56" class="h-14 w-16 shrink-0" aria-hidden="true" fill="none" stroke="#3f2e2e" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round">
    <template v-if="i % 4 === 0"><path d="M6 40q10-4 20 2l24-6c4-1 6 3 2 5L30 52 6 46z" fill="#ffd6c2" /><rect x="20" y="22" width="30" height="16" rx="4" fill="#ffd05c" /><path d="M18 22c0-8 8-12 17-12s17 4 17 12c-4 3-6 0-9 3s-5 0-8 3-5 0-8-3-6 0-9-3z" fill="#ff8fa6" /><circle cx="35" cy="8" r="4" fill="#e0314f" stroke-width="2" /></template>
    <template v-else-if="i % 4 === 1"><path d="M10 8h30a6 6 0 016 6v12a6 6 0 01-6 6H24l-8 7v-7h-6a6 6 0 01-6-6V14a6 6 0 016-6z" fill="#ff9d5b" /><circle cx="17" cy="20" r="2.4" fill="#fff" stroke="none" /><circle cx="26" cy="20" r="2.4" fill="#fff" stroke="none" /><circle cx="35" cy="20" r="2.4" fill="#fff" stroke="none" /><path d="M6 46q14-8 26 0l-4 6H8z" fill="#8ed1a8" /></template>
    <template v-else-if="i % 4 === 2"><rect x="8" y="6" width="42" height="24" rx="3" fill="#8ed1a8" /><circle cx="29" cy="18" r="6" fill="#fff8f2" stroke-width="2" /><path d="M6 44q12-8 26 0l-4 6H8z" fill="#ffd6c2" /><rect x="40" y="22" width="16" height="24" rx="2" fill="#fff" /><path d="M44 29h8M44 34h8M44 39h5" stroke-width="1.8" /></template>
    <template v-else><rect x="6" y="12" width="30" height="22" rx="3" fill="#ff9d5b" /><path d="M36 20h12l8 8v6H36z" fill="#ffd05c" /><circle cx="18" cy="36" r="5" fill="#fff" /><circle cx="46" cy="36" r="5" fill="#fff" /><path d="M8 46q14-6 26 0l-4 6H10z" fill="#ffd6c2" /></template>
  </svg>
</template>
