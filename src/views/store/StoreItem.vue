<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { db } from '../../data/store'
import { readyMenu, customMenu } from '../../lib/storefront'
import { money } from '../../lib/format'
import AppIcon from '../../components/AppIcon.vue'
import CakeImage from '../../components/CakeImage.vue'
import StorePrice from '../../components/StorePrice.vue'
import StoreOrderButtons from '../../components/StoreOrderButtons.vue'
import CakeConfigurator from '../../components/CakeConfigurator.vue'
import { galleryOf, pickImage, imageNote } from '../../lib/cakeImage'

// รายละเอียดเค้ก (สาธารณะ) · kind = ready (เค้กสำเร็จ) | custom (ประเภทของเค้กสั่งทำ) · ไม่มีตะกร้า สั่งทางแชท
const props = defineProps({ kind: { type: String, required: true }, id: { type: String, default: '' } })
const nameOf = (key, id) => db.optionGroups.find((g) => g.key === key)?.options.find((o) => o.id === id)?.name || ''

// เค้กสั่งทำ = หน้าเดียว (เลือกประเภทในหน้า) · /menu/custom/:id = เลือกประเภทนั้นไว้ก่อน
const types = computed(() => customMenu(db))
const typeId = ref(props.id || '')
watch(types, (l) => { if (props.kind === 'custom' && !l.some((x) => x.type.id === typeId.value)) typeId.value = l[0]?.type.id || '' }, { immediate: true })
watch(() => props.id, (v) => { if (v) typeId.value = v })
const selIds = ref([])
const altIdx = ref(0)
const pick = computed(() => pickImage(selIds.value, galleryOf(db), db.optionGroups))
const note = computed(() => imageNote(pick.value))
const shown = computed(() => pick.value.alternatives[altIdx.value]?.image || pick.value.image || '')
watch(() => pick.value.entry?.id, () => (altIdx.value = 0))
const item = computed(() => {
  if (props.kind === 'ready') {
    const r = readyMenu(db).find((x) => x.product.id === props.id)
    if (!r) return null
    const p = r.product
    return { title: p.name, images: p.images || [], sub: [nameOf('type', p.typeId), nameOf('flavor', p.flavorId), nameOf('size', p.sizeId)].filter(Boolean).join(' · ') || p.category || '', desc: p.description || '', mods: (p.modifierIds || []).map((id) => (db.posModifiers || []).find((m) => m.id === id)).filter((m) => m && m.active !== false), stock: p.stock, promo: r.promo, price: r.price, regular: r.regular, text: `สนใจสั่ง ${p.name}` }
  }
  const t = customMenu(db).find((x) => x.type.id === typeId.value)
  if (!t) return null
  return { title: 'เค้กสั่งทำ', images: [], sub: t.type.name, price: t.from, regular: t.regularFrom, from: true, custom: t, text: `สนใจสั่งเค้กสั่งทำ ${t.type.name}` }
})

// รูปเค้กสั่งทำติดบน: เลื่อนโฟกัส/ปุ่มไม่ให้ไปอยู่ใต้รูป
onMounted(() => document.documentElement.classList.add('has-sticky-photo'))
onBeforeUnmount(() => document.documentElement.classList.remove('has-sticky-photo'))
const cur = ref(0)
watch(() => [props.kind, props.id], () => (cur.value = 0))
</script>

<template>
  <div class="mx-auto max-w-5xl px-4 pt-6">
    <RouterLink to="/menu" class="mb-4 inline-flex items-center gap-1 text-sm text-stone-600 hover:text-brand-700"><AppIcon name="back" :size="16" /> กลับเมนู</RouterLink>

    <div v-if="!item" class="empty">ไม่พบเมนูนี้ (อาจปิดการขายแล้ว) <RouterLink to="/menu" class="text-brand-700 underline">กลับไปเมนู</RouterLink></div>

    <div v-else class="grid gap-6 md:grid-cols-2">
      <div v-if="item.custom" class="sticky top-14 z-10 -mx-4 bg-cream/95 px-4 pt-1 pb-2 shadow-[0_6px_10px_-8px_rgb(63_46_46/0.35)] backdrop-blur md:top-20 md:z-0 md:mx-0 md:self-start md:bg-transparent md:p-0 md:shadow-none md:backdrop-blur-none" aria-label="รูปตัวอย่างเค้ก">
        <div class="mx-auto aspect-[16/10] max-h-[26dvh] overflow-hidden rounded-[1.75rem] shadow-md md:aspect-square md:max-h-none md:rounded-[2rem]">
          <Transition name="cake-fade" mode="out-in"><div :key="shown || 'none'" class="h-full w-full"><CakeImage :src="shown" :alt="item.title" /></div></Transition>
        </div>
        <p v-if="note" class="mt-1.5 line-clamp-1 rounded-2xl bg-[#fff1d6] px-2.5 py-1.5 text-xs text-stone-800 md:mt-2 md:line-clamp-none md:p-2.5" role="note" aria-label="หมายเหตุรูปตัวอย่าง">{{ note }}</p>
        <div v-if="pick.alternatives.length > 1" class="mt-1.5 flex gap-2 overflow-x-auto md:mt-2">
          <button v-for="(e, i) in pick.alternatives" :key="e.id" type="button" class="h-10 w-10 shrink-0 overflow-hidden rounded-xl border-2 md:h-16 md:w-16" :class="i === altIdx ? 'border-brand-500' : 'border-transparent'" :aria-label="`รูปที่ ${i + 1}`" @click="altIdx = i"><img :src="e.image" alt="" class="h-full w-full object-cover" /></button>
        </div>
      </div>
      <div v-else>
        <div class="aspect-square overflow-hidden rounded-[2rem] shadow-md"><CakeImage :src="item.images[cur]" :alt="item.title" /></div>
        <div v-if="item.images.length > 1" class="mt-2 flex gap-2 overflow-x-auto">
          <button v-for="(src, i) in item.images" :key="i" type="button" class="h-16 w-16 shrink-0 overflow-hidden rounded-xl border-2" :class="i === cur ? 'border-brand-500' : 'border-transparent'" :aria-label="`รูปที่ ${i + 1}`" @click="cur = i">
            <img :src="src" alt="" class="h-full w-full object-cover" />
          </button>
        </div>
      </div>

      <div>
        <h1 class="text-[28px] leading-tight text-stone-900">{{ item.title }}</h1>
        <p class="text-sm text-stone-600">{{ item.sub }}</p>
        <div class="mt-3"><StorePrice :price="item.price" :regular="item.regular" :from="item.from" /></div>
        <p v-if="item.promo" class="mt-1 inline-block rounded-full bg-brand-100 px-2.5 py-0.5 text-xs font-semibold text-brand-700">โปร: {{ item.promo }}</p>
        <p v-if="item.desc" class="mt-3 text-sm break-words text-stone-600">{{ item.desc }}</p>
        <p v-if="item.stock != null && item.stock <= 0" class="mt-2 inline-block rounded-full bg-stone-800 px-3 py-0.5 text-xs font-medium text-white">สินค้าหมด</p>
        <p v-else-if="item.stock != null && item.stock <= 5" class="mt-2 inline-block rounded-full bg-honey px-3 py-0.5 text-xs font-semibold text-stone-900">เหลือ {{ item.stock }} ชิ้น</p>
        <div v-for="m in item.mods || []" :key="m.id" class="mt-4"><div class="mb-1.5 text-sm font-semibold text-stone-800">{{ m.name }}<span v-if="m.type === 'multi'" class="font-normal text-stone-400"> (เลือกได้หลายอย่าง)</span></div><div class="flex flex-wrap gap-2"><span v-for="o in m.options" :key="o.id" class="chip chip-off">{{ o.name }}<template v-if="o.price"> +{{ money(o.price) }}</template></span></div></div>

        <div v-if="item.custom" class="mt-4" role="group" aria-label="เลือกประเภทเค้ก">
          <div class="mb-1.5 text-sm font-semibold text-stone-800">เลือกประเภทเค้ก</div>
          <div class="flex flex-wrap gap-2"><button v-for="t in types" :key="t.type.id" type="button" class="chip" :class="typeId === t.type.id ? 'chip-on' : 'chip-off'" :aria-pressed="typeId === t.type.id" @click="typeId = t.type.id">{{ t.type.name }}</button></div>
        </div>
        <CakeConfigurator v-if="item.custom" :type-id="typeId" @select="selIds = $event" />

        <div class="mt-6 rounded-3xl bg-white p-4 shadow-md">
          <div class="mb-2 text-sm font-semibold text-stone-800">สนใจสั่ง?</div>
          <p class="mb-3 text-sm text-stone-500">กดปุ่มเพื่อคุยกับร้านทางแชท บอกวันเวลารับ ร้านจะส่งใบเสนอราคาให้ยืนยัน</p>
          <StoreOrderButtons :text="item.text" />
        </div>
      </div>
    </div>
  </div>
</template>
