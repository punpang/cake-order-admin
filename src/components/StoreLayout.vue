<script setup>
import { db, customerSession } from '../data/store'
import { formatPhone } from '../lib/format'
import AppIcon from './AppIcon.vue'

// โครงหน้าร้าน + ระบบลูกค้า (สาธารณะ) · ธีมเดียวกับหลังบ้าน
const link = 'rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap text-stone-600 hover:bg-white'
const active = 'bg-white text-brand-700 shadow-sm'
</script>

<template>
  <header class="sticky top-0 z-20 border-b border-stone-200/60 bg-cream/85 backdrop-blur-xl">
    <div class="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4">
      <RouterLink to="/" class="flex min-w-0 items-center gap-2.5">
        <span class="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-white"><AppIcon name="cake" :size="20" /></span>
        <span class="truncate font-semibold text-stone-900">{{ db.shop.name || 'ร้านเค้ก' }}</span>
      </RouterLink>
      <nav class="ml-auto flex items-center gap-1">
        <RouterLink to="/" :class="[link, 'max-sm:hidden']" exact-active-class="bg-white text-brand-700 shadow-sm">หน้าแรก</RouterLink>
        <RouterLink to="/menu" :class="link" :active-class="active">เมนู</RouterLink>
        <RouterLink v-if="customerSession.customerId" to="/account" :class="link" :active-class="active">บัญชีของฉัน</RouterLink>
        <RouterLink v-else to="/account/login" class="btn-primary h-9 px-3.5 whitespace-nowrap">เข้าสู่ระบบ</RouterLink>
      </nav>
    </div>
  </header>

  <main class="min-h-[60vh]">
    <RouterView :key="$route.fullPath" />
  </main>

  <footer class="mt-12 border-t border-stone-200 bg-white">
    <div class="mx-auto grid max-w-6xl gap-6 px-4 py-8 text-sm text-stone-600 sm:grid-cols-3">
      <div>
        <div class="mb-2 flex items-center gap-2 font-semibold text-stone-900"><AppIcon name="cake" :size="18" /> {{ db.shop.name || 'ร้านเค้ก' }}</div>
        <p>{{ db.storefront.about }}</p>
      </div>
      <div class="space-y-1.5">
        <div class="mb-1 font-semibold text-stone-900">ติดต่อ</div>
        <p v-if="db.storefront.address" class="flex gap-2"><AppIcon name="pin" :size="16" class="mt-0.5 text-stone-400" /> {{ db.storefront.address }}</p>
        <p v-if="db.storefront.phone" class="flex gap-2"><AppIcon name="phone" :size="16" class="mt-0.5 text-stone-400" /> <a :href="`tel:${db.storefront.phone}`" class="underline">{{ formatPhone(db.storefront.phone) }}</a></p>
        <p class="flex flex-wrap gap-x-4">
          <a v-if="db.storefront.lineUrl" :href="db.storefront.lineUrl" target="_blank" rel="noopener" class="text-brand-700 underline">LINE OA</a>
          <a v-if="db.storefront.facebookUrl" :href="db.storefront.facebookUrl" target="_blank" rel="noopener" class="text-brand-700 underline">Facebook</a>
        </p>
      </div>
      <div class="space-y-1.5">
        <div class="mb-1 font-semibold text-stone-900">เวลาเปิด</div>
        <p v-for="(h, i) in db.storefront.hours" :key="i" class="flex justify-between gap-3"><span>{{ h.days }}</span><span>{{ h.time }}</span></p>
      </div>
    </div>
    <div class="border-t border-stone-100 py-3 text-center text-xs text-stone-400">
      <RouterLink to="/account" class="underline">บัญชีของฉัน</RouterLink>
      · <RouterLink to="/admin" class="underline">หลังบ้าน</RouterLink>
    </div>
  </footer>
</template>
