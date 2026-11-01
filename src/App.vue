<script setup>
import { ref } from 'vue'
import { session, can } from './data/store'
import { ROLES } from './lib/constants'
import AppIcon from './components/AppIcon.vue'
import AppModal from './components/AppModal.vue'

const roleOpen = ref(false)
</script>

<template>
  <!-- แถบบน -->
  <header class="sticky top-0 z-20 border-b border-stone-200/60 bg-cream/85 backdrop-blur-xl">
    <div class="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
      <RouterLink to="/orders" class="flex min-w-0 items-center gap-2.5">
        <span class="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-white shadow-sm shadow-brand-600/30">
          <AppIcon name="cake" :size="20" />
        </span>
        <span class="truncate font-semibold text-stone-900">ร้านเค้ก <span class="font-normal text-stone-500">· หลังบ้าน</span></span>
      </RouterLink>

      <nav class="ml-4 hidden gap-1 md:flex">
        <RouterLink to="/orders" class="rounded-lg px-3 py-1.5 text-sm font-medium text-stone-600 hover:bg-white" exact-active-class="bg-white text-brand-700 shadow-sm">ออร์เดอร์</RouterLink>
        <RouterLink v-if="can('createOrder')" to="/orders/new" class="rounded-lg px-3 py-1.5 text-sm font-medium text-stone-600 hover:bg-white" exact-active-class="bg-white text-brand-700 shadow-sm">สร้างออร์เดอร์</RouterLink>
      </nav>

      <button class="ml-auto hidden items-center gap-2 rounded-xl border border-stone-200 bg-white px-3 py-1.5 text-sm md:inline-flex" @click="roleOpen = true">
        <AppIcon name="user" :size="16" class="text-stone-500" />
        {{ ROLES[session.role] }}
      </button>
    </div>
  </header>

  <main
    class="mx-auto max-w-6xl px-4 pt-5"
    :class="$route.meta.focus ? 'pb-8' : 'pb-[calc(env(safe-area-inset-bottom)+6rem)] md:pb-10'"
  >
    <RouterView :key="$route.fullPath" />
  </main>

  <!-- แถบเมนูล่าง (มือถือ) -->
  <nav
    v-if="!$route.meta.focus"
    class="fixed inset-x-0 bottom-0 z-30 border-t border-stone-200/70 bg-white/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
  >
    <div class="mx-auto grid h-16 max-w-md grid-cols-3 items-center">
      <RouterLink to="/orders" class="flex flex-col items-center gap-0.5 text-[11px] font-medium text-stone-500" exact-active-class="text-brand-700!">
        <AppIcon name="list" :size="22" />
        ออร์เดอร์
      </RouterLink>
      <div class="flex justify-center">
        <RouterLink
          v-if="can('createOrder')"
          to="/orders/new"
          class="-mt-7 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-600 text-white shadow-lg shadow-brand-600/40 ring-4 ring-cream active:scale-95"
          aria-label="สร้างออร์เดอร์"
        >
          <AppIcon name="plus" :size="26" />
        </RouterLink>
      </div>
      <button class="flex flex-col items-center gap-0.5 text-[11px] font-medium text-stone-500" @click="roleOpen = true">
        <AppIcon name="user" :size="22" />
        <span class="max-w-full truncate px-1">{{ ROLES[session.role] }}</span>
      </button>
    </div>
  </nav>

  <!-- เลือกบทบาท (จำลอง) -->
  <AppModal v-if="roleOpen" title="ทดลองใช้งานเป็น" @close="roleOpen = false">
    <div class="grid gap-2">
      <button
        v-for="(label, key) in ROLES"
        :key="key"
        class="flex items-center justify-between rounded-xl border px-4 py-3 text-left"
        :class="session.role === key ? 'border-brand-500 bg-brand-50 text-brand-800' : 'border-stone-200 hover:bg-stone-50'"
        @click="session.role = key; roleOpen = false"
      >
        <span class="font-medium">{{ label }}</span>
        <AppIcon v-if="session.role === key" name="check" class="text-brand-600" />
      </button>
    </div>
  </AppModal>
</template>
