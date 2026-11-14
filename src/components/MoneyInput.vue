<script setup>
import { ref, watch } from 'vue'

// ช่องกรอกตัวเลขแบบทศนิยม (จำนวนเงิน ราคา ส่วนลด ฯลฯ)
// ขณะพิมพ์: มีลูกน้ำในจำนวนเต็ม เช่น 48,058 · ทศนิยมแสดงตามที่พิมพ์
// เมื่อออกจากช่อง: แสดง x,xxx.xx เสมอ เช่น 48,058.00
// ค่าที่ส่งออก (v-model) เป็นตัวเลขดิบไม่มีลูกน้ำ เช่น "48058.5" จึงใช้กับโค้ดเดิมได้เหมือนเดิม
// ใส่ allow-negative เพื่ออนุญาตเครื่องหมายลบ (เช่น ปรับรายการ +/−)
const props = defineProps({
  modelValue: { type: [String, Number], default: '' },
  allowNegative: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue'])

const text = ref('')
const focused = ref(false)
let lastRaw = null // ค่าดิบที่ส่งออกล่าสุดจากการพิมพ์ (กันการเขียนทับตอนพิมพ์)

// รูปดิบ: ตัวเลข จุดได้ 1 จุด ทศนิยมไม่เกิน 2 ตำแหน่ง ไม่มีศูนย์นำหน้า (+ เครื่องหมายลบเมื่ออนุญาต)
const toRaw = (v) => {
  const s = String(v ?? '')
  const neg = props.allowNegative && s.trim().startsWith('-')
  let body = s.replace(/[^0-9.]/g, '')
  const i = body.indexOf('.')
  if (i >= 0) body = body.slice(0, i + 1) + body.slice(i + 1).replace(/\./g, '').slice(0, 2)
  body = body.replace(/^0+(?=\d)/, '')
  return (neg ? '-' : '') + body
}
const groupInt = (s) => s.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
// ระหว่างพิมพ์: ลูกน้ำในจำนวนเต็ม ทศนิยมตามที่พิมพ์
const typingText = (raw) => {
  const neg = raw.startsWith('-')
  const body = neg ? raw.slice(1) : raw
  const i = body.indexOf('.')
  return `${neg ? '-' : ''}${groupInt(i >= 0 ? body.slice(0, i) : body)}${i >= 0 ? body.slice(i) : ''}`
}
// เมื่อออกจากช่อง: ลูกน้ำในจำนวนเต็ม + ทศนิยม 2 ตำแหน่งเสมอ เช่น 48058 → 48,058.00
const finalText = (raw) => {
  const neg = raw.startsWith('-')
  const body = neg ? raw.slice(1) : raw
  const i = body.indexOf('.')
  const int = i >= 0 ? body.slice(0, i) : body
  const dec = i >= 0 ? body.slice(i + 1) : null
  if (int === '' && dec === null) return ''
  return `${neg ? '-' : ''}${groupInt(int || '0')}.${(dec || '').padEnd(2, '0')}`
}

text.value = finalText(toRaw(props.modelValue))

const onFocus = () => {
  focused.value = true
  lastRaw = null
  // เปิดช่องแล้วตัด .00 ที่แสดงอยู่ ให้พิมพ์ต่อจากตัวเลขได้ทันที
  text.value = typingText(toRaw(props.modelValue).replace(/\.00$/, ''))
}
const onBlur = () => {
  focused.value = false
  lastRaw = null
  text.value = finalText(toRaw(props.modelValue))
}
const onInput = (e) => {
  if (e.isComposing) return
  const el = e.target
  // นับอักขระที่มีความหมาย (ตัวเลข จุด เครื่องหมายลบ) ก่อนเคอร์เซอร์ แล้ววางเคอร์เซอร์กลับที่เดิมหลังจัดลูกน้ำใหม่
  const caret = el.selectionStart ?? el.value.length
  const keep = toRaw(el.value.slice(0, caret)).length
  const raw = toRaw(el.value)
  const shown = typingText(raw)
  lastRaw = raw
  text.value = shown
  el.value = shown
  let pos = 0
  let n = 0
  while (pos < shown.length && n < keep) { if (/[-0-9.]/.test(shown[pos])) n++; pos++ }
  try { el.setSelectionRange(pos, pos) } catch { /* ช่องนี้ไม่รองรับการวางเคอร์เซอร์ */ }
  emit('update:modelValue', raw)
}

watch(() => props.modelValue, (v) => {
  if (focused.value) {
    // ค่าที่เพิ่งส่งออกจากการพิมพ์เอง (เทียบเป็นตัวเลข) ไม่เขียนทับข้อความที่กำลังพิมพ์ เช่น "480." ไม่ถูกตัดจุด
    if (lastRaw !== null && Number(toRaw(v)) === Number(lastRaw)) return
    text.value = typingText(toRaw(v))
  } else {
    text.value = finalText(toRaw(v))
  }
})
</script>

<template>
  <input
    type="text"
    :inputmode="allowNegative ? 'text' : 'decimal'"
    autocomplete="off"
    :value="text"
    @input="onInput"
    @focus="onFocus"
    @blur="onBlur"
  />
</template>
