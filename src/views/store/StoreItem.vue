<script setup>
import { computed, ref, watch } from 'vue'
import { db } from '../../data/store'
import { readyMenu, customMenu } from '../../lib/storefront'
import { forType } from '../../lib/pricing'
import { MAIN_KEYS } from '../../lib/constants'
import { money } from '../../lib/format'
import AppIcon from '../../components/AppIcon.vue'
import CakeImage from '../../components/CakeImage.vue'
import StorePrice from '../../components/StorePrice.vue'
import StoreOrderButtons from '../../components/StoreOrderButtons.vue'
import CakeConfigurator from '../../components/CakeConfigurator.vue'

// รายละเอียดเค้ก (สาธารณะ) · kind = ready (เค้กสำเร็จ) | custom (ประเภทของเค้กสั่งทำ) · ไม่มีตะกร้า สั่งทางแชท
const props = defineProps({ kind: { type: String, required: true }, id: { type: String, required: true } })
const nameOf = (key, id) => db.optionGroups.find((g) => g.key === key)?.options.find((o) => o.id === id)?.name || ''

const item = computed(() => {
  if (props.kind === 'ready') {
    const r = readyMenu(db).find((x) => x.product.id === props.id)
    if (!r) return null
    const p = r.product
    return { title: p.name, images: p.images || [], sub: [nameOf('type', p.typeId), nameOf('flavor', p.flavorId), nameOf('size', p.sizeId)].filter(Boolean).join(' · ') || p.category || '', desc: p.description || '', promo: r.promo, price: r.price, regular: r.regular, text: `สนใจสั่ง ${p.name}` }
  }
  const t = customMenu(db).find((x) => x.type.id === props.id)
  if (!t) return null
  return { title: t.type.name, images: t.type.images || [], sub: 'เค้กสั่งทำ', price: t.from, regular: t.regularFrom, from: true, custom: t, text: `สนใจสั่งเค้กสั่งทำ ${t.type.name}` }
})

// ตัวเลือกเสริมของเค้กสั่งทำ (ใช้ได้กับประเภทนี้)
const extras = computed(() =>
  props.kind !== 'custom'
    ? []
    : db.optionGroups
        .filter((g) => g.active !== false && !MAIN_KEYS.includes(g.key) && g.type !== 'text' && g.appliesTo.includes('custom'))
        .map((g) => ({ id: g.id, name: g.name, options: (g.options || []).filter((o) => o.active !== false && forType(o, props.id)) }))
        .filter((g) => g.options.length),
)
const cur = ref(0)
watch(() => [props.kind, props.id], () => (cur.value = 0))
</script>

<template>
  <div class="mx-auto max-w-5xl px-4 pt-6">
    <RouterLink to="/menu" class="mb-4 inline-flex items-center gap-1 text-sm text-stone-600 hover:text-brand-700"><AppIcon name="back" :size="16" /> กลับเมนู</RouterLink>

    <div v-if="!item" class="card py-12 text-center text-stone-500">ไม่พบเมนูนี้ (อาจปิดการขายแล้ว) <RouterLink to="/menu" class="text-brand-700 underline">กลับไปเมนู</RouterLink></div>

    <div v-else class="grid gap-6 md:grid-cols-2">
      <div>
        <div class="aspect-square overflow-hidden rounded-3xl border border-stone-200"><CakeImage :src="item.images[cur]" :alt="item.title" /></div>
        <div v-if="item.images.length > 1" class="mt-2 flex gap-2 overflow-x-auto">
          <button v-for="(src, i) in item.images" :key="i" type="button" class="h-16 w-16 shrink-0 overflow-hidden rounded-xl border-2" :class="i === cur ? 'border-brand-500' : 'border-transparent'" :aria-label="`รูปที่ ${i + 1}`" @click="cur = i">
            <img :src="src" alt="" class="h-full w-full object-cover" />
          </button>
        </div>
      </div>

      <div>
        <h1 class="text-2xl font-semibold text-stone-900">{{ item.title }}</h1>
        <p class="text-sm text-stone-500">{{ item.sub }}</p>
        <div class="mt-3"><StorePrice :price="item.price" :regular="item.regular" :from="item.from" /></div>
        <p v-if="item.promo" class="mt-1 inline-block rounded-full bg-rose-50 px-2.5 py-0.5 text-xs font-medium text-rose-600">โปร: {{ item.promo }}</p>
        <p v-if="item.desc" class="mt-3 text-sm break-words text-stone-600">{{ item.desc }}</p>

        <template v-if="item.custom">
          <div class="mt-5">
            <div class="mb-1.5 text-sm font-semibold text-stone-800">ขนาดและราคา</div>
            <ul class="divide-y divide-stone-100 rounded-2xl border border-stone-200 bg-white text-sm">
              <li v-for="r in item.custom.sizes" :key="r.size.id" class="flex justify-between gap-3 px-4 py-2.5">
                <span>{{ r.size.name }}</span>
                <span><b class="text-stone-900">{{ money(r.price) }}</b> <s v-if="r.regular > r.price" class="text-stone-400">{{ money(r.regular) }}</s></span>
              </li>
            </ul>
            <p class="mt-1 text-xs text-stone-400">ราคาเริ่มต้นยังไม่รวมเนื้อเค้กบางแบบและตัวเลือกเสริม ร้านจะแจ้งราคาสุดท้ายในใบเสนอ</p>
          </div>
          <div class="mt-4">
            <div class="mb-1.5 text-sm font-semibold text-stone-800">{{ item.custom.flavorGroupName }}</div>
            <div class="flex flex-wrap gap-2"><span v-for="f in item.custom.flavors" :key="f.id" class="chip chip-off">{{ f.name }}<template v-if="f.price"> +{{ money(f.price) }}</template></span></div>
          </div>
          <div v-for="g in extras" :key="g.id" class="mt-4">
            <div class="mb-1.5 text-sm font-semibold text-stone-800">{{ g.name }}</div>
            <div class="flex flex-wrap gap-2"><span v-for="o in g.options" :key="o.id" class="chip chip-off">{{ o.name }}</span></div>
          </div>
        </template>

        <CakeConfigurator v-if="item.custom" :type-id="props.id" />

        <div class="mt-6 rounded-2xl border border-stone-200 bg-white p-4">
          <div class="mb-2 text-sm font-semibold text-stone-800">สนใจสั่ง?</div>
          <p class="mb-3 text-sm text-stone-500">กดปุ่มเพื่อคุยกับร้านทางแชท บอกวันเวลารับ ร้านจะส่งใบเสนอราคาให้ยืนยัน</p>
          <StoreOrderButtons :text="item.text" />
        </div>
      </div>
    </div>
  </div>
</template>
