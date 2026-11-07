<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { db } from '../../data/store'
import { latestCustomPhotos, searchCakePhotos } from '../../lib/cakeSearch'
import AppIcon from '../../components/AppIcon.vue'
import CakeArt from '../../components/art/CakeArt.vue'

// ผลงานเค้กสั่งทำล่าสุด (สาธารณะ): 10 รูปแรก โหลดเพิ่มทีละ 10 · ค้นหาแบบใกล้เคียงที่สุด · เฉพาะรูปที่ร้านเผยแพร่และลูกค้าไม่ได้ขอไม่เผยแพร่
const PAGE = 10
const all = computed(() => latestCustomPhotos(db))
const q = ref('')
const qd = ref('')
let timer
watch(q, (v) => { clearTimeout(timer); timer = setTimeout(() => (qd.value = v), 200) })
const res = computed(() => searchCakePhotos(all.value, qd.value))
const limit = ref(PAGE)
watch(() => [qd.value, all.value.length], () => (limit.value = PAGE))
const visible = computed(() => res.value.results.slice(0, limit.value))
const more = computed(() => res.value.results.length > limit.value)
const loadMore = () => { if (more.value) limit.value += PAGE }

const sentinel = ref(null)
let io
onMounted(() => {
  if (typeof IntersectionObserver === 'undefined') return
  io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) loadMore() }, { rootMargin: '300px' })
  watch(sentinel, (el, old) => { if (old) io.unobserve(old); if (el) io.observe(el) }, { immediate: true, flush: 'post' })
})
onBeforeUnmount(() => { clearTimeout(timer); io?.disconnect() })

const altOf = (p) => p.caption || [p.typeName, ...p.tagNames.filter((t) => t.groupKey !== 'type').map((t) => t.name)].filter(Boolean).join(' ') || 'เค้กสั่งทำ'
</script>

<template>
  <div class="mx-auto max-w-6xl px-4 pt-6 pb-4">
    <RouterLink to="/menu" class="mb-3 inline-flex items-center gap-1 text-sm text-stone-600 hover:text-brand-700"><AppIcon name="back" :size="16" /> กลับเมนู</RouterLink>
    <h1 class="text-[28px] text-stone-900">เค้กสั่งทำล่าสุด</h1>
    <p class="mt-1 text-sm text-stone-600">ผลงานที่ส่งมอบแล้ว พิมพ์ค้นหาแบบที่ชอบ ระบบจะเสนอแบบที่ใกล้เคียงที่สุด</p>

    <label class="relative mt-4 block">
      <span class="sr-only">ค้นหาแบบเค้ก</span>
      <AppIcon name="search" class="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-stone-500" />
      <input v-model="q" type="search" class="input h-12 rounded-full bg-white pl-11 shadow-sm" placeholder="เช่น ช็อกโกแลต 2 ปอนด์ ฟอนดองท์" aria-label="ค้นหาแบบเค้ก" autocomplete="off" />
    </label>

    <p v-if="res.fallback" class="mt-3 rounded-2xl bg-[#fff1d6] p-3 text-sm text-stone-800" role="status">ไม่พบแบบตรงกับ “{{ res.query }}” ขอแสดงแบบล่าสุดที่ใกล้เคียง</p>
    <p v-else-if="qd.trim()" class="mt-3 text-sm text-stone-600" role="status">เรียงตามความใกล้เคียงกับ “{{ res.query }}” · {{ res.results.length }} รูป</p>

    <div v-if="!all.length" class="empty mt-6">
      <div class="h-24 w-28 overflow-hidden rounded-2xl"><CakeArt kind="fondant" /></div>
      ยังไม่มีผลงานเค้กสั่งทำให้ดู
      <RouterLink to="/menu" class="btn-soft">ดูเมนูเค้ก</RouterLink>
    </div>

    <template v-else>
      <ul class="mt-4 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4" aria-label="รูปเค้กสั่งทำล่าสุด">
        <li v-for="p in visible" :key="p.id">
          <RouterLink :to="`/menu/design/${p.id}`" class="group block w-full overflow-hidden rounded-3xl bg-white text-left shadow-md transition hover:shadow-lg" :aria-label="`ดูแบบ ${altOf(p)}`">
            <div class="aspect-square overflow-hidden"><img :src="p.image" :alt="altOf(p)" loading="lazy" class="h-full w-full object-cover transition group-hover:scale-105" /></div>
            <div class="p-2.5">
              <div class="line-clamp-1 text-sm font-semibold text-stone-900">{{ p.typeName || 'เค้กสั่งทำ' }}</div>
              <div class="line-clamp-1 text-xs text-stone-600">{{ p.tagNames.filter((t) => t.groupKey !== 'type').map((t) => t.name).join(' · ') || '—' }}</div>
            </div>
          </RouterLink>
        </li>
      </ul>
      <div class="mt-5 text-center text-sm text-stone-600" aria-live="polite">
        <p>แสดง {{ visible.length }} จาก {{ res.results.length }} รูป</p>
        <button v-if="more" type="button" class="btn-peach mt-2 px-6" @click="loadMore">ดูเพิ่ม</button>
        <p v-else class="mt-1">แสดงครบแล้ว</p>
        <div ref="sentinel" class="h-1" aria-hidden="true"></div>
      </div>
    </template>
  </div>
</template>
