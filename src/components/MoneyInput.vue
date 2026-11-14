<script setup>
import { ref, watch } from 'vue'

// ช่องกรอกตัวเลขแบบทศนิยม (จำนวนเงิน ราคา ส่วนลด ฯลฯ) · ขณะพิมพ์แสดงตัวเลขดิบ พิมพ์ต่อได้ตามปกติ
// เมื่อออกจากช่องแสดงรูปแบบ x,xxx.xx (ทศนิยม 2 ตำแหน่งเสมอ) · ค่าที่ส่งออก (v-model) เป็นตัวเลขดิบ ไม่มีลูกน้ำ
// เช่น "48066.5" จึงใช้กับโค้ดเดิมได้เหมือนเดิม · ใส่ allow-negative เพื่ออนุญาตเครื่องหมายลบ (เช่น ปรับรายการ +/−)
const props = defineProps({
  modelValue: { type: [String, Number], default: '' },
  allowNegative: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue'])

const text = ref('')
const focused = ref(false)
let lastRaw = null // ค่าดิบที่ส่งออกล่าสุดจากการพิมพ์ (กันการเขียนทับตอนพิมพ์)

// รูปดิบ: ตัวเลข จุดได้ 1 จุด ทศนิยมไม่เกิน 2 ตำแหน่ง (+ เครื่องหมายลบนำหน้าเมื่ออนุญาต)
const toRaw = (v) => {
  const s = String(v ?? '')
  const neg = props.allowNegative && s.trim().startsWith('-')
  let body = s.replace(/[^0-9.]/g, '')
  const i = body.indexOf('.')
  if (i >= 0) body = body.slice(0, i + 1) + body.slice(i + 1).replace(/\./g, '').slice(0, 2)
  return (neg ? '-' : '') + body
}
// เมื่อออกจากช่อง: ลูกน้ำในจำนวนเต็ม + ทศนิยม 2 ตำแหน่ง เช่น 48066 → 48,066.00
const finalText = (raw) => {
  const neg = raw.startsWith('-')
  const body = neg ? raw.slice(1) : raw
  const i = body.indexOf('.')
  const int = i >= 0 ? body.slice(0, i) : body
  const dec = i >= 0 ? body.slice(i + 1) : null
  if (int === '' && dec === null) return ''
  const grouped = (int || '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${neg ? '-' : ''}${grouped}.${(dec || '').padEnd(2, '0')}`
}

text.value = finalText(toRaw(props.modelValue))

const onFocus = () => {
  focused.value = true
  lastRaw = null
  // เปิดช่องแล้วตัด .00 ที่แสดงอยู่ ให้พิมพ์ต่อจากตัวเลขได้ทันที
  text.value = toRaw(props.modelValue).replace(/\.00$/, '')
}
const onBlur = () => {
  focused.value = false
  lastRaw = null
  text.value = finalText(toRaw(props.modelValue))
}
const onInput = (e) => {
  if (e.isComposing) return
  const el = e.target
  const raw = toRaw(el.value)
  if (el.value !== raw) el.value = raw // ตัดอักขระที่ไม่ใช่ตัวเลขทันทีตอนพิมพ์/วาง
  lastRaw = raw
  text.value = raw
  emit('update:modelValue', raw)
}

watch(() => props.modelValue, (v) => {
  if (focused.value) {
    // ค่าที่เพิ่งส่งออกจากการพิมพ์เอง (เทียบเป็นตัวเลข) ไม่เขียนทับข้อความที่กำลังพิมพ์ เช่น "480." ไม่ถูกตัดจุด
    if (lastRaw !== null && Number(toRaw(v)) === Number(lastRaw)) return
    text.value = toRaw(v)
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
