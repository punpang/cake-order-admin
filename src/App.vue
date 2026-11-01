<script setup>
import { session } from './data/store'
import { ROLES } from './lib/constants'
</script>

<template>
  <header class="sticky top-0 z-20 border-b border-stone-200 bg-white/95 backdrop-blur">
    <div class="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
      <RouterLink to="/orders" class="flex items-center gap-2 font-semibold">
        <span class="text-2xl">🎂</span>
        <span class="hidden sm:inline">ร้านเค้ก · หลังบ้าน</span>
      </RouterLink>
      <nav class="flex gap-1 text-sm">
        <RouterLink to="/orders" class="rounded-lg px-3 py-1.5 hover:bg-stone-100" active-class="bg-rose-50 text-rose-700">ออร์เดอร์</RouterLink>
      </nav>
      <div class="ml-auto flex items-center gap-2 text-sm">
        <span class="hidden text-stone-500 sm:inline">ทดลองเป็น</span>
        <select v-model="session.role" class="rounded-lg border border-stone-300 bg-white px-2 py-1.5">
          <option v-for="(label, key) in ROLES" :key="key" :value="key">{{ label }}</option>
        </select>
      </div>
    </div>
  </header>

  <main class="mx-auto max-w-6xl px-4 py-5">
    <RouterView :key="$route.fullPath" />
  </main>
</template>
