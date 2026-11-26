<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { safeHref } from '../../lib/safeUrl'
import { db } from '../../data/store'
import { readyMenu, customMenu, alsoBoughtFor } from '../../lib/storefront'
import { money } from '../../lib/format'
import AppIcon from '../../components/AppIcon.vue'
import CakeImage from '../../components/CakeImage.vue'
import StorePrice from '../../components/StorePrice.vue'
import StoreOrderButtons from '../../components/StoreOrderButtons.vue'
import CakeConfigurator from '../../components/CakeConfigurator.vue'
import { galleryOf, pickImage, imageNote, optionIndex } from '../../lib/cakeImage'
import { latestCustomPhotos } from '../../lib/cakeSearch'
import { recommendPhotos } from '../../lib/cakeReco'

// รายละเอียดเค้ก (สาธารณะ) · kind = ready (เค้กสำเร็จ) | custom (ประเภทของเค้กสั่งทำ) · ไม่มีตะกร้า สั่งทางแชท
const props = defineProps({ kind: { type: String, required: true }, id: { type: String, default: '' } })
const nameOf = (key, id) => db.optionGroups.find((g) => g.key === key)?.options.find((o) => o.id === id)?.name || ''

// เค้กสั่งทำ = หน้าเดียว (เลือกประเภทในหน้า) · /menu/custom/:id = เลือกประเภทนั้นไว้ก่อน
const types = computed(() => customMenu(db))
// ?photo=<id> (จากปุ่ม "สั่งแบบนี้") เติมประเภท+ตัวเลือกตามแท็กรูป · ไม่มี → ยังไม่เลือกประเภท
const route = useRoute()
const photoId = computed(() => (props.kind === 'custom' ? String(route.query.photo || '') : ''))
const photo = computed(() => (photoId.value ? latestCustomPhotos(db).find((x) => x.id === photoId.value) || null : null))
const photoType = computed(() => { const ix = optionIndex(db.optionGroups); return photo.value?.tags.find((t) => ix.get(t)?.groupKey === 'type') || '' })
const preselect = computed(() => photo.value?.tags || [])
const typeId = ref(props.id || photoType.value || '')
watch(types, (l) => { if (props.kind === 'custom' && typeId.value && !l.some((x) => x.type.id === typeId.value)) typeId.value = '' }, { immediate: true })
watch(() => props.id, (v) => { if (v) typeId.value = v })
watch(photoType, (v) => { if (v) typeId.value = v })
const st = ref({ missing: [], total: 0 })
const complete = computed(() => !st.value.missing.length)
const selIds = ref([])
const altIdx = ref(0)
const pick = computed(() => pickImage(selIds.value, galleryOf(db), db.optionGroups, { ignoreGroups: ['size'] }))
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
  const all = customMenu(db)
  if (!all.length) return null
  const t = all.find((x) => x.type.id === typeId.value)
  const low = (k) => Math.min(...all.map((x) => x[k]))
  return { title: 'เค้กสั่งทำ', images: [], sub: t?.type.name || '', price: t ? t.from : low('from'), regular: t ? t.regularFrom : low('regularFrom'), from: true, custom: t || true, text: t ? `สนใจสั่งเค้กสั่งทำ ${t.type.name}` : 'สนใจสั่งเค้กสั่งทำ' }
})

// แถบสั่งติดล่าง: แสดงเฉพาะเมื่อร้านตั้งช่องทางสั่งไว้ (ไม่มีช่องทาง = ไม่มีปุ่มให้กด จึงไม่แสดงแถบว่าง)
const fbHref = computed(() => safeHref(db.storefront.facebookUrl))
// เค้กสั่งทำมีแถบราคา+คัดลอกติดล่างในฟอร์มเอง จึงไม่ซ้อนแถบนี้
const barOn = computed(() => !!item.value && !item.value.custom && !!(fbHref.value || db.storefront.phone))
// ปุ่มแชทลอยต้องยกพ้นแถบล่าง: แถบสั่ง (สินค้าสำเร็จรูป) หรือแถบราคาในฟอร์ม (เค้กสั่งทำ)
const ctaOn = computed(() => barOn.value || !!item.value?.custom)
// รูปเค้กสั่งทำติดบน: เลื่อนโฟกัส/ปุ่มไม่ให้ไปอยู่ใต้รูป
onMounted(() => document.documentElement.classList.add('has-sticky-photo'))
onBeforeUnmount(() => document.documentElement.classList.remove('has-sticky-photo', 'has-cta-bar'))
watch(ctaOn, (v) => document.documentElement.classList.toggle('has-cta-bar', v), { immediate: true })
// แบบที่แนะนำ: 4 แบบแรก โหลดเพิ่มทีละ 4 (กดดูเพิ่ม/เลื่อนลงสุด)
const REC = 4
const recAll = computed(() => (props.kind === 'custom' ? recommendPhotos(db, { photoId: photoId.value, selectedIds: selIds.value }) : []))
// ลูกค้าก็สนใจ: สินค้าที่มักสั่งร่วมกับเมนูนี้ (แสดงอย่างเดียว)
const also = computed(() => (props.kind === 'ready' && props.id ? alsoBoughtFor(db, props.id) : []))
const recLimit = ref(REC)
const recShown = computed(() => recAll.value.slice(0, recLimit.value))
const recMore = computed(() => recAll.value.length > recLimit.value)
const recLoad = () => { if (recMore.value) recLimit.value += REC }
const recEnd = ref(null)
let recIo
let touched = false
let armT
const mark = () => { touched = true }
const EVS = ['scroll', 'wheel', 'touchmove', 'keydown', 'pointerdown']
onMounted(() => {
  // เว้นช่วงแรก: การเลื่อนอัตโนมัติตอนเปลี่ยนหน้าไม่นับ
  armT = setTimeout(() => EVS.forEach((e) => window.addEventListener(e, mark, { passive: true, once: true })), 700)
  if (typeof IntersectionObserver === 'undefined') return
  recIo = new IntersectionObserver((es) => { if (touched && es.some((e) => e.isIntersecting)) recLoad() }, { rootMargin: '200px' })
  watch(recEnd, (el, old) => { if (old) recIo.unobserve(old); if (el) recIo.observe(el) }, { immediate: true, flush: 'post' })
})
onBeforeUnmount(() => { recIo?.disconnect(); clearTimeout(armT); EVS.forEach((e) => window.removeEventListener(e, mark)) })
const cur = ref(0)
watch(() => [props.kind, props.id], () => (cur.value = 0))
</script>

<template>
  <div class="mx-auto max-w-6xl px-4 pt-6 lg:px-8" :class="barOn ? 'pb-40 md:pb-0' : ''">
    <RouterLink to="/menu" class="tap mb-4 inline-flex min-h-11 items-center gap-1 text-sm text-stone-600 hover:text-brand-700"><AppIcon name="back" :size="16" /> กลับเมนู</RouterLink>

    <div v-if="!item" class="empty">ไม่พบเมนูนี้ (อาจปิดการขายแล้ว) <RouterLink to="/menu" class="text-brand-700 underline">กลับไปเมนู</RouterLink></div>

    <div v-else class="grid gap-6 md:grid-cols-2">
      <div v-if="item.custom" class="sticky top-14 z-10 -mx-4 bg-cream/95 px-4 pt-1 pb-2 shadow-[0_6px_10px_-8px_rgb(63_46_46/0.35)] backdrop-blur md:top-20 md:z-0 md:mx-0 md:self-start md:bg-transparent md:p-0 md:shadow-none md:backdrop-blur-none" aria-label="รูปตัวอย่างเค้ก">
        <p v-if="!complete" class="rounded-2xl bg-[#fff1d6] p-3 text-sm text-stone-800" role="status" aria-label="เลือกให้ครบก่อนดูรูปตัวอย่าง">
          <b>เลือกให้ครบ {{ st.total }} หัวข้อก่อน จึงจะแสดงรูปตัวอย่าง</b>
          <span class="block text-xs md:text-sm">เลือกแล้ว {{ st.total - st.missing.length }}/{{ st.total }} · ขาด: {{ st.missing.join(', ') }}</span>
        </p>
        <div v-if="complete" class="mx-auto aspect-[16/10] max-h-[26dvh] overflow-hidden rounded-[1.75rem] shadow-md md:aspect-square md:max-h-none md:rounded-[2rem]">
          <Transition name="cake-fade" mode="out-in"><div :key="shown || 'none'" class="h-full w-full"><CakeImage :src="shown" :alt="item.title" /></div></Transition>
        </div>
        <p v-if="complete && note" class="mt-1.5 line-clamp-1 rounded-2xl bg-[#fff1d6] px-2.5 py-1.5 text-xs text-stone-800 md:mt-2 md:line-clamp-none md:p-2.5" role="note" aria-label="หมายเหตุรูปตัวอย่าง">{{ note }}</p>
        <div v-if="complete && pick.alternatives.length > 1" class="mt-1.5 flex gap-2 overflow-x-auto md:mt-2">
          <button v-for="(e, i) in pick.alternatives" :key="e.id" type="button" class="h-10 w-10 shrink-0 overflow-hidden rounded-xl border-2 md:h-16 md:w-16" :class="i === altIdx ? 'border-brand-500' : 'border-transparent'" :aria-label="`รูปที่ ${i + 1}`" @click="altIdx = i"><img :src="e.image" alt="" loading="lazy" decoding="async" class="h-full w-full object-cover" /></button>
        </div>
      </div>
      <div v-else>
        <div class="aspect-square overflow-hidden rounded-[2rem] shadow-md"><CakeImage :src="item.images[cur]" :alt="item.title" priority /></div>
        <div v-if="item.images.length > 1" class="mt-2 flex gap-2 overflow-x-auto">
          <button v-for="(src, i) in item.images" :key="i" type="button" class="h-16 w-16 shrink-0 overflow-hidden rounded-xl border-2" :class="i === cur ? 'border-brand-500' : 'border-transparent'" :aria-label="`รูปที่ ${i + 1}`" @click="cur = i">
            <img :src="src" alt="" loading="lazy" decoding="async" class="h-full w-full object-cover" />
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

        <CakeConfigurator v-if="item.custom" :type-id="typeId" :preselect="preselect" @select="selIds = $event" @status="st = $event">
          <template #types>
            <div role="group" aria-label="เลือกประเภทเค้ก" class="rounded-2xl border border-stone-200/70 bg-white p-3.5">
              <div class="mb-2.5 flex flex-wrap items-baseline gap-x-2">
                <span class="text-sm font-semibold text-stone-800">เลือกประเภทเค้ก</span>
                <span class="text-xs font-medium text-danger-700">จำเป็น</span>
              </div>
              <div class="flex flex-wrap gap-2">
                <button
                  v-for="t in types"
                  :key="t.type.id"
                  type="button"
                  class="inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-xl border px-3 py-2 text-left text-sm transition active:scale-[0.98]"
                  :class="typeId === t.type.id ? 'border-brand-500 bg-brand-50 text-brand-800 ring-1 ring-brand-500' : 'border-stone-200 bg-white text-stone-700 hover:border-brand-300'"
                  :aria-pressed="typeId === t.type.id"
                  @click="typeId = t.type.id"
                >
                  <AppIcon v-if="typeId === t.type.id" name="check" :size="14" class="text-brand-600" />
                  <span class="min-w-0 break-words">{{ t.type.name }}</span>
                </button>
              </div>
            </div>
          </template>
        </CakeConfigurator>

        <div class="mt-6 rounded-3xl bg-white p-4 shadow-md">
          <div class="mb-2 text-sm font-semibold text-stone-800">สนใจสั่ง?</div>
          <p class="mb-3 text-sm text-stone-500">กดปุ่มเพื่อคุยกับร้านทางแชท บอกวันเวลารับ ร้านจะส่งใบเสนอราคาให้ยืนยัน</p>
          <StoreOrderButtons :text="item.text" />
        </div>
      </div>
    </div>

    <section v-if="item && item.custom && recAll.length" class="mt-10 pb-2" aria-label="แบบที่แนะนำ">
      <h2 class="mb-1 text-2xl text-stone-900">แบบที่แนะนำ</h2>
      <p class="mb-3 text-sm text-stone-600">เรียงจากแบบที่ลูกค้าคนอื่นสนใจร่วมกัน และใกล้เคียงกับที่คุณเลือก</p>
      <ul class="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
        <li v-for="r in recShown" :key="r.id">
          <RouterLink :to="`/menu/design/${r.id}`" class="group block overflow-hidden rounded-3xl bg-white shadow-md transition hover:shadow-lg" :aria-label="`ดูแบบ ${r.typeName || 'เค้กสั่งทำ'}`">
            <div class="aspect-square overflow-hidden"><img :src="r.image" :alt="r.caption || r.typeName || 'เค้กสั่งทำ'" loading="lazy" class="h-full w-full object-cover transition group-hover:scale-105" /></div>
            <div class="p-2.5">
              <div class="line-clamp-1 text-sm font-semibold text-stone-900">{{ r.typeName || 'เค้กสั่งทำ' }}</div>
              <div class="line-clamp-1 text-xs text-stone-600">{{ r.tagNames.filter((t) => t.groupKey !== 'type').map((t) => t.name).join(' · ') || '—' }}</div>
            </div>
          </RouterLink>
        </li>
      </ul>
      <div class="mt-4 text-center" aria-live="polite">
        <button v-if="recMore" type="button" class="btn-peach px-6" @click="recLoad">ดูเพิ่ม</button>
        <div ref="recEnd" class="h-1" aria-hidden="true"></div>
      </div>
    </section>

    <section v-if="also.length" class="mt-10 pb-2" aria-label="ลูกค้าก็สนใจ">
      <h2 class="mb-1 text-2xl text-stone-900">ลูกค้าก็สนใจ</h2>
      <p class="mb-3 text-sm text-stone-600">สินค้าที่ลูกค้ามักสั่งร่วมกับเมนูนี้ · กดเพื่อดูรายละเอียด</p>
      <ul class="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
        <li v-for="r in also" :key="r.product.id">
          <RouterLink :to="`/menu/ready/${r.product.id}`" class="block overflow-hidden rounded-3xl bg-white shadow-md transition hover:shadow-lg">
            <div class="aspect-square overflow-hidden"><CakeImage :src="r.product.images?.[0]" :alt="r.product.name" /></div>
            <div class="p-2.5">
              <div class="line-clamp-1 text-sm font-semibold text-stone-900">{{ r.product.name }}</div>
              <StorePrice :price="r.price" :regular="r.regular" />
            </div>
          </RouterLink>
        </li>
      </ul>
    </section>

    <!-- มือถือ: แถบสั่งติดล่าง (ราคา + สั่งทาง Facebook) อยู่เหนือแถบเมนูล่าง ไม่ต้องเลื่อนหาปุ่ม -->
    <div v-if="barOn" class="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 border-t border-stone-200 bg-white/95 px-4 py-2.5 shadow-[0_-6px_16px_-10px_rgb(63_46_46/0.35)] backdrop-blur-xl md:hidden">
      <div class="mx-auto flex max-w-page items-center gap-3">
        <div class="min-w-0 flex-1">
          <div class="truncate text-xs text-stone-600">{{ item.title }}</div>
          <StorePrice :price="item.price" :regular="item.regular" :from="item.from" />
        </div>
        <a v-if="fbHref" :href="fbHref" target="_blank" rel="noopener" class="btn-primary h-11 shrink-0 px-5"><AppIcon name="chat" :size="16" /> สั่งทาง Facebook</a>
        <a v-else-if="db.storefront.phone" :href="`tel:${db.storefront.phone}`" class="btn-primary h-11 shrink-0 px-5"><AppIcon name="phone" :size="16" /> โทรสั่ง</a>
      </div>
    </div>
  </div>
</template>
