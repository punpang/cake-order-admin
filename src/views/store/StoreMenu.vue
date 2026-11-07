<script setup>
import { computed, ref } from 'vue'
import { db } from '../../data/store'
import { readyMenu, readyByCategory, customMenu, activePromotions } from '../../lib/storefront'
import CakeImage from '../../components/CakeImage.vue'
import StorePrice from '../../components/StorePrice.vue'
import StoreOrderButtons from '../../components/StoreOrderButtons.vue'
import Bunting from '../../components/art/Bunting.vue'
import CakeArt from '../../components/art/CakeArt.vue'

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
    <h1 class="text-[28px] text-stone-900">เมนูเค้ก</h1>
    <p class="mt-1 text-sm text-stone-600">เลือกดูแล้วกดสั่งทางแชท LINE / Facebook ร้านจะยืนยันราคาและวันเวลารับให้</p>

    <div v-if="promos.length" class="relative mt-4 overflow-hidden rounded-3xl border-2 border-[#f3e3c7] bg-white px-4 pt-7 pb-3 text-sm text-stone-800 shadow-md"><Bunting />
      โปรโมชันตอนนี้: <b>{{ promos.map((p) => p.name).join(' · ') }}</b> (ราคาที่แสดงรวมโปรแล้ว)
    </div>

    <div class="mt-5 grid max-w-sm grid-cols-2 seg-grid">
      <button v-for="t in tabs" :key="t.v" type="button" class="seg-item" :class="tab === t.v ? 'seg-on' : ''" @click="tab = t.v">
        {{ t.l }} ({{ t.n }})
      </button>
    </div>

    <div v-if="tab === 'ready'" class="mt-5">
      <div v-if="!sections.length" class="empty"><div class="h-24 w-28 overflow-hidden rounded-2xl"><CakeArt kind="cream" /></div>ยังไม่มีสินค้าในเมนู</div>
      <nav v-if="sections.length > 1" class="mb-4 flex flex-wrap gap-1.5" aria-label="หมวดสินค้า">
        <a v-for="s in sections" :key="s.key" :href="`#cat-${s.key}`" class="chip chip-off" @click.prevent="jump(s.key)">{{ s.category }} <span class="opacity-60">{{ s.items.length }}</span></a>
      </nav>
      <section v-for="s in sections" :id="`cat-${s.key}`" :key="s.key" class="mb-7" :aria-label="`หมวด ${s.category}`">
        <h2 class="mb-2.5 text-xl text-stone-900">{{ s.category }}</h2>
        <div class="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
          <RouterLink v-for="r in s.items" :key="r.product.id" :to="`/menu/ready/${r.product.id}`" class="overflow-hidden rounded-3xl bg-white shadow-md transition hover:shadow-lg" :class="r.stockState === 'out' ? 'opacity-60' : ''">
            <div class="relative aspect-square overflow-hidden"><CakeImage :src="r.product.images?.[0]" :alt="r.product.name" />
              <span v-if="r.discounted" class="absolute top-2 left-2 rounded-full bg-brand-600 px-2.5 py-0.5 text-xs font-semibold text-white">โปร</span>
              <span v-if="r.stockState === 'out'" class="absolute top-2 right-2 rounded-full bg-stone-800/80 px-2.5 py-0.5 text-xs font-medium text-white">หมด</span>
              <span v-else-if="r.stockState === 'low'" class="absolute top-2 right-2 rounded-full bg-honey px-2.5 py-0.5 text-xs font-semibold text-stone-900">เหลือ {{ r.stock }}</span>
            </div>
            <div class="p-3">
              <div class="truncate font-semibold text-stone-900">{{ r.product.name }}</div>
              <StorePrice :price="r.price" :regular="r.regular" />
              <div v-if="r.options.length" class="mt-0.5 truncate text-xs text-stone-500">เลือกได้: {{ r.options.map((o) => o.name).join(' · ') }}</div>
            </div>
          </RouterLink>
        </div>
      </section>
    </div>

    <div v-else class="mt-5">
      <div v-if="!custom.length" class="empty"><div class="h-24 w-28 overflow-hidden rounded-2xl"><CakeArt kind="fondant" /></div>ยังไม่มีเค้กสั่งทำในเมนู</div>
      <RouterLink v-else to="/menu/custom" class="block overflow-hidden rounded-3xl bg-white shadow-md transition hover:shadow-lg sm:flex" aria-label="เค้กสั่งทำ">
        <div class="relative aspect-4/3 overflow-hidden sm:w-1/2"><CakeImage :src="coverImg" alt="เค้กสั่งทำ" />
          <span v-if="customDiscounted" class="absolute top-2 left-2 rounded-full bg-brand-600 px-2.5 py-0.5 text-xs font-semibold text-white">โปร</span>
        </div>
        <div class="space-y-1 p-4 sm:w-1/2">
          <div class="font-display text-xl text-stone-900">เค้กสั่งทำ</div>
          <StorePrice :price="customFrom" :regular="customRegular" from />
          <div class="text-sm text-stone-600">{{ custom.length }} ประเภท · เลือกเนื้อเค้ก ขนาด ตกแต่ง ได้ตามใจ</div>
          <div class="text-xs text-stone-500">รูปตัวอย่างเปลี่ยนตามสิ่งที่เลือก · กดเพื่อเลือกแบบและดูราคา</div>
        </div>
      </RouterLink>
    </div>

    <section class="card relative mt-10 overflow-hidden pt-8"><Bunting /><h2 class="mb-2 text-xl text-stone-900">สั่งเค้ก</h2><StoreOrderButtons /></section>
  </div>
</template>
