<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { db, recordCakeClick } from '../../data/store'
import { latestCustomPhotos } from '../../lib/cakeSearch'
import { tagsByGroup, visitorId } from '../../lib/cakeReco'
import { dateOnly } from '../../lib/format'
import AppIcon from '../../components/AppIcon.vue'
import CakeArt from '../../components/art/CakeArt.vue'

// ดูแบบเค้กสั่งทำที่ส่งมอบแล้ว (สาธารณะ): ตัวเลือกของแบบนี้ซ่อนไว้ก่อน แนะนำให้กดแสดง
const props = defineProps({ id: { type: String, required: true } })
const p = computed(() => latestCustomPhotos(db).find((x) => x.id === props.id) || null)
const groups = computed(() => (p.value ? tagsByGroup(db, p.value.tags) : []))
const show = ref(false)
watch(() => props.id, () => (show.value = false))
onMounted(() => recordCakeClick(props.id, visitorId()))
watch(() => props.id, (v) => recordCakeClick(v, visitorId()))
const altOf = (x) => x.caption || [x.typeName, ...x.tagNames.filter((t) => t.groupKey !== 'type').map((t) => t.name)].filter(Boolean).join(' ') || 'เค้กสั่งทำ'
const copied = ref(false)
async function copyRef() {
  const x = p.value
  const text = `สนใจเค้กแบบนี้: ${x.tagNames.map((t) => t.name).join(' · ') || altOf(x)}`
  try { await navigator.clipboard.writeText(text); copied.value = true; setTimeout(() => (copied.value = false), 2500) } catch { copied.value = false }
}
</script>

<template>
  <div class="mx-auto max-w-5xl px-4 pt-6">
    <RouterLink to="/menu/gallery" class="mb-4 inline-flex items-center gap-1 text-sm text-stone-600 hover:text-brand-700"><AppIcon name="back" :size="16" /> กลับผลงานทั้งหมด</RouterLink>

    <div v-if="!p" class="empty">
      <div class="h-24 w-28 overflow-hidden rounded-2xl"><CakeArt kind="fondant" /></div>
      ไม่พบแบบนี้ (อาจไม่ได้เผยแพร่แล้ว)
      <RouterLink to="/menu/gallery" class="btn-soft">ดูผลงานทั้งหมด</RouterLink>
    </div>

    <div v-else class="grid gap-6 md:grid-cols-2">
      <div class="aspect-square overflow-hidden rounded-[2rem] shadow-md"><img :src="p.image" :alt="altOf(p)" class="h-full w-full object-cover" /></div>
      <div>
        <h1 class="text-[28px] leading-tight text-stone-900">{{ p.typeName || 'เค้กสั่งทำ' }}</h1>
        <p v-if="p.caption" class="mt-1 text-sm text-stone-700">{{ p.caption }}</p>
        <p v-if="p.deliveredAt" class="mt-1 text-xs text-stone-600">ส่งมอบ {{ dateOnly(p.deliveredAt) }}</p>

        <section class="mt-4" aria-label="ตัวเลือกของแบบนี้">
          <div class="flex items-center justify-between gap-3">
            <h2 class="text-xl text-stone-900">ตัวเลือกของแบบนี้</h2>
            <button type="button" class="btn-soft h-9 shrink-0 px-3" :aria-expanded="show" aria-controls="design-opts" @click="show = !show">
              {{ show ? 'ซ่อน' : 'แสดง' }} <AppIcon name="next" :size="14" class="transition" :class="show ? 'rotate-90' : ''" />
            </button>
          </div>
          <p v-if="!show" class="mt-2 rounded-2xl bg-[#fff1d6] p-2.5 text-sm text-stone-800" role="note">แนะนำ: กด “แสดง” เพื่อดูว่าแบบนี้เลือกเนื้อเค้ก ขนาด รูปทรง อะไรไว้</p>
          <div v-show="show" id="design-opts" class="mt-2 space-y-2">
            <div v-for="g in groups" :key="g.key + g.name" class="rounded-2xl border border-stone-200/70 bg-white p-3.5">
              <div class="mb-1.5 text-sm font-semibold text-stone-800">{{ g.name }}</div>
              <div class="flex flex-wrap gap-2"><span v-for="n in g.names" :key="n" class="chip chip-off">{{ n }}</span></div>
            </div>
            <p v-if="!groups.length" class="text-sm text-stone-600">ร้านยังไม่ได้ระบุตัวเลือกของแบบนี้</p>
          </div>
        </section>

        <div class="mt-5 flex flex-wrap gap-2">
          <RouterLink :to="{ path: '/menu/custom', query: { photo: p.id } }" class="btn-primary">สั่งแบบนี้</RouterLink>
          <button type="button" class="btn-outline" @click="copyRef">{{ copied ? 'คัดลอกแล้ว' : 'คัดลอกชื่อแบบ' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>
