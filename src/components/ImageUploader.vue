<script setup>
import { ref } from 'vue'
import AppIcon from './AppIcon.vue'
import { resizeImage, imageErrorMessage } from '../lib/imageResize'

// เลือกรูป: ย่อ (ด้านยาว ≤1000px, ≤2MB) แล้วถือเป็น dataURL ชั่วคราว · ตอนบันทึกจะอัปโหลดขึ้น Supabase Storage (storage.js)
const model = defineModel({ type: Array, default: () => [] })
const props = defineProps({ max: { type: Number, default: 6 }, label: { type: String, default: 'เพิ่มรูป' } })
const error = ref('')

async function onFiles(e) {
  error.value = ''
  const files = [...e.target.files].filter((f) => f.type.startsWith('image/'))
  e.target.value = ''
  const room = props.max - model.value.length
  if (files.length > room) error.value = `เพิ่มได้อีก ${Math.max(room, 0)} รูป (สูงสุด ${props.max})`
  const next = [...model.value]
  for (const f of files.slice(0, Math.max(room, 0))) {
    try {
      next.push((await resizeImage(f)).dataUrl)
    } catch (err) {
      error.value = imageErrorMessage(err)
    }
  }
  model.value = next
}
const remove = (i) => (model.value = model.value.filter((_, j) => j !== i))
const move = (i, d) => {
  const j = i + d
  if (j < 0 || j >= model.value.length) return
  const a = [...model.value]
  ;[a[i], a[j]] = [a[j], a[i]]
  model.value = a
}
</script>

<template>
  <div>
    <div class="flex flex-wrap gap-2">
      <div v-for="(src, i) in model" :key="i" class="relative">
        <img :src="src" alt="" class="h-20 w-20 rounded-xl border border-stone-200 object-cover" />
        <button type="button" class="absolute -top-1.5 -right-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-stone-900 text-white shadow" aria-label="ลบรูป" @click="remove(i)">
          <AppIcon name="x" :size="14" />
        </button>
        <div v-if="model.length > 1" class="absolute inset-x-0 bottom-0 flex justify-between px-1 pb-0.5">
          <button type="button" class="rounded bg-black/50 px-1 text-xs text-white disabled:opacity-30" :disabled="i === 0" aria-label="เลื่อนซ้าย" @click="move(i, -1)">‹</button>
          <button type="button" class="rounded bg-black/50 px-1 text-xs text-white disabled:opacity-30" :disabled="i === model.length - 1" aria-label="เลื่อนขวา" @click="move(i, 1)">›</button>
        </div>
      </div>
      <label v-if="model.length < max" class="flex h-20 w-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-stone-300 text-xs text-stone-500 hover:bg-stone-50">
        <AppIcon name="image" :size="20" />
        {{ label }}
        <input type="file" accept="image/*" :multiple="max > 1" class="hidden" @change="onFiles" />
      </label>
    </div>
    <p v-if="error" class="mt-1 text-xs text-rose-700">{{ error }}</p>
  </div>
</template>
