<script setup>
import { computed } from 'vue'
import { db } from '../../data/store'
import { bestSellers, activePromotions, customMenu, approvedReviews, avgRating, promoProducts } from '../../lib/storefront'
import { dateOnly, money } from '../../lib/format'
import { latestCustomPhotos } from '../../lib/cakeSearch'
import AppIcon from '../../components/AppIcon.vue'
import CakeImage from '../../components/CakeImage.vue'
import StorePrice from '../../components/StorePrice.vue'
import StoreOrderButtons from '../../components/StoreOrderButtons.vue'
import HeroCake from '../../components/art/HeroCake.vue'
import StepArt from '../../components/art/StepArt.vue'
import Bunting from '../../components/art/Bunting.vue'
import Doodles from '../../components/art/Doodles.vue'

// หน้าแรกของร้าน (สาธารณะ): ข้อมูลทั้งหมดดึงจากหลังบ้าน แสดงเฉพาะที่เปิดใช้งาน
const s = computed(() => db.storefront)
const best = computed(() => bestSellers(db, 30, 6))
const promos = computed(() => activePromotions(db))
const types = computed(() => customMenu(db))
const recent = computed(() => latestCustomPhotos(db).slice(0, 6))
const promoItems = computed(() => promoProducts(db, 6))
const altOf = (p) => p.caption || [p.typeName, ...p.tagNames.filter((t) => t.groupKey !== 'type').map((t) => t.name)].filter(Boolean).join(' ') || 'เค้กสั่งทำ'
const reviews = computed(() => approvedReviews(db, 6))
const rating = computed(() => avgRating(db.reviews.filter((r) => r.status === 'approved')))
const stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n)
</script>

<template>
  <!-- hero -->
  <section class="relative isolate overflow-hidden text-white">
    <img v-if="s.heroImage" :src="s.heroImage" alt="" fetchpriority="high" decoding="async" class="absolute inset-0 -z-10 h-full w-full object-cover" />
    <div class="absolute inset-0 -z-10" :class="s.heroImage ? 'bg-linear-to-br from-hero-1/85 via-hero-2/80 to-hero-3/85' : 'bg-linear-to-br from-hero-1 via-hero-2 to-hero-3'"></div>
    <HeroCake class="pointer-events-none absolute -right-4 -bottom-2 -z-0 h-44 w-44 opacity-95 sm:right-10 sm:h-72 sm:w-72" />
    <div class="relative mx-auto max-w-page px-5 py-9 sm:py-20 lg:px-8">
      <h1 class="max-w-[15rem] text-[2rem] leading-[1.22] sm:max-w-xl sm:text-5xl">{{ s.heroTitle }}</h1>
      <p class="mt-2.5 max-w-[15rem] text-base leading-snug font-medium sm:max-w-lg sm:text-lg">{{ s.heroText }}</p>
      <div class="mt-5 flex flex-wrap gap-2">
        <RouterLink to="/menu" class="inline-flex h-12 items-center gap-1.5 rounded-full bg-white px-6 font-display text-base text-stone-800 shadow-lg hover:bg-brand-50">ดูเมนูเค้ก <AppIcon name="next" :size="16" /></RouterLink>
        <a v-if="s.lineUrl" :href="s.lineUrl" target="_blank" rel="noopener" class="inline-flex h-12 items-center gap-1.5 rounded-full border-2 border-white/80 px-5 font-display text-base text-white hover:bg-white/10"><AppIcon name="chat" :size="16" /> สั่งทาง LINE</a>
      </div>
    </div>
  </section>

  <div class="mx-auto max-w-page space-y-9 px-4 pt-6 pb-2 sm:space-y-12 lg:px-8">
    <!-- โปรโมชั่น -->
    <section v-if="promos.length" aria-label="โปรโมชั่น">
      <h2 class="sr-only">โปรโมชั่น</h2>
      <div class="grid gap-4 md:grid-cols-2">
        <div v-for="p in promos" :key="p.id" class="card relative overflow-hidden border-2 border-[#f3e3c7] pt-8 shadow-md">
          <Bunting />
          <div class="flex gap-3.5">
            <svg viewBox="0 0 60 64" class="mt-1 h-16 w-14 shrink-0" aria-hidden="true" fill="none" stroke="#3f2e2e" stroke-width="2.5" stroke-linejoin="round"><rect x="8" y="26" width="44" height="32" rx="4" fill="#ff9d5b" /><rect x="4" y="18" width="52" height="12" rx="4" fill="#ffb27e" /><path d="M30 18v40" /><path d="M30 18c-10-14-22-6-12 0zM30 18c10-14 22-6 12 0z" fill="#ff8fa6" /></svg>
            <div class="min-w-0 flex-1">
              <div class="font-display text-xl text-stone-900">โปรโมชั่น</div>
              <div class="font-semibold text-stone-800">{{ p.name }}</div>
              <div v-if="p.from || p.to" class="text-sm text-stone-600">{{ p.from ? dateOnly(p.from) : '' }} – {{ p.to ? dateOnly(p.to) : '' }}</div>
              <ul v-if="p.products.length" class="mt-2 space-y-1 text-sm">
                <li v-for="x in p.products" :key="x.product.id" class="flex justify-between gap-3">
                  <RouterLink :to="`/menu/ready/${x.product.id}`" class="truncate text-stone-700 underline-offset-2 hover:underline">{{ x.product.name }}</RouterLink>
                  <span class="shrink-0"><b class="text-stone-900">{{ money(x.price) }}</b> <s class="text-stone-500">{{ money(x.regular) }}</s></span>
                </li>
              </ul>
              <p v-if="p.text" class="mt-1 text-sm text-stone-700">{{ p.text }}</p>
              <p v-if="p.custom" class="mt-2 text-sm text-stone-600">ราคาพิเศษใช้กับเค้กสั่งทำบางแบบ ดูราคาล่าสุดที่หน้า <RouterLink to="/menu" class="text-brand-700 underline">เมนู</RouterLink></p>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- สินค้าที่กำลังมีโปรโมชั่น -->
    <section v-if="promoItems.items.length" aria-label="สินค้าที่กำลังมีโปรโมชั่น">
      <div class="mb-3 flex items-center justify-between gap-3">
        <h2 class="text-2xl text-stone-900">สินค้าที่กำลังมีโปรโมชั่น</h2>
        <RouterLink v-if="promoItems.total > promoItems.items.length" to="/menu" class="btn-peach h-10 px-4">ดูทั้งหมด</RouterLink>
      </div>
      <ul class="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-6">
        <li v-for="r in promoItems.items" :key="r.product.id">
          <RouterLink :to="`/menu/ready/${r.product.id}`" class="group block overflow-hidden rounded-2xl bg-white shadow-md transition hover:shadow-lg">
            <div class="relative aspect-[1/0.95] overflow-hidden"><CakeImage :src="r.product.images?.[0]" :alt="r.product.name" />
              <span class="absolute top-1.5 left-1.5 rounded-full bg-brand-600 px-2 py-0.5 text-xs font-semibold text-white">โปร</span>
            </div>
            <div class="p-2.5 sm:p-3">
              <div class="line-clamp-2 min-h-[2.4em] text-[13px] leading-snug font-semibold text-stone-900 sm:text-base">{{ r.product.name }}</div>
              <StorePrice :price="r.price" :regular="r.regular" />
              <div v-if="r.promo" class="mt-0.5 line-clamp-1 text-xs text-stone-600">{{ r.promo }}</div>
            </div>
          </RouterLink>
        </li>
      </ul>
    </section>

    <!-- ขายดี -->
    <section v-if="best.length">
      <div class="mb-3 flex items-center justify-between gap-3">
        <h2 class="text-2xl text-stone-900">สินค้าขายดี</h2>
        <RouterLink to="/menu" class="btn-peach h-10 px-4">ดูทั้งหมด</RouterLink>
      </div>
      <div class="grid grid-cols-3 gap-2.5 sm:gap-4 md:grid-cols-6 2xl:grid-cols-8">
        <RouterLink v-for="b in best" :key="b.product.id" :to="`/menu/ready/${b.product.id}`" class="group overflow-hidden rounded-2xl bg-white shadow-md transition hover:shadow-lg">
          <div class="relative aspect-[1/0.95] overflow-hidden"><CakeImage :src="b.product.images?.[0]" :alt="b.product.name" />
            <span class="absolute top-1.5 left-1.5 rounded-full bg-brand-600 px-2 py-0.5 text-xs font-semibold text-white">ยอดฮิต</span>
          </div>
          <div class="p-2 sm:p-3">
            <div class="line-clamp-2 min-h-[2.4em] text-[13px] leading-snug font-semibold text-stone-900 sm:text-base">{{ b.product.name }}</div>
            <StorePrice :price="b.price" :regular="b.regular" />
          </div>
        </RouterLink>
      </div>
    </section>

    <!-- เค้กสั่งทำ: รูปล่าสุดที่ส่งมอบแล้ว 6 แบบ (การ์ดแบบเดียวกับแกลเลอรี) (ไม่มี → การ์ดประเภทเดิม) -->
    <section v-if="types.length || recent.length" class="relative">
      <div class="mb-3 flex items-center justify-between gap-3">
        <h2 class="text-2xl text-stone-900">เค้กสั่งทำตามใจ</h2>
        <div class="flex shrink-0 flex-wrap justify-end gap-2">
          <RouterLink to="/menu/custom" class="btn-peach h-10 px-4" aria-label="ออกแบบที่ต้องการ เค้กสั่งทำ">ออกแบบที่ต้องการ</RouterLink>
          <RouterLink to="/menu/gallery" class="btn-peach h-10 px-4" aria-label="ดูทั้งหมด ผลงานเค้กสั่งทำ">ดูทั้งหมด</RouterLink>
        </div>
      </div>
      <template v-if="recent.length">
        <ul class="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-6" aria-label="เค้กสั่งทำล่าสุด">
          <li v-for="g in recent" :key="g.id">
            <RouterLink :to="`/menu/design/${g.id}`" class="group block w-full overflow-hidden rounded-3xl bg-white text-left shadow-md transition hover:shadow-lg">
              <div class="aspect-square overflow-hidden"><img :src="g.image" :alt="altOf(g)" loading="lazy" class="h-full w-full object-cover transition group-hover:scale-105" /></div>
              <div class="p-2.5">
                <div class="line-clamp-1 text-sm font-semibold text-stone-900">{{ g.typeName || 'เค้กสั่งทำ' }}</div>
                <div class="line-clamp-1 text-xs text-stone-600">{{ g.tagNames.filter((t) => t.groupKey !== 'type').map((t) => t.name).join(' · ') || '—' }}</div>
              </div>
            </RouterLink>
          </li>
        </ul>
        <div class="mt-3 text-center"><RouterLink to="/menu/gallery" class="text-sm font-medium text-brand-700 underline">ดูผลงานเค้กสั่งทำทั้งหมด · ค้นหาแบบที่ชอบ</RouterLink></div>
      </template>
      <div v-else class="grid grid-cols-4 gap-2 sm:gap-4">
        <RouterLink v-for="t in types" :key="t.type.id" :to="`/menu/custom/${t.type.id}`" class="overflow-hidden rounded-2xl bg-white shadow-md transition hover:shadow-lg">
          <div class="aspect-[1/0.85] overflow-hidden"><CakeImage :src="t.type.images?.[0]" :alt="t.type.name" /></div>
          <div class="px-1 pt-1.5 pb-2 text-center sm:p-3">
            <div class="line-clamp-2 min-h-[2.5em] text-xs leading-tight font-semibold text-stone-900 sm:text-base">{{ t.type.name }}</div>
            <StorePrice :price="t.from" :regular="t.regularFrom" from />
          </div>
        </RouterLink>
      </div>
    </section>

    <!-- แกลเลอรี -->
    <section v-if="s.gallery.length">
      <h2 class="mb-3 text-2xl text-stone-900">ผลงานของเรา</h2>
      <div class="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
        <figure v-for="(g, i) in s.gallery" :key="i" class="overflow-hidden rounded-2xl bg-white shadow-md">
          <div class="aspect-square overflow-hidden"><img :src="g.image" :alt="g.caption || 'ผลงาน'" loading="lazy" class="h-full w-full object-cover" /></div>
          <figcaption v-if="g.caption" class="px-3 py-2 text-xs text-stone-600">{{ g.caption }}</figcaption>
        </figure>
      </div>
    </section>

    <!-- รีวิว -->
    <section v-if="reviews.length">
      <h2 class="mb-1 text-2xl text-stone-900">เสียงจากลูกค้า</h2>
      <p class="mb-3 text-sm text-stone-600"><span class="text-amber-500">★</span> {{ rating.toFixed(1) }} จาก {{ db.reviews.filter((r) => r.status === 'approved').length }} รีวิว</p>
      <div class="grid gap-3 md:grid-cols-3">
        <figure v-for="r in reviews" :key="r.id" class="card shadow-md">
          <div class="text-amber-500" :aria-label="`${r.rating} ดาว`">{{ stars(r.rating) }}</div>
          <blockquote class="mt-1 text-sm break-words text-stone-700">{{ r.text }}</blockquote>
          <figcaption class="mt-2 text-xs text-stone-600">— {{ r.name }}</figcaption>
        </figure>
      </div>
    </section>

    <!-- วิธีสั่ง (timeline) -->
    <section v-if="s.howToOrder.length" class="relative">
      <Doodles side="right" class="opacity-70" />
      <h2 class="mb-3 text-2xl text-stone-900">วิธีสั่งซื้อ</h2>
      <ol class="relative mx-auto max-w-xl space-y-3.5 pr-6">
        <span class="absolute top-6 bottom-6 left-[5.5rem] w-[3px] rounded bg-stone-800" aria-hidden="true"></span>
        <li v-for="(h, i) in s.howToOrder" :key="i" class="relative grid grid-cols-[4rem_1.875rem_1fr] items-center gap-3">
          <StepArt :i="i" />
          <span class="relative z-10 flex h-[1.875rem] w-[1.875rem] items-center justify-center rounded-full bg-stone-800 text-[15px] font-semibold text-white">{{ i + 1 }}</span>
          <div class="min-w-0"><div class="font-display text-lg text-stone-900">{{ h.title }}</div><p class="text-sm leading-snug text-stone-700">{{ h.text }}</p></div>
        </li>
      </ol>
      <div class="mt-4"><StoreOrderButtons /></div>
    </section>

    <!-- FAQ + นโยบาย -->
    <section v-if="s.faq.length || s.policies.length" class="grid grid-cols-2 gap-3.5 sm:gap-8">
      <div v-if="s.faq.length" class="min-w-0">
        <h2 class="mb-2.5 text-xl text-stone-900 sm:text-2xl">คำถามที่พบบ่อย</h2>
        <details v-for="(f, i) in s.faq" :key="i" class="card mb-2.5 rounded-2xl p-0 shadow-md">
          <summary class="min-h-[3.25rem] cursor-pointer list-none px-3.5 py-3 text-[14.5px] font-semibold text-stone-900">{{ f.q }}</summary>
          <p class="px-3.5 pb-3 text-sm text-stone-700">{{ f.a }}</p>
        </details>
      </div>
      <div v-if="s.policies.length" class="min-w-0">
        <h2 class="mb-2.5 text-xl text-stone-900 sm:text-2xl">นโยบายร้าน</h2>
        <details v-for="(f, i) in s.policies" :key="i" class="card mb-2.5 rounded-2xl p-0 shadow-md">
          <summary class="min-h-[3.25rem] cursor-pointer list-none px-3.5 py-3 text-[14.5px] font-semibold text-stone-900">{{ f.title }}</summary>
          <p class="px-3.5 pb-3 text-sm text-stone-700">{{ f.text }}</p>
        </details>
      </div>
    </section>

    <!-- ติดต่อ -->
    <section class="card rounded-3xl p-5 shadow-md">
      <h2 class="mb-1.5 text-[22px] text-stone-900">ติดต่อร้าน</h2>
      <p v-if="s.address" class="mb-3 flex gap-2 text-sm text-stone-700"><AppIcon name="pin" :size="16" class="mt-0.5 text-stone-500" /> {{ s.address }}</p>
      <div class="flex flex-wrap gap-2">
        <a v-if="s.mapUrl" :href="s.mapUrl" target="_blank" rel="noopener" class="btn-outline"><AppIcon name="pin" :size="16" /> ดูแผนที่</a>
        <StoreOrderButtons />
      </div>
    </section>
  </div>
</template>
