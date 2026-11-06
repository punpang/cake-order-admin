<script setup>
import { computed } from 'vue'
import { db } from '../../data/store'
import { bestSellers, activePromotions, customMenu, approvedReviews, avgRating } from '../../lib/storefront'
import { dateOnly, money } from '../../lib/format'
import AppIcon from '../../components/AppIcon.vue'
import CakeImage from '../../components/CakeImage.vue'
import StorePrice from '../../components/StorePrice.vue'
import StoreOrderButtons from '../../components/StoreOrderButtons.vue'

// หน้าแรกของร้าน (สาธารณะ): ข้อมูลทั้งหมดดึงจากหลังบ้าน แสดงเฉพาะที่เปิดใช้งาน
const s = computed(() => db.storefront)
const best = computed(() => bestSellers(db, 30, 6))
const promos = computed(() => activePromotions(db))
const types = computed(() => customMenu(db))
const reviews = computed(() => approvedReviews(db, 6))
const rating = computed(() => avgRating(db.reviews.filter((r) => r.status === 'approved')))
const stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n)
</script>

<template>
  <!-- hero -->
  <section class="relative isolate overflow-hidden bg-brand-800 text-white">
    <img v-if="s.heroImage" :src="s.heroImage" alt="" class="absolute inset-0 -z-10 h-full w-full object-cover opacity-60" />
    <div v-else class="absolute inset-0 -z-10 bg-linear-to-br from-brand-600 to-brand-900"></div>
    <div class="mx-auto max-w-6xl px-4 py-16 sm:py-24">
      <h1 class="max-w-xl text-3xl leading-tight font-semibold sm:text-5xl">{{ s.heroTitle }}</h1>
      <p class="mt-3 max-w-lg text-base text-white/85 sm:text-lg">{{ s.heroText }}</p>
      <div class="mt-6 flex flex-wrap gap-2">
        <RouterLink to="/menu" class="inline-flex h-11 items-center gap-1.5 rounded-xl bg-white px-5 text-sm font-semibold text-brand-800 hover:bg-brand-50">ดูเมนูเค้ก <AppIcon name="next" :size="16" /></RouterLink>
        <a v-if="s.lineUrl" :href="s.lineUrl" target="_blank" rel="noopener" class="inline-flex h-11 items-center gap-1.5 rounded-xl border border-white/60 px-5 text-sm font-semibold text-white hover:bg-white/10"><AppIcon name="chat" :size="16" /> สั่งทาง LINE</a>
      </div>
    </div>
  </section>

  <div class="mx-auto max-w-6xl space-y-14 px-4 pt-10">
    <!-- โปรโมชัน -->
    <section v-if="promos.length">
      <h2 class="mb-4 flex items-center gap-2 text-xl font-semibold text-stone-900"><AppIcon name="tag" :size="20" class="text-brand-600" /> โปรโมชัน</h2>
      <div class="grid gap-4 md:grid-cols-2">
        <div v-for="p in promos" :key="p.id" class="card border-brand-200 bg-brand-50/60">
          <div class="font-semibold text-brand-800">{{ p.name }}</div>
          <div v-if="p.from || p.to" class="text-xs text-stone-500">{{ p.from ? dateOnly(p.from) : '' }} – {{ p.to ? dateOnly(p.to) : '' }}</div>
          <ul v-if="p.products.length" class="mt-2 space-y-1 text-sm">
            <li v-for="x in p.products" :key="x.product.id" class="flex justify-between gap-3">
              <RouterLink :to="`/menu/ready/${x.product.id}`" class="truncate text-stone-700 underline-offset-2 hover:underline">{{ x.product.name }}</RouterLink>
              <span class="shrink-0"><b class="text-stone-900">{{ money(x.price) }}</b> <s class="text-stone-400">{{ money(x.regular) }}</s></span>
            </li>
          </ul>
          <p v-if="p.custom" class="mt-2 text-sm text-stone-600">ราคาพิเศษใช้กับเค้กสั่งทำบางแบบ ดูราคาล่าสุดที่หน้า <RouterLink to="/menu" class="text-brand-700 underline">เมนู</RouterLink></p>
        </div>
      </div>
    </section>

    <!-- ขายดี -->
    <section v-if="best.length">
      <div class="mb-4 flex items-end justify-between">
        <h2 class="text-xl font-semibold text-stone-900">สินค้าขายดี</h2>
        <RouterLink to="/menu" class="text-sm text-brand-700 underline">ดูทั้งหมด</RouterLink>
      </div>
      <div class="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3">
        <RouterLink v-for="b in best" :key="b.product.id" :to="`/menu/ready/${b.product.id}`" class="group overflow-hidden rounded-2xl border border-stone-200 bg-white transition hover:shadow-md">
          <div class="relative aspect-square overflow-hidden"><CakeImage :src="b.product.images?.[0]" :alt="b.product.name" />
            <span class="absolute top-2 left-2 rounded-full bg-brand-600 px-2.5 py-0.5 text-xs font-medium text-white">ขายดี</span>
          </div>
          <div class="p-3">
            <div class="truncate font-medium text-stone-900">{{ b.product.name }}</div>
            <StorePrice :price="b.price" :regular="b.regular" />
          </div>
        </RouterLink>
      </div>
    </section>

    <!-- เค้กสั่งทำ -->
    <section v-if="types.length">
      <div class="mb-4 flex items-end justify-between">
        <h2 class="text-xl font-semibold text-stone-900">เค้กสั่งทำตามใจ</h2>
        <RouterLink to="/menu" class="text-sm text-brand-700 underline">ดูเมนูเค้กสั่งทำ</RouterLink>
      </div>
      <div class="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
        <RouterLink v-for="t in types" :key="t.type.id" :to="`/menu/custom/${t.type.id}`" class="overflow-hidden rounded-2xl border border-stone-200 bg-white transition hover:shadow-md">
          <div class="aspect-4/3 overflow-hidden"><CakeImage :src="t.type.images?.[0]" :alt="t.type.name" /></div>
          <div class="p-3">
            <div class="truncate font-medium text-stone-900">{{ t.type.name }}</div>
            <StorePrice :price="t.from" :regular="t.regularFrom" from />
          </div>
        </RouterLink>
      </div>
    </section>

    <!-- แกลเลอรี -->
    <section v-if="s.gallery.length">
      <h2 class="mb-4 text-xl font-semibold text-stone-900">ผลงานของเรา</h2>
      <div class="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
        <figure v-for="(g, i) in s.gallery" :key="i" class="overflow-hidden rounded-2xl border border-stone-200 bg-white">
          <div class="aspect-square overflow-hidden"><img :src="g.image" :alt="g.caption || 'ผลงาน'" loading="lazy" class="h-full w-full object-cover" /></div>
          <figcaption v-if="g.caption" class="px-3 py-2 text-xs text-stone-600">{{ g.caption }}</figcaption>
        </figure>
      </div>
    </section>

    <!-- รีวิว -->
    <section v-if="reviews.length">
      <h2 class="mb-1 text-xl font-semibold text-stone-900">เสียงจากลูกค้า</h2>
      <p class="mb-4 text-sm text-stone-500"><span class="text-amber-500">★</span> {{ rating.toFixed(1) }} จาก {{ db.reviews.filter((r) => r.status === 'approved').length }} รีวิว</p>
      <div class="grid gap-3 md:grid-cols-3">
        <figure v-for="r in reviews" :key="r.id" class="card">
          <div class="text-amber-500" :aria-label="`${r.rating} ดาว`">{{ stars(r.rating) }}</div>
          <blockquote class="mt-1 text-sm break-words text-stone-700">{{ r.text }}</blockquote>
          <figcaption class="mt-2 text-xs text-stone-500">— {{ r.name }}</figcaption>
        </figure>
      </div>
    </section>

    <!-- วิธีสั่ง -->
    <section v-if="s.howToOrder.length">
      <h2 class="mb-4 text-xl font-semibold text-stone-900">วิธีสั่งซื้อ</h2>
      <ol class="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
        <li v-for="(h, i) in s.howToOrder" :key="i" class="card">
          <span class="mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-brand-600 text-sm font-semibold text-white">{{ i + 1 }}</span>
          <div class="font-medium text-stone-900">{{ h.title }}</div>
          <p class="mt-0.5 text-sm text-stone-600">{{ h.text }}</p>
        </li>
      </ol>
      <div class="mt-4"><StoreOrderButtons /></div>
    </section>

    <!-- FAQ + นโยบาย -->
    <section v-if="s.faq.length || s.policies.length" class="grid gap-8 md:grid-cols-2">
      <div v-if="s.faq.length">
        <h2 class="mb-3 text-xl font-semibold text-stone-900">คำถามที่พบบ่อย</h2>
        <details v-for="(f, i) in s.faq" :key="i" class="card mb-2 p-0">
          <summary class="cursor-pointer list-none px-4 py-3 font-medium text-stone-900">{{ f.q }}</summary>
          <p class="px-4 pb-3 text-sm text-stone-600">{{ f.a }}</p>
        </details>
      </div>
      <div v-if="s.policies.length">
        <h2 class="mb-3 text-xl font-semibold text-stone-900">นโยบายร้าน</h2>
        <details v-for="(f, i) in s.policies" :key="i" class="card mb-2 p-0">
          <summary class="cursor-pointer list-none px-4 py-3 font-medium text-stone-900">{{ f.title }}</summary>
          <p class="px-4 pb-3 text-sm text-stone-600">{{ f.text }}</p>
        </details>
      </div>
    </section>

    <!-- ติดต่อ -->
    <section class="card">
      <h2 class="mb-2 text-xl font-semibold text-stone-900">ติดต่อร้าน</h2>
      <p v-if="s.address" class="mb-3 flex gap-2 text-sm text-stone-600"><AppIcon name="pin" :size="16" class="mt-0.5 text-stone-400" /> {{ s.address }}</p>
      <div class="flex flex-wrap gap-2">
        <a v-if="s.mapUrl" :href="s.mapUrl" target="_blank" rel="noopener" class="btn-outline"><AppIcon name="pin" :size="16" /> ดูแผนที่</a>
        <StoreOrderButtons />
      </div>
    </section>
  </div>
</template>
