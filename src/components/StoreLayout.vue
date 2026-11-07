<script setup>
import { db, customerSession } from '../data/store'
import { formatPhone } from '../lib/format'
import AppIcon from './AppIcon.vue'
import BellMenu from './BellMenu.vue'
import CookieBanner from './CookieBanner.vue'
import { openCookieSettings } from '../lib/consent'

// โครงหน้าร้าน + ระบบลูกค้า (สาธารณะ) · ธีมเดียวกับหลังบ้าน
const link = 'rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap text-stone-600 hover:bg-white'
const active = 'bg-white text-brand-700 shadow-sm'
</script>

<template>
  <div class="store-theme">
  <header class="sticky top-0 z-20 bg-cream/90 backdrop-blur-xl">
    <div class="mx-auto flex h-14 max-w-page items-center gap-2 px-4 lg:px-8">
      <RouterLink to="/" class="flex min-w-0 items-center gap-2.5">
        <svg viewBox="0 0 48 48" class="h-10 w-10 shrink-0" aria-hidden="true" fill="none" stroke="#3f2e2e" stroke-width="2" stroke-linejoin="round"><ellipse cx="24" cy="40" rx="18" ry="4" fill="#fff" /><rect x="9" y="22" width="30" height="16" rx="4" fill="#ffd05c" /><path d="M8 22c0-7 7-10 16-10s16 3 16 10c-3 3-5 0-8 3s-5 0-8 3-5 0-8-3-5 0-8-3z" fill="#ff8fa6" /><circle cx="24" cy="9" r="4" fill="#e0314f" /></svg>
        <span class="truncate font-display text-xl text-brand-700">{{ db.shop.name || 'ร้านเค้ก' }}</span>
      </RouterLink>
      <nav class="ml-auto flex items-center gap-1">
        <RouterLink to="/" :class="[link, 'max-sm:hidden']" exact-active-class="bg-white text-brand-700 shadow-sm">หน้าแรก</RouterLink>
        <RouterLink to="/menu" :class="link" :active-class="active">เมนู</RouterLink>
        <RouterLink v-if="customerSession.customerId" to="/account" :class="link" :active-class="active">บัญชีของฉัน</RouterLink>
        <RouterLink v-else to="/account/login" class="btn-matcha h-10 px-4 whitespace-nowrap">เข้าสู่ระบบ</RouterLink>
        <BellMenu v-if="customerSession.customerId" audience="customer" class="ml-1" />
      </nav>
    </div>
  </header>

  <main id="main-content" tabindex="-1" class="min-h-[60vh] outline-none">
    <RouterView :key="$route.fullPath" />
  </main>

  <footer class="mt-12 bg-choco text-cream">
    <div class="mx-auto grid max-w-page gap-6 px-4 py-8 text-sm text-cream sm:grid-cols-3 lg:px-8">
      <div>
        <div class="mb-2 flex items-center gap-2 font-display text-xl"><AppIcon name="cake" :size="18" /> {{ db.shop.name || 'ร้านเค้ก' }}</div>
        <p>{{ db.storefront.about }}</p>
      </div>
      <div class="space-y-1.5">
        <div class="mb-1 font-display text-lg">ติดต่อ</div>
        <p v-if="db.storefront.address" class="flex gap-2"><AppIcon name="pin" :size="16" class="mt-0.5 text-cream/70" /> {{ db.storefront.address }}</p>
        <p v-if="db.storefront.phone" class="flex gap-2"><AppIcon name="phone" :size="16" class="mt-0.5 text-cream/70" /> <a :href="`tel:${db.storefront.phone}`" class="underline">{{ formatPhone(db.storefront.phone) }}</a></p>
        <p class="flex flex-wrap gap-x-4">
          <a v-if="db.storefront.lineUrl" :href="db.storefront.lineUrl" target="_blank" rel="noopener" class="underline">LINE OA</a>
          <a v-if="db.storefront.facebookUrl" :href="db.storefront.facebookUrl" target="_blank" rel="noopener" class="underline">Facebook</a>
        </p>
      </div>
      <div class="space-y-1.5">
        <div class="mb-1 font-display text-lg">เวลาเปิด</div>
        <p v-for="(h, i) in db.storefront.hours" :key="i" class="flex justify-between gap-3"><span>{{ h.days }}</span><span>{{ h.time }}</span></p>
      </div>
    </div>
    <div class="border-t border-cream/15 py-3 text-center text-xs text-cream/80">
      <RouterLink to="/legal/privacy" class="underline inline-block py-1.5">ความเป็นส่วนตัว (PDPA)</RouterLink>
      · <RouterLink to="/legal/terms" class="underline inline-block py-1.5">เงื่อนไขการใช้งาน</RouterLink>
      · <RouterLink to="/legal/cookie" class="underline inline-block py-1.5">คุกกี้</RouterLink>
      · <button type="button" class="inline-block py-1.5 underline" @click="openCookieSettings">ตั้งค่าคุกกี้</button>
    </div>
    <div class="pb-3 text-center text-xs text-cream/80">
      <RouterLink to="/account" class="inline-block py-1.5 underline">บัญชีของฉัน</RouterLink>
    </div>
  </footer>
  <CookieBanner />
  </div>
</template>
