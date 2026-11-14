<script setup>
// จอแสดงให้ลูกค้า (หน้า /display) · รับสถานะจากแอป POS ผ่าน window.__displayUpdate (แอป Android ส่งเข้ามา)
// โทนเดียวกับหน้าเว็บหลัก (หน้าร้านออนไลน์): หัวข้อไล่สีชมพู-แดง (hero) · พื้นครีม · การ์ดขาวเงาอุ่น · แถบยอดสีช็อกโกแลต · ป้ายเหลืองน้ำผึ้ง/เขียวมัทฉะ
// ขนาดตัวอักษรใช้ clamp() ตามความสูงจอ · QR ปรับขนาดตามพื้นที่ที่เหลือจริง
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AppIcon from '../components/AppIcon.vue'
import { money } from '../lib/format'

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
  if (qrBox.value && 'ResizeObserver' in window) {
    ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect
      qrPx.value = Math.max(120, Math.floor(Math.min(width, height) - 8))
    })
    ro.observe(qrBox.value)
  }
})
onBeforeUnmount(() => {
  if (window.__displayUpdate === apply) delete window.__displayUpdate
  if (ro) ro.disconnect()
})

// โทนสีของแต่ละขั้นตอน (ชื่อคลาสเต็มเพื่อให้ Tailwind รู้จัก)
const THEME = {
  idle: { pill: 'bg-white text-brand-700', label: 'ยินดีต้อนรับ' },
  shopping: { pill: 'bg-white text-brand-700', label: 'กำลังเลือกสินค้า' },
  paying: { pill: 'bg-honey text-stone-900', label: 'กำลังชำระเงิน' },
  thanks: { pill: 'bg-matcha text-stone-900', label: 'ชำระเรียบร้อย' },
}
const theme = computed(() => THEME[state.value.status] || THEME.idle)
const many = computed(() => (state.value.lines || []).length > 6)
const remaining = computed(() => Number(state.value.remaining) || 0)
const pricing = computed(() => state.value.pricing || { full: 0, discounts: [], saved: 0, surcharge: 0, vatMode: null, vatRate: 0, vat: 0 })
const hasDiscount = computed(() => (pricing.value.discounts || []).length > 0)

// สีป้ายวิธีชำระ (ตามชื่อวิธีชำระที่ POS ส่งมา) โทนคลุม
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
  <div class="flex h-dvh flex-col overflow-hidden bg-cream text-stone-800">
    <!-- หัวข้อ: ชื่อร้าน + สถานะ (สีเปลี่ยนตามขั้นตอน) -->
    <header class="flex shrink-0 items-center justify-between gap-4 bg-linear-to-br from-hero-1 via-hero-2 to-hero-3 px-[clamp(1rem,3vw,2.5rem)] py-[clamp(0.6rem,2vh,1.25rem)] text-white shadow-md">
      <div class="min-w-0">
        <div class="truncate font-display font-medium text-[clamp(1.25rem,4.2vh,2.25rem)] leading-tight">{{ state.shopName || 'ยินดีต้อนรับ' }}</div>
        <div class="text-[clamp(0.75rem,2vh,1rem)] text-white/90">ขอบคุณที่มาอุดหนุนค่ะ</div>
      </div>
      <div class="shrink-0 rounded-full px-[clamp(0.75rem,2vw,1.5rem)] py-[clamp(0.3rem,1vh,0.6rem)] font-semibold text-[clamp(0.8rem,2.2vh,1.15rem)]" :class="theme.pill">
        {{ theme.label }}
      </div>
    </header>

    <!-- เนื้อหาหลัก -->
    <main class="flex min-h-0 flex-1 flex-col gap-[clamp(0.5rem,1.6vh,1rem)] p-[clamp(0.6rem,2vh,1.5rem)]">
      <!-- กำลังเลือกสินค้า: รายการ (ซ้าย) · สรุปยอดพร้อมส่วนลดทั้งหมด (ขวา) -->
      <template v-if="state.status === 'shopping'">
        <div class="grid min-h-0 flex-1 gap-[clamp(0.5rem,1.6vh,1rem)] sm:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          <section class="flex min-h-0 flex-col overflow-hidden rounded-3xl bg-white shadow-md">
            <div class="flex shrink-0 items-center justify-between bg-brand-50 px-[clamp(0.9rem,2vw,1.5rem)] py-[clamp(0.4rem,1.2vh,0.75rem)]">
              <span class="font-semibold text-brand-700 text-[clamp(0.9rem,2.6vh,1.15rem)]">รายการที่สั่ง</span>
              <span class="rounded-full bg-honey px-3 py-0.5 text-[clamp(0.75rem,2vh,0.95rem)] font-semibold text-stone-900">{{ (state.lines || []).length }} รายการ</span>
            </div>
            <ul class="min-h-0 flex-1 space-y-[clamp(0.4rem,1.2vh,0.75rem)] overflow-y-auto p-[clamp(0.6rem,1.6vh,1.25rem)]">
              <li v-for="(l, i) in state.lines" :key="i" class="flex items-start gap-[clamp(0.5rem,1.4vw,0.9rem)] rounded-2xl bg-stone-50 p-[clamp(0.4rem,1.2vh,0.85rem)]">
                <span class="grid aspect-square h-[clamp(2rem,5.2vh,2.75rem)] shrink-0 place-items-center rounded-xl bg-brand-100 font-bold text-brand-800 text-[clamp(0.9rem,2.6vh,1.2rem)]">{{ l.qty }}</span>
                <div class="min-w-0 flex-1">
                  <div class="break-words font-medium text-stone-900 text-[clamp(0.95rem,3vh,1.4rem)]">{{ l.name }}</div>
                  <div class="text-stone-600 text-[clamp(0.8rem,2.3vh,1.05rem)]">
                    {{ l.qty }} × <span v-if="l.fullUnit !== l.unit" class="text-stone-400 line-through">{{ money(l.fullUnit) }}</span>
                    {{ money(l.unit) }}
                  </div>
                  <div v-if="l.tags?.length" class="mt-1 flex flex-wrap gap-1">
                    <span v-for="(t, k) in l.tags" :key="k" class="rounded-full bg-honey/50 px-2 py-0.5 text-[clamp(0.7rem,1.9vh,0.9rem)] text-stone-900">{{ t }}</span>
                  </div>
                </div>
                <span class="shrink-0 font-semibold text-stone-900 text-[clamp(0.95rem,3vh,1.4rem)]">{{ money(l.amount) }}</span>
              </li>
            </ul>
          </section>

          <section class="flex min-h-0 flex-col overflow-hidden rounded-3xl bg-white shadow-md">
            <div class="shrink-0 bg-brand-50 px-[clamp(0.9rem,2vw,1.5rem)] py-[clamp(0.4rem,1.2vh,0.75rem)]">
              <span class="font-semibold text-brand-700 text-[clamp(0.9rem,2.6vh,1.15rem)]">สรุปยอด</span>
            </div>
            <div class="flex min-h-0 flex-1 flex-col gap-[clamp(0.3rem,1vh,0.6rem)] overflow-y-auto p-[clamp(0.8rem,2vh,1.5rem)] text-[clamp(0.85rem,2.5vh,1.15rem)]">
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
              <div v-if="hasDiscount" class="mt-1 rounded-2xl bg-brand-50 px-3 py-2 text-center text-brand-700 font-semibold">
                ประหยัดไป {{ money(pricing.saved) }}
              </div>
              <div class="mt-auto flex items-end justify-between gap-3 border-t border-stone-200 pt-3">
                <span class="font-semibold text-stone-900 text-[clamp(1rem,3vh,1.4rem)]">ยอดสุทธิ</span>
                <span class="font-display font-semibold text-stone-900 text-[clamp(1.25rem,4.4vh,2rem)]">{{ money(state.total) }}</span>
              </div>
            </div>
          </section>
        </div>
      </template>

      <!-- กำลังชำระเงิน: ยอดและวิธีชำระ (ซ้าย) · QR (ขวา) -->
      <template v-else-if="state.status === 'paying'">
        <div class="grid min-h-0 flex-1 gap-[clamp(0.5rem,1.6vh,1rem)] sm:grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)]">
          <section class="flex min-h-0 flex-col overflow-hidden rounded-3xl bg-white shadow-md">
            <div class="shrink-0 bg-brand-50 px-[clamp(0.9rem,2vw,1.5rem)] py-[clamp(0.4rem,1.2vh,0.75rem)]">
              <span class="font-semibold text-brand-700 text-[clamp(0.9rem,2.6vh,1.15rem)]">การชำระเงิน</span>
            </div>
            <div class="flex min-h-0 flex-1 flex-col gap-[clamp(0.5rem,1.6vh,1rem)] overflow-y-auto p-[clamp(0.9rem,2vh,1.5rem)]">
              <div>
                <div class="text-stone-500 text-[clamp(0.85rem,2.4vh,1.1rem)]">ยอดที่ต้องชำระ</div>
                <div class="font-display font-semibold text-stone-900 text-[clamp(2rem,8vh,3.75rem)] leading-tight">{{ money(state.total) }}</div>
              </div>
              <div class="space-y-1 text-[clamp(0.8rem,2.3vh,1.05rem)] text-stone-700">
                <div v-for="(d, k) in pricing.discounts" :key="'d' + k" class="flex justify-between gap-3 text-brand-700">
                  <span class="min-w-0 break-words">{{ d.label }}</span><span class="shrink-0 font-semibold">−{{ money(d.amount) }}</span>
                </div>
                <div v-if="pricing.vatMode === 'exclusive'" class="flex justify-between gap-3">
                  <span>VAT {{ pricing.vatRate }}% (บวกเพิ่ม)</span><span class="shrink-0">+{{ money(pricing.vat) }}</span>
                </div>
              </div>
              <ul v-if="state.payLines?.length" class="space-y-[clamp(0.35rem,1vh,0.6rem)]">
                <li v-for="(p, i) in state.payLines" :key="i" class="flex items-center justify-between gap-3 rounded-2xl bg-stone-50 p-[clamp(0.4rem,1.2vh,0.85rem)]">
                  <span class="rounded-full px-3 py-1 font-semibold text-[clamp(0.8rem,2.2vh,1rem)]" :class="chipOf(p.method)">{{ p.method }}</span>
                  <span class="font-semibold text-stone-900 text-[clamp(1rem,3vh,1.4rem)]">
                    {{ money(p.amount) }}
                    <span v-if="p.done" class="ml-1 text-stone-800">✓</span>
                  </span>
                </li>
              </ul>
            </div>
          </section>

          <section class="flex min-h-0 flex-col overflow-hidden rounded-3xl bg-white shadow-md">
            <div class="flex shrink-0 items-center justify-center bg-matcha-soft px-4 py-[clamp(0.4rem,1.2vh,0.75rem)]">
              <span class="font-semibold text-stone-900 text-[clamp(0.9rem,2.6vh,1.15rem)]">สแกน QR เพื่อชำระ</span>
            </div>
            <div ref="qrBox" class="flex min-h-0 flex-1 items-center justify-center p-[clamp(0.3rem,1vh,0.75rem)]">
              <img
                v-if="state.qr && qrSrc"
                :src="qrSrc"
                alt="QR พร้อมเพย์สำหรับชำระเงิน"
                :style="{ width: qrPx + 'px', height: qrPx + 'px' }"
                class="rounded-2xl bg-white "
              />
              <div v-else class="text-stone-400">รอสร้าง QR</div>
            </div>
            <div v-if="state.qr" class="shrink-0 pb-[clamp(0.5rem,1.6vh,1rem)] text-center font-display font-semibold text-brand-700 text-[clamp(1.25rem,4.4vh,2rem)]">
              {{ money(state.qr.amount) }}
            </div>
          </section>
        </div>
      </template>

      <!-- ชำระเรียบร้อย -->
      <template v-else-if="state.status === 'thanks'">
        <section class="flex flex-1 flex-col items-center justify-center gap-[clamp(0.75rem,2.5vh,1.5rem)] rounded-3xl bg-white p-8 text-center shadow-md">
          <div class="grid aspect-square h-[clamp(4.5rem,16vh,7rem)] place-items-center rounded-full bg-matcha-soft text-stone-800">
            <AppIcon name="check" :size="56" />
          </div>
          <div class="font-display font-medium text-stone-900 text-[clamp(2.5rem,11vh,5rem)] leading-tight">ขอบคุณค่ะ</div>
          <div class="text-stone-600 text-[clamp(1rem,3.4vh,1.5rem)]">ชำระเรียบร้อยแล้ว <span class="font-bold text-stone-900">{{ money(state.total) }}</span></div>
          <div v-if="(state.saved || 0) > 0" class="rounded-full bg-brand-50 px-5 py-2 font-semibold text-brand-700 text-[clamp(0.95rem,3vh,1.3rem)]">ประหยัดไป {{ money(state.saved) }}</div>
        </section>
      </template>

      <!-- ยินดีต้อนรับ (ยังไม่มีรายการ) -->
      <template v-else>
        <section class="relative flex flex-1 flex-col items-center justify-center overflow-hidden rounded-3xl bg-white p-8 text-center shadow-md">
          <div class="absolute -left-16 -top-16 h-56 w-56 rounded-full bg-honey/30" />
          <div class="absolute -bottom-20 -right-10 h-64 w-64 rounded-full bg-matcha-soft" />
          <div class="relative">
            <div class="font-display font-bold text-brand-800 text-[clamp(2.25rem,10vh,4.5rem)] leading-tight">ยินดีต้อนรับค่ะ</div>
            <div class="mt-3 text-stone-600 text-[clamp(1rem,3.4vh,1.5rem)]">เชิญเลือกสินค้าได้เลยค่ะ</div>
            <div class="mt-[clamp(1rem,4vh,2rem)] flex flex-wrap justify-center gap-3 font-semibold text-[clamp(0.85rem,2.6vh,1.1rem)]">
              <span class="rounded-full bg-matcha-soft px-4 py-2 text-stone-800">เงินสด</span>
              <span class="rounded-full bg-brand-100 px-4 py-2 text-brand-800">โอนเงิน QR</span>
              <span class="rounded-full bg-stone-200 px-4 py-2 text-stone-800">บัตร</span>
            </div>
          </div>
        </section>
      </template>
    </main>

    <!-- แถบยอดด้านล่าง: ยอดรวม (กำลังเลือก) · ยอดคงค้าง (กำลังชำระ) -->
    <footer v-if="state.status === 'shopping'" class="flex shrink-0 items-center justify-between gap-4 bg-choco px-[clamp(1rem,3vw,2.5rem)] py-[clamp(0.6rem,2vh,1.25rem)] text-cream">
      <span class="text-cream/85 text-[clamp(0.95rem,3vh,1.5rem)]">ยอดรวมทั้งหมด</span>
      <span class="font-display font-semibold text-[clamp(2rem,8vh,3.75rem)] leading-tight">{{ money(state.total) }}</span>
    </footer>
    <footer v-else-if="state.status === 'paying'" class="flex shrink-0 items-center justify-between gap-4 bg-choco px-[clamp(1rem,3vw,2.5rem)] py-[clamp(0.6rem,2vh,1.25rem)] text-cream">
      <span v-if="remaining > 0" class="rounded-full bg-honey px-5 py-2 font-bold text-stone-900 text-[clamp(0.95rem,3vh,1.5rem)]">ยังขาด {{ money(remaining) }}</span>
      <span v-else class="rounded-full bg-matcha px-5 py-2 font-bold text-stone-900 text-[clamp(0.95rem,3vh,1.5rem)]">ครบแล้ว ✓</span>
      <span class="font-display font-semibold text-[clamp(1.75rem,7vh,3rem)] leading-tight">{{ money(state.total) }}</span>
    </footer>
  </div>
</template>
