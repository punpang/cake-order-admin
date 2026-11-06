<script setup>
import { computed, ref } from 'vue'
import { db } from '../../data/store'
import { readyMenu, customMenu, activePromotions } from '../../lib/storefront'
import CakeImage from '../../components/CakeImage.vue'
import StorePrice from '../../components/StorePrice.vue'
import StoreOrderButtons from '../../components/StoreOrderButtons.vue'

// เมนูเค้ก (สาธารณะ): สินค้าพร้อมขาย (สินค้า POS ที่เปิด "แสดงที่หน้าร้านเว็บ") + เค้กสั่งทำ · ดูอย่างเดียว สั่งทางแชท
const tab = ref('ready')
const allReady = computed(() => readyMenu(db))
const cats = computed(() => [...new Set(allReady.value.map((r) => r.product.category).filter(Boolean))])
const cat = ref('')
const ready = computed(() => allReady.value.filter((r) => !cat.value || r.product.category === cat.value))
const custom = computed(() => customMenu(db))
const promos = computed(() => activePromotions(db))
const tabs = computed(() => [
  { v: 'ready', l: 'สินค้าพร้อมขาย', n: allReady.value.length },
  { v: 'custom', l: 'เค้กสั่งทำ', n: custom.value.length },
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
      <div v-if="cats.length > 1" class="mb-3 flex flex-wrap gap-1.5">
        <button type="button" class="chip" :class="!cat ? 'chip-on' : 'chip-off'" @click="cat = ''">ทั้งหมด</button>
        <button v-for="c in cats" :key="c" type="button" class="chip" :class="cat === c ? 'chip-on' : 'chip-off'" @click="cat = c">{{ c }}</button>
      </div>
      <p v-if="!ready.length" class="card py-10 text-center text-stone-500">ยังไม่มีสินค้าในเมนู</p>
      <div class="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
        <RouterLink v-for="r in ready" :key="r.product.id" :to="`/menu/ready/${r.product.id}`" class="overflow-hidden rounded-2xl border border-stone-200 bg-white transition hover:shadow-md">
          <div class="relative aspect-square overflow-hidden"><CakeImage :src="r.product.images?.[0]" :alt="r.product.name" />
            <span v-if="r.discounted" class="absolute top-2 left-2 rounded-full bg-rose-500 px-2.5 py-0.5 text-xs font-medium text-white">โปร</span>
          </div>
          <div class="p-3">
            <div class="truncate font-medium text-stone-900">{{ r.product.name }}</div>
            <StorePrice :price="r.price" :regular="r.regular" />
          </div>
        </RouterLink>
      </div>
    </div>

    <div v-else class="mt-5">
      <p v-if="!custom.length" class="card py-10 text-center text-stone-500">ยังไม่มีเค้กสั่งทำในเมนู</p>
      <div class="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
        <RouterLink v-for="t in custom" :key="t.type.id" :to="`/menu/custom/${t.type.id}`" class="overflow-hidden rounded-2xl border border-stone-200 bg-white transition hover:shadow-md">
          <div class="relative aspect-4/3 overflow-hidden"><CakeImage :src="t.type.images?.[0]" :alt="t.type.name" />
            <span v-if="t.discounted" class="absolute top-2 left-2 rounded-full bg-rose-500 px-2.5 py-0.5 text-xs font-medium text-white">โปร</span>
          </div>
          <div class="p-3">
            <div class="truncate font-medium text-stone-900">{{ t.type.name }}</div>
            <StorePrice :price="t.from" :regular="t.regularFrom" from />
            <div class="mt-0.5 text-xs text-stone-500">{{ t.flavors.length }} เนื้อเค้ก · {{ t.sizes.length }} ขนาด</div>
          </div>
        </RouterLink>
      </div>
    </div>

    <section class="card mt-10"><h2 class="mb-2 font-semibold text-stone-900">สั่งเค้ก</h2><StoreOrderButtons /></section>
  </div>
</template>
