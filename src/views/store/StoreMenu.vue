<script setup>
import { computed, ref } from 'vue'
import { db } from '../../data/store'
import { readyMenu, readyByCategory, customMenu, activePromotions } from '../../lib/storefront'
import CakeImage from '../../components/CakeImage.vue'
import StorePrice from '../../components/StorePrice.vue'
import StoreOrderButtons from '../../components/StoreOrderButtons.vue'

// เมนูเค้ก (สาธารณะ): สินค้าพร้อมขาย (สินค้า POS ที่เปิด "แสดงที่หน้าร้านเว็บ") + เค้กสั่งทำ · ดูอย่างเดียว สั่งทางแชท
const tab = ref('ready')
const allReady = computed(() => readyMenu(db))
const sections = computed(() => readyByCategory(db))
const custom = computed(() => customMenu(db))
const customFrom = computed(() => Math.min(...custom.value.map((t) => t.from)))
const customRegular = computed(() => Math.min(...custom.value.map((t) => t.regularFrom)))
const customDiscounted = computed(() => custom.value.some((t) => t.discounted))
const coverImg = computed(() => custom.value.flatMap((t) => t.type.images || [])[0] || db.cakeGallery.find((g) => g.active !== false)?.image || '')
function jump(k) { document.getElementById(`cat-${k}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }
const promos = computed(() => activePromotions(db))
const tabs = computed(() => [
  { v: 'ready', l: 'สินค้าพร้อมขาย', n: allReady.value.length },
  { v: 'custom', l: 'เค้กสั่งทำ', n: custom.value.length ? 1 : 0 },
])
</script>

<template>
  <div class="mx-auto max-w-6xl px-4 pt-6">
    <h1 class="text-2xl font-semibold text-stone-900">เมนูเค้ก</h1>
    <p class="mt-1 text-sm text-stone-500">เลือกดูแล้วกดสั่งทางแชท LINE / Facebook ร้านจะยืนยันราคาและวันเวลารับให้</p>

    <div v-if="promos.length" class="mt-4 rounded-2xl border border-brand-200 bg-brand-50/60 p-3 text-sm text-brand-800">
      โปรโมชันตอนนี้: <b>{{ promos.map((p) => p.name).join(' · ') }}</b> (ราคาที่แสดงรวมโปรแล้ว)
    </div>

    <div class="mt-5 grid max-w-sm grid-cols-2 gap-1 rounded-2xl bg-stone-100 p-1">
      <button v-for="t in tabs" :key="t.v" type="button" class="h-10 rounded-xl text-sm font-semibold transition" :class="tab === t.v ? 'bg-white text-brand-700 shadow-sm' : 'text-stone-500'" @click="tab = t.v">
        {{ t.l }} ({{ t.n }})
      </button>
    </div>

    <div v-if="tab === 'ready'" class="mt-5">
      <p v-if="!sections.length" class="card py-10 text-center text-stone-500">ยังไม่มีสินค้าในเมนู</p>
      <nav v-if="sections.length > 1" class="mb-4 flex flex-wrap gap-1.5" aria-label="หมวดสินค้า">
        <a v-for="s in sections" :key="s.key" :href="`#cat-${s.key}`" class="chip chip-off" @click.prevent="jump(s.key)">{{ s.category }} <span class="opacity-60">{{ s.items.length }}</span></a>
      </nav>
      <section v-for="s in sections" :id="`cat-${s.key}`" :key="s.key" class="mb-7" :aria-label="`หมวด ${s.category}`">
        <h2 class="mb-2 text-lg font-semibold text-stone-900">{{ s.category }}</h2>
        <div class="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
          <RouterLink v-for="r in s.items" :key="r.product.id" :to="`/menu/ready/${r.product.id}`" class="overflow-hidden rounded-2xl border border-stone-200 bg-white transition hover:shadow-md" :class="r.stockState === 'out' ? 'opacity-60' : ''">
            <div class="relative aspect-square overflow-hidden"><CakeImage :src="r.product.images?.[0]" :alt="r.product.name" />
              <span v-if="r.discounted" class="absolute top-2 left-2 rounded-full bg-rose-500 px-2.5 py-0.5 text-xs font-medium text-white">โปร</span>
              <span v-if="r.stockState === 'out'" class="absolute top-2 right-2 rounded-full bg-stone-800/80 px-2.5 py-0.5 text-xs font-medium text-white">หมด</span>
              <span v-else-if="r.stockState === 'low'" class="absolute top-2 right-2 rounded-full bg-amber-500 px-2.5 py-0.5 text-xs font-medium text-white">เหลือ {{ r.stock }}</span>
            </div>
            <div class="p-3">
              <div class="truncate font-medium text-stone-900">{{ r.product.name }}</div>
              <StorePrice :price="r.price" :regular="r.regular" />
              <div v-if="r.options.length" class="mt-0.5 truncate text-xs text-stone-500">เลือกได้: {{ r.options.map((o) => o.name).join(' · ') }}</div>
            </div>
          </RouterLink>
        </div>
      </section>
    </div>

    <div v-else class="mt-5">
      <p v-if="!custom.length" class="card py-10 text-center text-stone-500">ยังไม่มีเค้กสั่งทำในเมนู</p>
      <RouterLink v-else to="/menu/custom" class="block overflow-hidden rounded-2xl border border-stone-200 bg-white transition hover:shadow-md sm:flex" aria-label="เค้กสั่งทำ">
        <div class="relative aspect-4/3 overflow-hidden sm:w-1/2"><CakeImage :src="coverImg" alt="เค้กสั่งทำ" />
          <span v-if="customDiscounted" class="absolute top-2 left-2 rounded-full bg-rose-500 px-2.5 py-0.5 text-xs font-medium text-white">โปร</span>
        </div>
        <div class="space-y-1 p-4 sm:w-1/2">
          <div class="text-lg font-semibold text-stone-900">เค้กสั่งทำ</div>
          <StorePrice :price="customFrom" :regular="customRegular" from />
          <div class="text-sm text-stone-600">{{ custom.length }} ประเภท · เลือกเนื้อเค้ก ขนาด ตกแต่ง ได้ตามใจ</div>
          <div class="text-xs text-stone-500">รูปตัวอย่างเปลี่ยนตามสิ่งที่เลือก · กดเพื่อเลือกแบบและดูราคา</div>
        </div>
      </RouterLink>
    </div>

    <section class="card mt-10"><h2 class="mb-2 font-semibold text-stone-900">สั่งเค้ก</h2><StoreOrderButtons /></section>
  </div>
</template>
