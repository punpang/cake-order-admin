<script setup>
// ลายเส้นเบเกอรี่ตกแต่งมุม (ลูกกวาด หัวใจ ดาว คุกกี้) · ไม่รับการแตะ ไม่ทำให้เลื่อนแนวนอน · ใช้ในกรอบ relative overflow-hidden
defineProps({ side: { type: String, default: 'right' } })
</script>

<template>
  <div class="pointer-events-none absolute inset-y-0 w-10 overflow-visible" :class="side === 'left' ? 'left-0' : 'right-0'" aria-hidden="true">
    <svg viewBox="0 0 40 120" class="h-full w-full" fill="none" stroke="#3f2e2e" stroke-width="1.6" stroke-linejoin="round" preserveAspectRatio="xMidYMid slice">
      <path d="M20 8l2.900 6.600 7.100.7-5.400 4.700 1.600 7L20 23.300 13.800 27l1.600-7L10 15.300l7.100-.7z" fill="#ffd05c" />
      <path d="M20 58s-8-5.200-8-11a4.500 4.500 0 018-2.800A4.500 4.500 0 0128 47c0 5.800-8 11-8 11z" fill="#ff8fa6" />
      <circle cx="20" cy="86" r="9" fill="#f2c48c" /><circle cx="17" cy="83" r="1.400" fill="#7a4a36" stroke="none" /><circle cx="23" cy="84" r="1.400" fill="#7a4a36" stroke="none" /><circle cx="19" cy="90" r="1.400" fill="#7a4a36" stroke="none" />
      <rect x="12" y="104" width="16" height="9" rx="4.500" fill="#ff8fa6" /><path d="M12 108.500l-6-5v10zM28 108.500l6-5v10z" fill="#ffd05c" />
    </svg>
  </div>
</template>
