<template>
  <!-- สลับหน้าในครัว: วัตถุดิบ / ตารางผลิต -->
  <nav class="mb-4 grid grid-cols-2 gap-1 seg-grid">
    <RouterLink
      v-for="t in [{ to: '/admin/materials', l: 'วัตถุดิบ' }, { to: '/admin/production', l: 'ตารางผลิต' }]"
      :key="t.to"
      :to="t.to"
      class="flex h-10 items-center justify-center rounded-xl text-sm font-semibold text-stone-500 transition"
      exact-active-class="bg-white text-brand-700! shadow-sm"
    >{{ t.l }}</RouterLink>
  </nav>
</template>
