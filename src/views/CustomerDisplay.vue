<script setup>
// จอแสดงให้ลูกค้า (หน้า /display) · รับสถานะจากแอป POS ผ่าน window.__displayUpdate (แอป Android ส่งเข้ามา)
// โทนคลุม (มัว ๆ นุ่มตา): หัวข้อ · เนื้อหาหลัก · แถบยอดด้านล่าง แยกกันด้วยสีที่เบาลง · สีเปลี่ยนตามขั้นตอน
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
  idle: { head: 'bg-[#9b6a72]', pill: 'text-[#7d4f58]', label: 'ยินดีต้อนรับ' },
  shopping: { head: 'bg-[#9b6a72]', pill: 'text-[#7d4f58]', label: 'กำลังเลือกสินค้า' },
  paying: { head: 'bg-[#8c6d45]', pill: 'text-[#6d5232]', label: 'กำลังชำระเงิน' },
  thanks: { head: 'bg-[#5f7d6b]', pill: 'text-[#48604f]', label: 'ชำระเรียบร้อย' },
}
const theme = computed(() => THEME[state.value.status] || THEME.idle)
const many = computed(() => (state.value.lines || []).length > 6)
const remaining = computed(() => Number(state.value.remaining) || 0)

// สีป้ายวิธีชำระ (ตามชื่อวิธีชำระที่ POS ส่งมา) โทนคลุม
const METHOD_CHIP = {
  เงินสด: 'bg-[#dfeae3] text-[#3f5a4a]',
  โอนเงิน: 'bg-[#e1e8f0] text-[#3e4f63]',
  บัตร: 'bg-[#e8e2ef] text-[#4e4262]',
}
const chipOf = (m) => METHOD_CHIP[m] || 'bg-[#efe9e4] text-stone-700'

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
  <div class="flex h-dvh flex-col overflow-hidden bg-[#f7f2ec] text-stone-800">
    <!-- หัวข้อ: ชื่อร้าน + สถานะ (สีเปลี่ยนตามขั้นตอน) -->
    <header class="flex shrink-0 items-center justify-between gap-4 px-[clamp(1rem,3vw,2.5rem)] py-[clamp(0.6rem,2vh,1.25rem)] text-white" :class="theme.head">
      <div class="min-w-0">
        <div class="truncate font-display font-bold text-[clamp(1.25rem,4.2vh,2.25rem)] leading-tight">{{ state.shopName || 'ยินดีต้อนรับ' }}</div>
        <div class="text-[clamp(0.75rem,2vh,1rem)] text-white/85">ขอบคุณที่มาอุดหนุนค่ะ</div>
      </div>
      <div class="shrink-0 rounded-full bg-[#fdf9f6] px-[clamp(0.75rem,2vw,1.5rem)] py-[clamp(0.3rem,1vh,0.6rem)] font-semibold text-[clamp(0.8rem,2.2vh,1.15rem)]" :class="theme.pill">
        {{ theme.label }}
      </div>
    </header>

    <!-- เนื้อหาหลัก -->
    <main class="flex min-h-0 flex-1 flex-col gap-[clamp(0.5rem,1.6vh,1rem)] p-[clamp(0.6rem,2vh,1.5rem)]">
      <!-- กำลังเลือกสินค้า: รายการที่สั่ง -->
      <template v-if="state.status === 'shopping'">
        <section class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl bg-[#fffdfb] shadow-sm ring-1 ring-[#eadfd6]">
          <div class="flex shrink-0 items-center justify-between bg-[#f5eaec] px-[clamp(0.9rem,2vw,1.5rem)] py-[clamp(0.4rem,1.2vh,0.75rem)]">
            <span class="font-semibold text-[#7d4f58] text-[clamp(0.9rem,2.6vh,1.15rem)]">รายการที่สั่ง</span>
            <span class="rounded-full bg-[#9b6a72] px-3 py-0.5 text-[clamp(0.75rem,2vh,0.95rem)] font-semibold text-white">{{ (state.lines || []).length }} รายการ</span>
          </div>
          <ul
            class="min-h-0 flex-1 overflow-y-auto p-[clamp(0.6rem,1.6vh,1.25rem)]"
            :class="many ? 'grid gap-x-5 gap-y-[clamp(0.4rem,1.2vh,0.75rem)] sm:grid-cols-2' : 'space-y-[clamp(0.4rem,1.2vh,0.75rem)]'"
          >
            <li
              v-for="(l, i) in state.lines"
              :key="i"
              class="flex items-center gap-[clamp(0.6rem,1.6vw,1rem)] rounded-2xl bg-[#f8f4f0] p-[clamp(0.4rem,1.2vh,0.85rem)]"
            >
              <span class="grid aspect-square h-[clamp(2rem,5.6vh,3rem)] shrink-0 place-items-center rounded-xl bg-[#f3e6e8] font-bold text-[#7d4f58] text-[clamp(0.9rem,2.6vh,1.2rem)]">{{ l.qty }}</span>
              <span class="min-w-0 flex-1 break-words font-medium text-stone-800 text-[clamp(1rem,3.2vh,1.65rem)]">{{ l.name }}</span>
              <span class="shrink-0 font-semibold text-stone-900 text-[clamp(1rem,3.2vh,1.65rem)]">{{ money(l.amount) }}</span>
            </li>
          </ul>
        </section>
      </template>

      <!-- กำลังชำระเงิน: ยอดและวิธีชำระ (ซ้าย) · QR (ขวา) -->
      <template v-else-if="state.status === 'paying'">
        <div class="grid min-h-0 flex-1 gap-[clamp(0.5rem,1.6vh,1rem)] sm:grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)]">
          <section class="flex min-h-0 flex-col overflow-hidden rounded-3xl bg-[#fffdfb] shadow-sm ring-1 ring-[#eadfd6]">
            <div class="shrink-0 bg-[#f5eee3] px-[clamp(0.9rem,2vw,1.5rem)] py-[clamp(0.4rem,1.2vh,0.75rem)]">
              <span class="font-semibold text-[#6d5232] text-[clamp(0.9rem,2.6vh,1.15rem)]">การชำระเงิน</span>
            </div>
            <div class="flex min-h-0 flex-1 flex-col gap-[clamp(0.5rem,1.6vh,1rem)] overflow-y-auto p-[clamp(0.9rem,2vh,1.5rem)]">
              <div>
                <div class="text-stone-500 text-[clamp(0.85rem,2.4vh,1.1rem)]">ยอดที่ต้องชำระ</div>
                <div class="font-display font-bold text-stone-900 text-[clamp(2rem,8vh,3.75rem)] leading-tight">{{ money(state.total) }}</div>
              </div>
              <ul v-if="state.payLines?.length" class="space-y-[clamp(0.35rem,1vh,0.6rem)]">
                <li v-for="(p, i) in state.payLines" :key="i" class="flex items-center justify-between gap-3 rounded-2xl bg-[#f8f4f0] p-[clamp(0.4rem,1.2vh,0.85rem)]">
                  <span class="rounded-full px-3 py-1 font-semibold text-[clamp(0.8rem,2.2vh,1rem)]" :class="chipOf(p.method)">{{ p.method }}</span>
                  <span class="font-semibold text-stone-900 text-[clamp(1rem,3vh,1.4rem)]">
                    {{ money(p.amount) }}
                    <span v-if="p.done" class="ml-1 text-[#56705f]">✓</span>
                  </span>
                </li>
              </ul>
            </div>
          </section>

          <section class="flex min-h-0 flex-col overflow-hidden rounded-3xl bg-[#fffdfb] shadow-sm ring-1 ring-[#eadfd6]">
            <div class="flex shrink-0 items-center justify-center bg-[#e9efe9] px-4 py-[clamp(0.4rem,1.2vh,0.75rem)]">
              <span class="font-semibold text-[#48604f] text-[clamp(0.9rem,2.6vh,1.15rem)]">สแกน QR เพื่อชำระ</span>
            </div>
            <div ref="qrBox" class="flex min-h-0 flex-1 items-center justify-center p-[clamp(0.3rem,1vh,0.75rem)]">
              <img
                v-if="state.qr && qrSrc"
                :src="qrSrc"
                alt="QR พร้อมเพย์สำหรับชำระเงิน"
                :style="{ width: qrPx + 'px', height: qrPx + 'px' }"
                class="rounded-2xl bg-white ring-1 ring-[#eadfd6]"
              />
              <div v-else class="text-stone-400">รอสร้าง QR</div>
            </div>
            <div v-if="state.qr" class="shrink-0 pb-[clamp(0.5rem,1.6vh,1rem)] text-center font-display font-bold text-[#3e4f63] text-[clamp(1.25rem,4.4vh,2rem)]">
              {{ money(state.qr.amount) }}
            </div>
          </section>
        </div>
      </template>

      <!-- ชำระเรียบร้อย -->
      <template v-else-if="state.status === 'thanks'">
        <section class="flex flex-1 flex-col items-center justify-center gap-[clamp(0.75rem,2.5vh,1.5rem)] rounded-3xl bg-[#fffdfb] p-8 text-center shadow-sm ring-1 ring-[#eadfd6]">
          <div class="grid aspect-square h-[clamp(4.5rem,16vh,7rem)] place-items-center rounded-full bg-[#dfeae3] text-[#56705f]">
            <AppIcon name="check" :size="56" />
          </div>
          <div class="font-display font-bold text-stone-800 text-[clamp(2.5rem,11vh,5rem)] leading-tight">ขอบคุณค่ะ</div>
          <div class="text-stone-600 text-[clamp(1rem,3.4vh,1.5rem)]">ชำระเรียบร้อยแล้ว <span class="font-bold text-stone-900">{{ money(state.total) }}</span></div>
        </section>
      </template>

      <!-- ยินดีต้อนรับ (ยังไม่มีรายการ) -->
      <template v-else>
        <section class="relative flex flex-1 flex-col items-center justify-center overflow-hidden rounded-3xl bg-[#fffdfb] p-8 text-center shadow-sm ring-1 ring-[#eadfd6]">
          <div class="absolute -left-16 -top-16 h-56 w-56 rounded-full bg-[#f1e4e6]" />
          <div class="absolute -bottom-20 -right-10 h-64 w-64 rounded-full bg-[#e3ebe5]" />
          <div class="relative">
            <div class="font-display font-bold text-[#7d4f58] text-[clamp(2.25rem,10vh,4.5rem)] leading-tight">ยินดีต้อนรับค่ะ</div>
            <div class="mt-3 text-stone-600 text-[clamp(1rem,3.4vh,1.5rem)]">เชิญเลือกสินค้าได้เลยค่ะ</div>
            <div class="mt-[clamp(1rem,4vh,2rem)] flex flex-wrap justify-center gap-3 font-semibold text-[clamp(0.85rem,2.6vh,1.1rem)]">
              <span class="rounded-full bg-[#dfeae3] px-4 py-2 text-[#3f5a4a]">เงินสด</span>
              <span class="rounded-full bg-[#e1e8f0] px-4 py-2 text-[#3e4f63]">โอนเงิน QR</span>
              <span class="rounded-full bg-[#e8e2ef] px-4 py-2 text-[#4e4262]">บัตร</span>
            </div>
          </div>
        </section>
      </template>
    </main>

    <!-- แถบยอดด้านล่าง: ยอดรวม (กำลังเลือก) · ยอดคงค้าง (กำลังชำระ) -->
    <footer v-if="state.status === 'shopping'" class="flex shrink-0 items-center justify-between gap-4 bg-[#5e4a4d] px-[clamp(1rem,3vw,2.5rem)] py-[clamp(0.6rem,2vh,1.25rem)] text-white">
      <span class="text-white/85 text-[clamp(0.95rem,3vh,1.5rem)]">ยอดรวมทั้งหมด</span>
      <span class="font-display font-bold text-[clamp(2rem,8vh,3.75rem)] leading-tight">{{ money(state.total) }}</span>
    </footer>
    <footer v-else-if="state.status === 'paying'" class="flex shrink-0 items-center justify-between gap-4 bg-[#4a3f3a] px-[clamp(1rem,3vw,2.5rem)] py-[clamp(0.6rem,2vh,1.25rem)] text-white">
      <span v-if="remaining > 0" class="rounded-full bg-[#d9bf8f] px-5 py-2 font-bold text-[#3d2f1f] text-[clamp(0.95rem,3vh,1.5rem)]">ยังขาด {{ money(remaining) }}</span>
      <span v-else class="rounded-full bg-[#bcd3c3] px-5 py-2 font-bold text-[#23402e] text-[clamp(0.95rem,3vh,1.5rem)]">ครบแล้ว ✓</span>
      <span class="font-display font-bold text-[clamp(1.75rem,7vh,3rem)] leading-tight">{{ money(state.total) }}</span>
    </footer>
  </div>
</template>
