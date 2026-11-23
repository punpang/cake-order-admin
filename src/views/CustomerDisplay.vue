<script setup>
// จอแสดงให้ลูกค้า (หน้า /display) · รับสถานะจากแอป POS ผ่าน window.__displayUpdate (แอป Android ส่งเข้ามา)
// จอสัมผัสไม่ได้ จึงไม่มีการเลื่อน: ทุกส่วนย่อให้พอดีด้วย FitBox · สรุปยอดและโปรโมชั่นย่อไปพร้อมกันจนพอดี และแสดงครบทุกรายการ
// โทนเดียวกับหน้าเว็บหลัก (หน้าร้านออนไลน์)
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AppIcon from '../components/AppIcon.vue'
import FitBox from '../components/FitBox.vue'
import { money } from '../lib/format'
import { nextAdIndex } from '../lib/displayAds'

const state = ref({ status: 'idle', shopName: '' })
const qrBox = ref(null)
const qrPx = ref(200)
const qrSrc = ref('')
let ro = null

function apply(s) {
  state.value = s && typeof s === 'object' ? s : { status: 'idle', shopName: '' }
}
onMounted(() => {
  window.__displayUpdate = apply
})
onBeforeUnmount(() => {
  if (window.__displayUpdate === apply) delete window.__displayUpdate
  if (ro) ro.disconnect()
})

// ขนาด QR ตามพื้นที่ที่เหลือจริง (กล่อง QR จะมีเฉพาะตอนกำลังชำระเงิน จึงผูกตัววัดตอนกล่องปรากฏ)
watch(qrBox, (el) => {
  if (ro) ro.disconnect()
  ro = null
  if (!el || !('ResizeObserver' in window)) return
  ro = new ResizeObserver(([e]) => {
    const { width, height } = e.contentRect
    qrPx.value = Math.max(120, Math.floor(Math.min(width, height) - 8))
  })
  ro.observe(el)
})

// ---------- สื่อโฆษณาตอนว่าง (รูป/วิดีโอ วนแสดงเต็มจอ) ----------
// POS ส่ง state.ads = { seconds, items: [{ type: 'image'|'video', url }] } มากับสถานะ idle (ดู src/lib/displayAds.js)
// รูปแสดงตามเวลาที่ตั้ง · วิดีโอเล่นจนจบ (ปิดเสียง) · โหลดไม่ได้ = ข้าม · ทุกรายการโหลดไม่ได้ = กลับหน้ายินดีต้อนรับ
const ads = computed(() => (state.value.status === 'idle' && Array.isArray(state.value.ads?.items) && state.value.ads.items.length ? state.value.ads : null))
const adKey = computed(() => JSON.stringify(ads.value?.items || []))
const adIndex = ref(0)
const adTick = ref(0) // เปลี่ยนทุกครั้งที่ไปรายการถัดไป (แม้เป็นรายการเดิม) เพื่อเริ่มเล่นใหม่และทำภาพจาง
const adFailed = ref(new Set())
const adItem = computed(() => (ads.value && adIndex.value >= 0 ? ads.value.items[adIndex.value] || null : null))
const adSingle = computed(() => (ads.value?.items.length || 0) - adFailed.value.size <= 1)
let adTimer = 0
const clearAdTimer = () => { clearTimeout(adTimer); adTimer = 0 }
function nextAd() {
  clearAdTimer()
  if (!ads.value) return
  adIndex.value = nextAdIndex(adIndex.value, ads.value.items.length, adFailed.value)
  adTick.value++
}
function onAdError() {
  adFailed.value = new Set([...adFailed.value, adIndex.value])
  nextAd()
}
const AD_LOAD_TIMEOUT_MS = 15000
function scheduleAd() {
  clearAdTimer()
  const it = adItem.value
  if (!it) return
  if (it.type === 'video') {
    adTimer = setTimeout(onAdError, AD_LOAD_TIMEOUT_MS) // โหลดไม่ขึ้นในเวลานี้ = ข้าม (ตั้งใหม่ตามความยาววิดีโอเมื่อรู้ความยาว)
    return
  }
  if (adSingle.value) return // รูปเดียว: แสดงค้างไว้
  adTimer = setTimeout(nextAd, (Number(ads.value.seconds) || 8) * 1000)
  const n = ads.value.items[nextAdIndex(adIndex.value, ads.value.items.length, adFailed.value)]
  if (n?.type === 'image') new Image().src = n.url // โหลดรูปถัดไปไว้ก่อน เปลี่ยนภาพไม่กระตุก
}
// วิดีโอ: รู้ความยาวแล้ว → กันค้าง (ภาพนิ่งกลางทาง) ด้วยเวลาความยาว + 5 วินาที · วิดีโอเดียวเล่นวนเอง
function onVideoMeta(e) {
  clearAdTimer()
  const d = Number(e.target?.duration)
  if (!adSingle.value && Number.isFinite(d) && d > 0) adTimer = setTimeout(nextAd, (d + 5) * 1000)
}
function onVideoEnded() { if (!adSingle.value) nextAd() }
// ปิดเสียงด้วยค่าคุณสมบัติ (เล่นอัตโนมัติได้แน่นอน) แล้วสั่งเล่น
const setupVideo = (el) => { if (!el) return; el.muted = true; el.defaultMuted = true; el.play?.().catch(() => {}) }
watch(adKey, () => { adFailed.value = new Set(); adIndex.value = 0; adTick.value++ }, { immediate: true })
// ตั้งเวลาใหม่เมื่อเปลี่ยนรายการ เปลี่ยนเวลาต่อภาพ หรือกลับมาสถานะว่าง (ซื้อเสร็จแล้วสื่อชุดเดิมต้องเดินต่อ ไม่ค้างภาพเดิม)
watch([adTick, () => (ads.value ? String(ads.value.seconds) : '')], scheduleAd, { immediate: true })
onBeforeUnmount(clearAdTimer)

// สถานะ: ป้ายบนหัวข้อ (หัวข้อเป็นสีแบรนด์ทุกสถานะ)
const THEME = {
  idle: { pill: 'bg-white text-brand-700', label: 'ยินดีต้อนรับ' },
  shopping: { pill: 'bg-white text-brand-700', label: 'กำลังเลือกสินค้า' },
  paying: { pill: 'bg-honey text-stone-900', label: 'กำลังชำระเงิน' },
  paid: { pill: 'bg-matcha text-stone-900', label: 'รับชำระแล้ว' },
  thanks: { pill: 'bg-matcha text-stone-900', label: 'ชำระเรียบร้อย' },
}
const theme = computed(() => THEME[state.value.status] || THEME.idle)
const remaining = computed(() => Number(state.value.remaining) || 0)
// สมาชิก (ปิดบังแล้วจาก POS: ชื่อตัวแรก + เบอร์ 4 ตัวท้าย) · ระดับกับหลอดเลื่อนขั้นมีเฉพาะโหมดใช้จริง · ไม่มีสมาชิกไม่แสดง
const member = computed(() => state.value.member || null)
const tier = computed(() => member.value?.tier || null)
const pricing = computed(() => state.value.pricing || { full: 0, discounts: [], saved: 0, surcharge: 0, vatMode: null, vatRate: 0, vat: 0 })
const hasDiscount = computed(() => (pricing.value.discounts || []).length > 0)
// โปรโมชั่นแนะนำให้ลูกค้าซื้อเพิ่ม (มาจาก POS: โปรที่ใกล้ถึง · บันเดิ้ล · ซื้อคู่กัน · ขายดีอันดับ 1)
const suggest = computed(() => state.value.suggest || { hints: [], bundles: [], pairs: [], best: null })

// โปรโมชั่นแนะนำ: ลำดับความสำคัญ บันเดิ้ล → โปรใกล้ถึง → ซื้อคู่กัน → ขายดีอันดับ 1 (แต่ละการ์ดแสดงครบ ไม่ตัดข้อความ)
const promoCards = computed(() => {
  const out = []
  for (const b of suggest.value.bundles || []) out.push({ key: 'b' + b.name, cls: 'bg-brand-50', label: 'บันเดิ้ล', labelCls: 'text-brand-700', title: b.name, titleCls: 'text-brand-800', price: money(b.price) })
  for (const h of suggest.value.hints || []) out.push({ key: 'h' + h, cls: 'bg-honey/30', label: 'โปรใกล้ถึง', labelCls: 'text-stone-700', title: h, titleCls: 'text-stone-900', price: '' })
  for (const pr of suggest.value.pairs || []) out.push({ key: 'p' + pr.name, cls: 'bg-matcha-soft/60', label: 'ซื้อคู่กัน', labelCls: 'text-stone-700', title: pr.name, titleCls: 'text-stone-900', price: money(pr.price) })
  if (suggest.value.best) out.push({ key: 'best', cls: 'bg-white ring-1 ring-brand-200', label: 'ขายดีอันดับ 1', labelCls: 'text-brand-700', title: suggest.value.best.name, titleCls: 'text-stone-900', price: money(suggest.value.best.price), star: true })
  return out
})
const promoKey = computed(() => JSON.stringify(promoCards.value))
const promoLimit = ref(0)
watch(promoKey, () => { promoLimit.value = promoCards.value.length }, { immediate: true })
const visiblePromos = computed(() => promoCards.value.slice(0, promoLimit.value))
// สรุปยอดกับโปรย่อไปพร้อมกันให้พอดี · ถ้ายังล้นแม้ย่อถึงขั้นต่ำสุด ค่อยตัดโปรท้ายสุดทีละรายการ (ไม่ตัดข้อความ)
function onSummaryFit({ overflow }) {
  if (overflow && promoLimit.value > 0) promoLimit.value -= 1
}

// สีป้ายวิธีชำระ (ตามชื่อวิธีชำระที่ POS ส่งมา)
const METHOD_CHIP = {
  เงินสด: 'bg-matcha-soft text-stone-900',
  โอนเงิน: 'bg-brand-100 text-brand-800',
  บัตร: 'bg-honey/40 text-stone-900',
}
const chipOf = (m) => METHOD_CHIP[m] || 'bg-stone-200 text-stone-900'

watch(
  [() => state.value.qr?.payload, qrPx],
  async ([payload, px]) => {
    if (!payload) {
      qrSrc.value = ''
      return
    }
    try {
      const QR = await import('qrcode')
      qrSrc.value = await (QR.default || QR).toDataURL(payload, { margin: 1, width: Math.round(px * 2), errorCorrectionLevel: 'M' })
    } catch {
      qrSrc.value = ''
    }
  },
  { immediate: true },
)
</script>

<template>
  <!-- ว่าง + มีสื่อโฆษณา: เต็มจอ · แถบล่างบาง ๆ ชื่อร้านและวิธีชำระที่รับ -->
  <div v-if="adItem" class="flex h-dvh flex-col overflow-hidden bg-stone-950 text-white">
    <div class="relative min-h-0 flex-1 overflow-hidden">
      <Transition name="ad-fade">
        <div :key="adTick" class="absolute inset-0">
          <template v-if="adItem.type === 'image'">
            <!-- พื้นหลังเบลอจากรูปเดียวกัน: รูปไม่ตรงสัดส่วนจอก็ไม่มีขอบดำ และไม่ถูกตัดเนื้อหา -->
            <img :src="adItem.url" alt="" aria-hidden="true" class="absolute inset-0 h-full w-full scale-110 object-cover opacity-60 blur-xl" />
            <img :src="adItem.url" alt="" class="relative h-full w-full object-contain" @error="onAdError" />
          </template>
          <video
            v-else
            :ref="setupVideo"
            :src="adItem.url"
            class="h-full w-full object-contain"
            autoplay
            muted
            playsinline
            preload="auto"
            :loop="adSingle"
            @loadedmetadata="onVideoMeta"
            @ended="onVideoEnded"
            @error="onAdError"
          />
        </div>
      </Transition>
    </div>
    <footer class="flex shrink-0 items-center justify-between gap-3 bg-linear-to-br from-hero-1 via-hero-2 to-hero-3 px-[clamp(0.8rem,2.5vw,2rem)] py-[clamp(0.25rem,0.9vh,0.55rem)] shadow-[0_-2px_8px_rgb(0_0_0/0.15)]">
      <div class="min-w-0 truncate font-display font-medium text-[clamp(0.9rem,2.8vh,1.3rem)] leading-tight">{{ state.shopName || 'ยินดีต้อนรับค่ะ' }}</div>
      <div class="flex shrink-0 items-center gap-[clamp(0.3rem,0.8vw,0.6rem)] font-semibold leading-tight text-[clamp(0.65rem,1.8vh,0.85rem)]">
        <span class="rounded-full bg-matcha-soft px-[clamp(0.5rem,1.2vw,0.9rem)] py-[clamp(0.1rem,0.4vh,0.25rem)] text-stone-900">เงินสด</span>
        <span class="rounded-full bg-brand-100 px-[clamp(0.5rem,1.2vw,0.9rem)] py-[clamp(0.1rem,0.4vh,0.25rem)] text-brand-800">โอนเงิน QR</span>
        <span class="rounded-full bg-honey px-[clamp(0.5rem,1.2vw,0.9rem)] py-[clamp(0.1rem,0.4vh,0.25rem)] text-stone-900">บัตร</span>
      </div>
    </footer>
  </div>
  <div v-else class="flex h-dvh flex-col overflow-hidden bg-cream text-stone-900">
    <!-- หัวข้อ: บาง ชื่อร้าน + สถานะ -->
    <header class="flex shrink-0 items-center justify-between gap-3 bg-linear-to-br from-hero-1 via-hero-2 to-hero-3 px-[clamp(0.8rem,2.5vw,2rem)] py-[clamp(0.2rem,0.5vh,0.35rem)] text-white shadow-md">
      <div class="min-w-0 truncate font-display font-medium text-[clamp(0.9rem,2.8vh,1.3rem)] leading-tight">{{ state.shopName || 'ยินดีต้อนรับ' }}</div>
      <div class="shrink-0 rounded-full px-[clamp(0.5rem,1.4vw,1rem)] py-[clamp(0.05rem,0.3vh,0.2rem)] font-semibold leading-tight text-[clamp(0.65rem,1.7vh,0.8rem)]" :class="theme.pill">
        {{ theme.label }}
      </div>
    </header>

    <main class="flex min-h-0 flex-1 flex-col p-[clamp(0.4rem,1.2vh,0.9rem)]">
      <!-- สมาชิก: ให้ลูกค้ารู้ว่าเป็นตัวเขา · จะได้แต้มเท่าไรในบิลนี้ · ระดับและหลอดเลื่อนขั้น (โหมดใช้จริง) -->
      <section v-if="member" aria-label="ข้อมูลสมาชิก" class="mb-[clamp(0.3rem,1vh,0.6rem)] flex shrink-0 flex-wrap items-center gap-x-[clamp(0.6rem,2vw,1.4rem)] gap-y-[clamp(0.25rem,0.8vh,0.5rem)] rounded-2xl bg-white px-[clamp(0.7rem,2vw,1.2rem)] py-[clamp(0.3rem,1vh,0.6rem)] shadow-sm ring-1 ring-stone-200">
        <div class="flex min-w-0 items-center gap-2">
          <AppIcon name="user" :size="18" class="shrink-0 text-brand-700" />
          <span class="truncate font-semibold text-stone-900 text-[clamp(0.9rem,2.6vh,1.2rem)]">{{ member.name }}</span>
          <span class="shrink-0 tabular-nums text-stone-600 text-[clamp(0.8rem,2.2vh,1.05rem)]">{{ member.phone }}</span>
        </div>
        <template v-if="tier">
          <span class="shrink-0 rounded-full bg-brand-100 px-3 py-0.5 font-semibold text-brand-800 text-[clamp(0.75rem,2vh,0.95rem)]">
            {{ tier.levelName }}<template v-if="tier.mult > 1"> · x{{ tier.mult }}</template>
          </span>
          <div v-if="tier.progress && tier.nextName" class="flex min-w-0 flex-1 basis-48 items-center gap-2">
            <div class="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-stone-200" role="progressbar" aria-label="ความคืบหน้าสู่ระดับถัดไป" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="tier.pct">
              <div class="h-full rounded-full bg-brand-500 transition-[width] duration-500" :style="{ width: tier.pct + '%' }" />
            </div>
            <span class="shrink-0 whitespace-nowrap text-stone-700 text-[clamp(0.75rem,2vh,0.95rem)]">อีก <b class="text-stone-900">{{ money(tier.toNext) }}</b> ถึง {{ tier.nextName }}</span>
          </div>
          <span v-else-if="tier.progress" class="shrink-0 font-semibold text-stone-700 text-[clamp(0.75rem,2vh,0.95rem)]">ระดับสูงสุด</span>
        </template>
        <span v-if="member.points > 0" class="ml-auto shrink-0 rounded-full bg-matcha-soft px-3 py-0.5 font-semibold text-stone-900 text-[clamp(0.75rem,2vh,0.95rem)]">
          {{ state.status === 'thanks' ? 'ได้รับ' : 'จะได้รับ' }} {{ member.points.toLocaleString() }} แต้ม
        </span>
      </section>

      <!-- กำลังเลือกสินค้า: รายการ (ซ้าย) · สรุปยอดและโปรโมชั่น (ขวา) -->
      <div v-if="state.status === 'shopping'" class="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] gap-[clamp(0.4rem,1.2vh,0.8rem)] grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section class="@container flex min-h-0 flex-col overflow-hidden rounded-3xl bg-white shadow-md">
          <div class="flex shrink-0 items-center justify-between bg-brand-50 px-[clamp(0.8rem,2vw,1.4rem)] py-[clamp(0.3rem,1vh,0.6rem)]">
            <span class="font-semibold text-brand-700 text-[clamp(0.85rem,2.4vh,1.1rem)]">รายการที่สั่ง</span>
            <span class="rounded-full bg-honey px-3 py-0.5 text-[clamp(0.7rem,1.9vh,0.9rem)] font-semibold text-stone-900">{{ (state.lines || []).length }} รายการ</span>
          </div>
          <FitBox>
            <ul class="space-y-[clamp(0.35rem,1vh,0.6rem)] p-[clamp(0.5rem,1.4vh,1rem)]">
              <li v-for="(l, i) in state.lines" :key="i" class="flex items-start gap-[clamp(0.5rem,1.4vw,0.9rem)] rounded-2xl bg-stone-50 p-[clamp(0.35rem,1.1vh,0.8rem)]">
                <span class="grid aspect-square h-[clamp(2rem,5.2vh,2.75rem)] shrink-0 place-items-center rounded-xl bg-brand-100 font-bold text-brand-800 text-[clamp(0.9rem,2.6vh,1.2rem)]">{{ l.qty }}</span>
                <!-- ซ้าย: ชื่อ + ราคา (ราคาที่ต้องจ่ายก่อน · ราคาเต็มขีดฆ่าไว้ข้างหลัง) -->
                <div class="min-w-0 flex-1">
                  <div class="break-words font-medium text-stone-900 text-[clamp(0.95rem,3vh,1.4rem)]">{{ l.name }}</div>
                  <div class="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-[clamp(0.8rem,2.3vh,1.05rem)]">
                    <span :class="l.fullUnit !== l.unit ? 'font-semibold text-brand-700' : 'text-stone-700'">{{ money(l.unit) }}</span>
                    <span v-if="l.fullUnit !== l.unit" class="text-stone-400 line-through">{{ money(l.fullUnit) }}</span>
                  </div>
                </div>
                <!-- ขวา: ราคารวมของรายการ และป้ายโปรโมชั่นอยู่ใต้ราคารวม -->
                <div class="flex shrink-0 flex-col items-end gap-1">
                  <span class="font-semibold text-stone-900 text-[clamp(0.95rem,3vh,1.4rem)]">{{ money(l.amount) }}</span>
                  <div v-if="l.tags?.length" class="flex flex-wrap justify-end gap-1">
                    <span v-for="(t, k) in l.tags" :key="k" class="rounded-full bg-honey/50 px-2 py-0.5 text-[clamp(0.7rem,1.9vh,0.9rem)] text-stone-900">{{ t }}</span>
                  </div>
                </div>
              </li>
            </ul>
          </FitBox>
        </section>

        <section class="flex min-h-0 flex-col overflow-hidden rounded-3xl bg-white shadow-md">
          <div class="shrink-0 bg-brand-50 px-[clamp(0.8rem,2vw,1.4rem)] py-[clamp(0.3rem,1vh,0.6rem)]">
            <span class="font-semibold text-brand-700 text-[clamp(0.85rem,2.4vh,1.1rem)]">สรุปยอด</span>
          </div>
          <FitBox @fit="onSummaryFit">
            <div class="flex flex-col gap-[clamp(0.25rem,0.9vh,0.5rem)] p-[clamp(0.5rem,1.4vh,1rem)] text-[clamp(0.8rem,2.3vh,1.1rem)]">
              <div class="flex justify-between gap-3">
                <span class="text-stone-600">ราคาเต็ม</span>
                <span class="font-medium text-stone-900">{{ money(pricing.full) }}</span>
              </div>
              <div v-for="(d, k) in pricing.discounts" :key="k" class="flex justify-between gap-3 text-brand-700">
                <span class="min-w-0 break-words">{{ d.label }}</span>
                <span class="shrink-0 font-semibold">−{{ money(d.amount) }}</span>
              </div>
              <div v-if="pricing.surcharge > 0" class="flex justify-between gap-3">
                <span class="text-stone-600">ปรับราคาเพิ่ม</span>
                <span class="shrink-0 font-medium text-stone-900">+{{ money(pricing.surcharge) }}</span>
              </div>
              <div v-if="pricing.vatMode === 'exclusive'" class="flex justify-between gap-3">
                <span class="text-stone-600">VAT {{ pricing.vatRate }}% (บวกเพิ่ม)</span>
                <span class="shrink-0 font-medium text-stone-900">+{{ money(pricing.vat) }}</span>
              </div>
              <div v-if="pricing.vatMode === 'inclusive'" class="flex justify-between gap-3 text-stone-500">
                <span>รวม VAT {{ pricing.vatRate }}% แล้ว</span>
                <span class="shrink-0">{{ money(pricing.vat) }}</span>
              </div>

              <!-- โปรโมชั่นแนะนำ: อยู่ในกล่องเดียวกับสรุปยอด จึงย่อพร้อมกันให้พอดี · แถวละ 1 บรรทัด (ชื่อกับราคาอยู่บรรทัดเดียวกัน) -->
              <div v-if="visiblePromos.length" class="mt-[clamp(0.3rem,1vh,0.7rem)] flex flex-col gap-[clamp(0.3rem,1vh,0.6rem)]">
                <div class="flex items-center gap-2 font-semibold text-brand-700">
                  <AppIcon name="star" :size="16" /> โปรโมชั่นแนะนำ
                </div>
                <div class="flex flex-col gap-[clamp(0.3rem,1vh,0.6rem)]">
                  <div v-for="c in visiblePromos" :key="c.key" class="flex items-center justify-between gap-2 rounded-2xl px-[clamp(0.45rem,1.2vw,0.7rem)] py-[clamp(0.3rem,1vh,0.6rem)]" :class="c.cls">
                    <div class="min-w-0 break-words font-medium leading-snug" :class="c.titleCls">
                      <span class="mr-1 inline-flex items-center gap-0.5 rounded-full bg-white/80 px-2 align-middle text-[0.75em] font-semibold" :class="c.labelCls"><AppIcon v-if="c.star" name="star" :size="11" />{{ c.label }}</span>{{ c.title }}
                    </div>
                    <span v-if="c.price" class="shrink-0 whitespace-nowrap font-semibold" :class="c.titleCls">{{ c.price }}</span>
                  </div>
                </div>
              </div>
            </div>
          </FitBox>
          <!-- ยอดสุทธิ: ด้านล่างการ์ดเสมอ -->
          <div class="flex shrink-0 items-end justify-between gap-3 border-t border-stone-200 px-[clamp(0.8rem,2vh,1.5rem)] py-[clamp(0.4rem,1.3vh,0.9rem)]">
            <div class="min-w-0">
              <div class="font-semibold text-stone-900 text-[clamp(0.95rem,2.8vh,1.3rem)]">ยอดสุทธิ</div>
              <div v-if="hasDiscount" class="font-semibold text-brand-700 text-[clamp(0.75rem,2vh,0.95rem)]">ประหยัดไป {{ money(pricing.saved) }}</div>
            </div>
            <span class="whitespace-nowrap font-display font-semibold text-stone-900 text-[clamp(1.1rem,3.6vh,1.9rem)]">{{ money(state.total) }}</span>
          </div>
        </section>
      </div>

      <!-- กำลังชำระเงิน: ยอดและวิธีชำระ (ซ้าย) · QR (ขวา) -->
      <div v-else-if="state.status === 'paying'" class="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] gap-[clamp(0.4rem,1.2vh,0.8rem)] grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section class="flex min-h-0 flex-col overflow-hidden rounded-3xl bg-white shadow-md">
          <div class="shrink-0 bg-brand-50 px-[clamp(0.8rem,2vw,1.4rem)] py-[clamp(0.3rem,1vh,0.6rem)]">
            <span class="font-semibold text-brand-700 text-[clamp(0.85rem,2.4vh,1.1rem)]">การชำระเงิน</span>
          </div>
          <FitBox>
            <div class="flex flex-col gap-[clamp(0.4rem,1.2vh,0.8rem)] p-[clamp(0.6rem,1.8vh,1.25rem)]">
              <div>
                <div class="text-stone-500 text-[clamp(0.8rem,2.2vh,1.05rem)]">ยอดที่ต้องชำระ</div>
                <div class="font-display font-semibold text-stone-900 text-[clamp(1.75rem,7vh,3.4rem)] leading-tight">{{ money(state.total) }}</div>
                <div class="mt-1.5">
                  <span v-if="remaining > 0" class="inline-block rounded-full bg-honey px-4 py-1 font-bold text-stone-900 text-[clamp(0.85rem,2.6vh,1.2rem)]">ยังขาด {{ money(remaining) }}</span>
                  <span v-else class="inline-block rounded-full bg-matcha px-4 py-1 font-bold text-stone-900 text-[clamp(0.85rem,2.6vh,1.2rem)]">ครบแล้ว ✓</span>
                </div>
              </div>
              <div class="flex flex-col gap-0.5 text-[clamp(0.75rem,2.1vh,1rem)] text-stone-700">
                <div v-for="(d, k) in pricing.discounts" :key="'d' + k" class="flex justify-between gap-3 text-brand-700">
                  <span class="min-w-0 break-words">{{ d.label }}</span><span class="shrink-0 font-semibold">−{{ money(d.amount) }}</span>
                </div>
                <div v-if="pricing.vatMode === 'exclusive'" class="flex justify-between gap-3">
                  <span>VAT {{ pricing.vatRate }}% (บวกเพิ่ม)</span><span class="shrink-0">+{{ money(pricing.vat) }}</span>
                </div>
              </div>
              <ul v-if="state.payLines?.length" class="space-y-[clamp(0.3rem,1vh,0.6rem)]">
                <li v-for="(p, i) in state.payLines" :key="i" class="flex items-center justify-between gap-3 rounded-2xl bg-stone-50 p-[clamp(0.35rem,1.1vh,0.8rem)]">
                  <span class="rounded-full px-3 py-1 font-semibold text-[clamp(0.75rem,2.1vh,0.95rem)]" :class="chipOf(p.method)">{{ p.method }}</span>
                  <span class="font-semibold text-stone-900 text-[clamp(0.95rem,2.8vh,1.3rem)]">
                    {{ money(p.amount) }}
                    <span v-if="p.done" class="ml-1 text-stone-800">✓</span>
                  </span>
                </li>
              </ul>
            </div>
          </FitBox>
        </section>

        <section class="flex min-h-0 flex-col overflow-hidden rounded-3xl bg-white shadow-md">
          <div class="flex shrink-0 items-center justify-center bg-matcha-soft px-4 py-[clamp(0.3rem,1vh,0.6rem)]">
            <span class="font-semibold text-stone-900 text-[clamp(0.85rem,2.4vh,1.1rem)]">สแกน QR เพื่อชำระ</span>
          </div>
          <div ref="qrBox" class="flex min-h-0 flex-1 items-center justify-center p-[clamp(0.3rem,1vh,0.6rem)]">
            <img
              v-if="state.qr && qrSrc"
              :src="qrSrc"
              alt="QR พร้อมเพย์สำหรับชำระเงิน"
              :style="{ width: qrPx + 'px', height: qrPx + 'px' }"
              class="rounded-2xl bg-white ring-1 ring-stone-200"
            />
            <div v-else class="text-stone-400">รอสร้าง QR</div>
          </div>
          <div v-if="state.qr" class="shrink-0 pb-[clamp(0.4rem,1.2vh,0.9rem)] text-center font-display font-semibold text-brand-700 text-[clamp(1.2rem,4vh,1.9rem)]">
            {{ money(state.qr.amount) }}
          </div>
        </section>
      </div>

      <!-- รับชำระแล้ว (ฟลาชชั่วครู่): เครื่องหมายถูกและยอดที่รับ แล้วกลับไปหน้าการชำระเงิน -->
      <div v-else-if="state.status === 'paid'" class="flex min-h-0 flex-1 flex-col items-center justify-center gap-[clamp(0.6rem,2vh,1.4rem)] rounded-3xl bg-white p-8 text-center shadow-md">
        <div class="relative grid aspect-square h-[clamp(4rem,16vh,7rem)] place-items-center">
          <span class="pay-ring absolute inset-0 rounded-full bg-matcha-soft" aria-hidden="true" />
          <span class="pay-pop relative grid h-full w-full place-items-center rounded-full bg-matcha-soft text-stone-900">
            <svg class="pay-check h-1/2 w-1/2" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" /></svg>
          </span>
        </div>
        <div class="pay-pop font-display font-medium text-stone-900 text-[clamp(1.8rem,7vh,3.6rem)] leading-tight">รับชำระแล้ว</div>
        <div class="pay-pop font-display font-semibold text-brand-700 text-[clamp(1.6rem,6vh,3rem)]">{{ money(state.amount) }}</div>
        <div v-if="remaining > 0" class="rounded-full bg-honey px-5 py-2 font-bold text-stone-900 text-[clamp(0.9rem,2.8vh,1.2rem)]">ยังขาด {{ money(remaining) }}</div>
        <div v-else class="rounded-full bg-matcha px-5 py-2 font-bold text-stone-900 text-[clamp(0.9rem,2.8vh,1.2rem)]">ครบแล้ว ✓</div>
      </div>

      <!-- ชำระเรียบร้อย -->
      <div v-else-if="state.status === 'thanks'" class="flex min-h-0 flex-1 flex-col items-center justify-center gap-[clamp(0.6rem,2vh,1.4rem)] rounded-3xl bg-white p-8 text-center shadow-md">
        <div class="pay-pop grid aspect-square h-[clamp(3.5rem,14vh,6rem)] place-items-center rounded-full bg-matcha-soft text-stone-900">
          <svg class="pay-check h-1/2 w-1/2" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" /></svg>
        </div>
        <div class="font-display font-medium text-stone-900 text-[clamp(2rem,9vh,4.5rem)] leading-tight">ขอบคุณค่ะ</div>
        <div class="text-stone-600 text-[clamp(0.95rem,3vh,1.4rem)]">ชำระเรียบร้อยแล้ว <span class="font-bold text-stone-900">{{ money(state.total) }}</span></div>
        <div v-if="(state.saved || 0) > 0" class="rounded-full bg-brand-50 px-5 py-2 font-semibold text-brand-700 text-[clamp(0.9rem,2.8vh,1.2rem)]">ประหยัดไป {{ money(state.saved) }}</div>
      </div>

      <!-- ยินดีต้อนรับ (ยังไม่มีรายการ) -->
      <div v-else class="relative flex min-h-0 flex-1 flex-col items-center justify-center overflow-hidden rounded-3xl bg-white p-8 text-center shadow-md">
        <div class="absolute -left-16 -top-16 h-56 w-56 rounded-full bg-brand-100" />
        <div class="absolute -bottom-20 -right-10 h-64 w-64 rounded-full bg-matcha-soft" />
        <div class="relative">
          <div class="font-display font-medium text-brand-700 text-[clamp(2rem,9vh,4.2rem)] leading-tight">ยินดีต้อนรับค่ะ</div>
          <div class="mt-3 text-stone-600 text-[clamp(0.95rem,3vh,1.4rem)]">เชิญเลือกสินค้าได้เลยค่ะ</div>
          <div class="mt-[clamp(0.8rem,3vh,2rem)] flex flex-wrap justify-center gap-3 font-semibold text-[clamp(0.8rem,2.4vh,1.05rem)]">
            <span class="rounded-full bg-matcha-soft px-4 py-2 text-stone-900">เงินสด</span>
            <span class="rounded-full bg-brand-100 px-4 py-2 text-brand-800">โอนเงิน QR</span>
            <span class="rounded-full bg-honey/40 px-4 py-2 text-stone-900">บัตร</span>
          </div>
        </div>
      </div>
    </main>
  </div>
</template>

<style scoped>
/* เปลี่ยนสื่อโฆษณาแบบค่อย ๆ จาง (ภาพเก่าและใหม่ซ้อนกันชั่วครู่) */
.ad-fade-enter-active,
.ad-fade-leave-active {
  transition: opacity 0.8s ease;
}
.ad-fade-enter-from,
.ad-fade-leave-to {
  opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
  .ad-fade-enter-active,
  .ad-fade-leave-active {
    transition: none;
  }
}
</style>
