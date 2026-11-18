<script setup>
// บาร์โค้ด Code128 (คูปองหรือรหัสสมาชิก) ให้พนักงานสแกนที่ร้าน · โหลดไลบรารีเมื่อจำเป็น
import { onMounted, ref, watch } from 'vue'

const props = defineProps({
  value: { type: String, required: true },
  label: { type: String, default: 'บาร์โค้ดคูปอง' },
  caption: { type: String, default: 'ให้พนักงานสแกนที่ร้าน' },
})
const svg = ref(null)
const failed = ref(false)

async function draw() {
  if (!svg.value) return
  failed.value = false
  try {
    const { default: JsBarcode } = await import('jsbarcode')
    JsBarcode(svg.value, props.value, { format: 'CODE128', displayValue: true, height: 56, width: 2, margin: 6, fontSize: 14, textMargin: 4 })
    svg.value.setAttribute('data-scan', props.value)
  } catch {
    failed.value = true
  }
}

onMounted(draw)
watch(() => props.value, draw)
</script>

<template>
  <div class="flex flex-col items-center gap-1 rounded-xl bg-white p-3">
    <svg ref="svg" role="img" :aria-label="label" class="max-w-full"></svg>
    <p v-if="failed" class="text-xs text-rose-700" role="alert">แสดงบาร์โค้ดไม่ได้ กรุณาลองใหม่</p>
    <p class="text-xs text-stone-500">{{ caption }}</p>
  </div>
</template>
