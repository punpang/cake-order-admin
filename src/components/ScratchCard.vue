<script setup>
// บัตรขูด (เหมือนบัตรเติมเงิน): ผิวโลหะเงินปิดผลไว้ ขูดด้วยนิ้วหรือเมาส์ ครบเกณฑ์จึงเปิดเผยผลทั้งใบ
// ผลถูกกำหนดจากเซิร์ฟเวอร์ก่อนแล้ว (หน้านี้แค่แสดง) · มีปุ่ม "เปิดเลย" สำหรับผู้ที่ขูดไม่สะดวก
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { scratchedRatio, shouldReveal } from '../lib/scratch'

const props = defineProps({
  covered: { type: Boolean, default: true }, // true = ยังมีผิวขูดปิดอยู่
  label: { type: String, default: 'ขูดตรงนี้' },
})
const emit = defineEmits(['revealed'])

const box = ref(null)
const cv = ref(null)
const fading = ref(false)
let ctx = null
let drawing = false
let last = null
let timer = 0
let finished = false
const reduceMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// วาดผิวโลหะเงินเต็มบัตร (ความละเอียดตามจอ)
function paint() {
  const el = box.value
  const c = cv.value
  if (!el || !c) return
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const w = Math.max(1, Math.round(el.clientWidth))
  const h = Math.max(1, Math.round(el.clientHeight))
  c.width = Math.round(w * dpr)
  c.height = Math.round(h * dpr)
  c.style.width = `${w}px`
  c.style.height = `${h}px`
  ctx = c.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.globalCompositeOperation = 'source-over'
  const g = ctx.createLinearGradient(0, 0, w, h)
  g.addColorStop(0, '#c4c8d0')
  g.addColorStop(0.45, '#f5f6f8')
  g.addColorStop(0.7, '#b3b8c2')
  g.addColorStop(1, '#e6e8ec')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
  for (let i = 0; i < 260; i++) { // ลายผิวโลหะ
    ctx.fillStyle = `rgba(255,255,255,${(Math.random() * 0.4).toFixed(3)})`
    ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2)
  }
  ctx.fillStyle = '#6b7280'
  ctx.font = '600 16px Prompt, Mitr, Tahoma, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(props.label, w / 2, h / 2)
  finished = false
  fading.value = false
}

// ขูดด้วยแปรงกลมตามเส้นทางของนิ้ว/เมาส์ (destination-out = ลบผิวออก)
const pt = (e) => { const r = cv.value.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top } }
function dab(p) {
  ctx.globalCompositeOperation = 'destination-out'
  ctx.beginPath()
  ctx.arc(p.x, p.y, 20, 0, Math.PI * 2)
  ctx.fill()
}
function stroke(a, b) {
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 5))
  for (let i = 0; i <= n; i++) {
    const t = i / n
    dab({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
  }
}
function onDown(e) {
  if (finished || !ctx) return
  drawing = true
  cv.value.setPointerCapture?.(e.pointerId)
  last = pt(e)
  dab(last)
  queueCheck()
}
function onMove(e) {
  if (!drawing || finished || !ctx) return
  const p = pt(e)
  stroke(last, p)
  last = p
  queueCheck()
}
function onUp() {
  drawing = false
  last = null
  check()
}
function queueCheck() {
  clearTimeout(timer)
  timer = setTimeout(check, 180)
}
// ตรวจสัดส่วนที่ขูดแล้ว · ครบเกณฑ์ = เปิดเผย
function check() {
  if (finished || !ctx || !cv.value) return
  const c = cv.value
  const ratio = scratchedRatio(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height, 8)
  if (shouldReveal(ratio)) finish()
}
// เปิดเผยผล: ผิวค่อย ๆ จางแล้วแจ้งผู้ใช้
function finish() {
  if (finished) return
  finished = true
  clearTimeout(timer)
  fading.value = true
  setTimeout(() => emit('revealed'), reduceMotion() ? 0 : 500)
}

const onResize = () => { if (props.covered && !finished) paint() }
onMounted(() => {
  paint()
  window.addEventListener('resize', onResize)
})
onBeforeUnmount(() => {
  clearTimeout(timer)
  window.removeEventListener('resize', onResize)
})
watch(() => props.covered, (v) => { if (v) nextTick(paint) })
</script>

<template>
  <div>
    <div ref="box" class="relative overflow-hidden rounded-2xl select-none">
      <slot />
      <canvas
        v-if="covered"
        ref="cv"
        class="absolute inset-0 h-full w-full touch-none cursor-crosshair transition-opacity duration-500"
        :class="fading ? 'opacity-0' : 'opacity-100'"
        role="img"
        :aria-label="label"
        @pointerdown="onDown"
        @pointermove="onMove"
        @pointerup="onUp"
        @pointercancel="onUp"
        @pointerleave="onUp"
      />
    </div>
    <div v-if="covered && !fading" class="mt-2 text-center">
      <button type="button" class="text-sm font-medium text-brand-700 underline underline-offset-4" @click="finish">เปิดเลย</button>
    </div>
  </div>
</template>
