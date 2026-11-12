<script setup>
import { computed, ref } from 'vue'
import { db } from '../../data/store'
import { readyMenu, readyByCategory, customMenu, activePromotions } from '../../lib/storefront'
import { OCCASIONS } from '../../lib/occasion'
import CakeImage from '../../components/CakeImage.vue'
import StorePrice from '../../components/StorePrice.vue'
import StoreOrderButtons from '../../components/StoreOrderButtons.vue'
import Bunting from '../../components/art/Bunting.vue'
import CakeArt from '../../components/art/CakeArt.vue'

// เมนูเค้ก (สาธารณะ): สินค้าพร้อมขาย (สินค้า POS ที่เปิด "แสดงที่หน้าร้านเว็บ") + เค้กสั่งทำ · ดูอย่างเดียว สั่งทางแชท
const tab = ref('ready')
const allReady = computed(() => readyMenu(db))
// ดูตามโอกาส: เลือกเองบนหน้าเว็บ (ไม่เก็บ) · ว่าง = ดูตามยอดขายทั้งหมด
const occasion = ref('')
const sections = computed(() => readyByCategory(db, undefined, occasion.value))
const custom = computed(() => customMenu(db))
const customFrom = computed(() => Math.min(...custom.value.map((t) => t.from)))
const customRegular = computed(() => Math.min(...custom.value.map((t) => t.regularFrom)))
const customDiscounted = computed(() => custom.value.some((t) => t.discounted))
function jump(k) { document.getElementById(`cat-${k}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }
const promos = computed(() => activePromotions(db))
const promoOpen = ref(false) // มือถือ: รายชื่อโปรยาว แสดง 2 บรรทัดก่อน กดดูทั้งหมดได้
const tabs = computed(() => [
  { v: 'ready', l: 'สินค้าพร้อมขาย', n: allReady.value.length },
  { v: 'custom', l: 'เค้กสั่งทำ', n: custom.value.length ? 1 : 0 },
])
</script>

<template>
  <div class="mx-auto max-w-page px-4 pt-6 lg:px-8">
    <h1 class="text-[28px] text-stone-900">เมนูเค้ก</h1>
    <p class="mt-1 text-sm text-stone-600">เลือกดูแล้วกดสั่งทางแชท LINE / Facebook ร้านจะยืนยันราคาและวันเวลารับให้</p>

    <div v-if="promos.length" class="relative mt-4 overflow-hidden rounded-3xl border-2 border-[#f3e3c7] bg-white px-4 pt-7 pb-3 text-sm text-stone-800 shadow-md"><Bunting />
      <p :class="promoOpen ? '' : 'line-clamp-2 md:line-clamp-none'">โปรโมชันตอนนี้: <b>{{ promos.map((p) => p.name).join(' · ') }}</b> (ราคาที่แสดงรวมโปรแล้ว)</p>
      <button v-if="promos.length > 2" type="button" class="mt-1 text-sm font-medium text-brand-700 underline md:hidden" :aria-expanded="promoOpen" @click="promoOpen = !promoOpen">{{ promoOpen ? 'ย่อ' : `ดูโปรทั้งหมด (${promos.length})` }}</button>
    </div>

    <div class="mt-5 grid max-w-sm grid-cols-2 seg-grid">
      <button v-for="t in tabs" :key="t.v" type="button" class="seg-item" :class="tab === t.v ? 'seg-on' : ''" @click="tab = t.v">
        {{ t.l }} ({{ t.n }})
      </button>
    </div>

    <div v-if="tab === 'ready'" class="mt-5">
      <div v-if="!sections.length" class="empty"><div class="h-24 w-28 overflow-hidden rounded-2xl"><CakeArt kind="cream" /></div>ยังไม่มีสินค้าในเมนู</div>
      <div class="chip-row mb-3" role="group" aria-label="ดูตามโอกาส">
        <span class="shrink-0 text-sm text-stone-600">ดูตามโอกาส:</span>
        <button type="button" class="chip" :class="!occasion ? 'chip-on' : 'chip-off'" @click="occasion = ''">ทั้งหมด</button>
        <button v-for="o in OCCASIONS" :key="o.key" type="button" class="chip" :class="occasion === o.key ? 'chip-on' : 'chip-off'" @click="occasion = o.key">{{ o.label }}</button>
      </div>
      <nav v-if="sections.length > 1" class="chip-row mb-4" aria-label="หมวดสินค้า">
        <a v-for="s in sections" :key="s.key" :href="`#cat-${s.key}`" class="chip chip-off" @click.prevent="jump(s.key)">{{ s.category }} <span class="opacity-60">{{ s.items.length }}</span></a>
      </nav>
      <section v-for="s in sections" :id="`cat-${s.key}`" :key="s.key" class="mb-7" :aria-label="`หมวด ${s.category}`">
        <h2 class="mb-2.5 text-xl text-stone-900">{{ s.category }}</h2>
        <div class="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
          <RouterLink v-for="r in s.items" :key="r.product.id" :to="`/menu/ready/${r.product.id}`" class="overflow-hidden rounded-3xl bg-white shadow-md transition hover:shadow-lg">
            <!-- สินค้าหมด: ทำให้รูปจางลงอย่างเดียว ชื่อและราคายังอ่านชัด (เดิมจางทั้งการ์ดจนตัวหนังสือ contrast ไม่ถึงเกณฑ์) -->
            <div class="relative aspect-square overflow-hidden"><CakeImage :src="r.product.images?.[0]" :alt="r.product.name" :class="r.stockState === 'out' ? 'opacity-50 grayscale' : ''" />
              <span v-if="r.hot" class="absolute bottom-2 left-2 rounded-full bg-white/90 px-2.5 py-0.5 text-xs font-semibold text-brand-700 shadow-sm">{{ r.hotLabel }}</span>
              <span v-if="r.discounted" class="absolute top-2 left-2 rounded-full bg-brand-700 px-2.5 py-0.5 text-xs font-semibold text-white">โปร</span>
              <span v-if="r.stockState === 'out'" class="absolute top-2 right-2 rounded-full bg-stone-800 px-2.5 py-0.5 text-xs font-medium text-white">หมด</span>
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
        <div class="relative aspect-4/3 overflow-hidden sm:w-1/2"><CakeArt kind="fondant" />
          <span v-if="customDiscounted" class="absolute top-2 left-2 rounded-full bg-brand-700 px-2.5 py-0.5 text-xs font-semibold text-white">โปร</span>
        </div>
        <div class="space-y-1 p-4 sm:w-1/2">
          <div class="font-display text-xl text-stone-900">เค้กสั่งทำ</div>
          <StorePrice :price="customFrom" :regular="customRegular" from />
          <div class="text-sm text-stone-600">{{ custom.length }} ประเภท · เลือกเนื้อเค้ก ขนาด ตกแต่ง ได้ตามใจ</div>
          <div class="text-xs text-stone-600">รูปตัวอย่างเปลี่ยนตามสิ่งที่เลือก · กดเพื่อเลือกแบบและดูราคา</div>
        </div>
      </RouterLink>
      <div v-if="custom.length" class="mt-3 text-center"><RouterLink to="/menu/gallery" class="text-sm font-medium text-brand-700 underline">ดูผลงานเค้กสั่งทำล่าสุด</RouterLink></div>
    </div>

    <section class="card relative mt-10 overflow-hidden pt-8"><Bunting /><h2 class="mb-2 text-xl text-stone-900">สั่งเค้ก</h2><StoreOrderButtons /></section>
  </div>
</template>
