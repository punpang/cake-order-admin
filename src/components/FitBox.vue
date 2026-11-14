<script setup>
// กล่องย่อเนื้อหาให้พอดีพื้นที่ (ใช้กับจอลูกค้าที่สัมผัสไม่ได้ จึงไม่มีการเลื่อน)
// เนื้อหาไม่ล้น → แสดงขนาดปกติ · ล้น → ย่อทั้งชุดตามสัดส่วน (ไม่ตัดข้อความ) จนพอดี · ย่อได้ไม่เกิน min
import { nextTick, onBeforeUnmount, onMounted, onUpdated, ref } from 'vue'

const emit = defineEmits(['fit'])

const props = defineProps({
  min: { type: Number, default: 0.4 },
})

const outer = ref(null)
const inner = ref(null)
let ro = null

function fit() {
  const o = outer.value
  const i = inner.value
  // ยังไม่มีขนาด (ยังไม่แสดงบนจอ) → ข้ามไปก่อน กันการตัดสินผิด
  if (!o || !i || o.clientHeight <= 0) return
  const availH = o.clientHeight
  i.style.transformOrigin = 'top left'
  // ความสูงที่แสดงจริงเมื่อย่อที่ s: ความกว้างขยายตาม 1/s ทำให้ขึ้นบรรทัดน้อยลง จึงต้องวัดใหม่ทุกค่า
  const apply = (s) => {
    i.style.transform = s < 1 ? `scale(${s})` : 'none'
    i.style.width = s < 1 ? `${100 / s}%` : '100%'
    return i.offsetHeight * s
  }
  let s = 1
  if (apply(1) > availH) {
    if (apply(props.min) > availH) {
      s = props.min
    } else {
      // ค้นแบบแบ่งครึ่งหาค่าย่อที่มากที่สุดที่ยังพอดี (ใหญ่สุดที่อ่านได้โดยไม่ตัดเนื้อหา)
      let lo = props.min
      let hi = 1
      for (let n = 0; n < 10; n++) {
        const mid = (lo + hi) / 2
        if (apply(mid) <= availH) lo = mid
        else hi = mid
      }
      s = lo
    }
  }
  const visual = apply(s)
  // overflow = ยังล้นแม้ย่อถึงขั้นต่ำสุดแล้ว (ผู้เรียกใช้ตัดรายการท้ายสุดเองได้)
  emit('fit', { scale: s, overflow: visual > availH + 1 })
}

onMounted(() => {
  nextTick(fit)
  if (outer.value && 'ResizeObserver' in window) {
    ro = new ResizeObserver(() => fit())
    ro.observe(outer.value)
  }
  if (document.fonts?.ready) document.fonts.ready.then(fit)
})
onUpdated(fit)
onBeforeUnmount(() => {
  if (ro) ro.disconnect()
})
</script>

<template>
  <div ref="outer" class="relative flex min-h-0 flex-1 flex-col overflow-hidden">
    <div ref="inner" class="shrink-0">
      <slot />
    </div>
  </div>
</template>
