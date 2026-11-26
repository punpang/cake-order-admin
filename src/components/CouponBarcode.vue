<script setup>
// บาร์โค้ด Code128 (คูปองหรือรหัสสมาชิก) ให้พนักงานสแกนที่ร้าน · วาดเป็น SVG เองจาก src/lib/code128.js (ไม่พึ่งไลบรารีภายนอก)
import { computed } from 'vue'
import { encode128B } from '../lib/code128.js'

const props = defineProps({
  value: { type: String, required: true },
  label: { type: String, default: 'บาร์โค้ดคูปอง' },
  caption: { type: String, default: 'ให้พนักงานสแกนที่ร้าน' },
})

// ขนาดเดิมของบาร์โค้ด: หนึ่งโมดูล 2px แท่งสูง 56px ระยะขอบ 6px ตัวอักษร 14px เว้น 4px
const MODULE = 2
const HEIGHT = 56
const MARGIN = 6
const FONT = 14
const TEXT_GAP = 4

const bits = computed(() => {
  try { return encode128B(props.value) } catch { return '' }
})
const failed = computed(() => bits.value === '')
const width = computed(() => bits.value.length * MODULE + MARGIN * 2)
const height = MARGIN + HEIGHT + TEXT_GAP + FONT + MARGIN

// รวมบิต 1 ที่ต่อกันเป็นสี่เหลี่ยมเดียวต่อหนึ่งแท่ง (เส้นทางเดียวในแท็ก path)
const pathD = computed(() => {
  const b = bits.value
  let d = ''
  let i = 0
  while (i < b.length) {
    if (b[i] === '1') {
      let j = i
      while (j < b.length && b[j] === '1') j++
      d += `M${MARGIN + i * MODULE} ${MARGIN}h${(j - i) * MODULE}v${HEIGHT}h${-(j - i) * MODULE}z`
      i = j
    } else {
      i++
    }
  }
  return d
})
</script>

<template>
  <div class="flex flex-col items-center gap-1 rounded-xl bg-white p-3">
    <svg v-if="!failed" role="img" :aria-label="label" :viewBox="`0 0 ${width} ${height}`" :width="width" :height="height" class="max-w-full" :data-scan="value">
      <path :d="pathD" fill="#000" />
      <text :x="width / 2" :y="MARGIN + HEIGHT + TEXT_GAP + FONT" text-anchor="middle" :font-size="FONT" fill="#000" font-family="monospace">{{ value }}</text>
    </svg>
    <p v-if="failed" class="text-xs text-danger-700" role="alert">แสดงบาร์โค้ดไม่ได้ กรุณาลองใหม่</p>
    <p class="text-xs text-stone-500">{{ caption }}</p>
  </div>
</template>
