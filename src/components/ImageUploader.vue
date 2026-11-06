<script setup>
import { ref } from 'vue'
import AppIcon from './AppIcon.vue'

// อัปโหลดรูป (จำลอง): ย่อรูปแล้วเก็บเป็น dataURL ในหน่วยความจำ (รีเฟรชแล้วหาย) · ของจริงเก็บใน Supabase Storage
const model = defineModel({ type: Array, default: () => [] })
const props = defineProps({ max: { type: Number, default: 6 }, label: { type: String, default: 'เพิ่มรูป' } })
const error = ref('')

const MAX_SIDE = 1200
function shrink(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const k = Math.min(1, MAX_SIDE / Math.max(img.width, img.height))
      const c = document.createElement('canvas')
      c.width = Math.round(img.width * k)
      c.height = Math.round(img.height * k)
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
      URL.revokeObjectURL(url)
      resolve(c.toDataURL('image/jpeg', 0.82))
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('อ่านรูปไม่ได้'))
    }
    img.src = url
  })
}
async function onFiles(e) {
  error.value = ''
  const files = [...e.target.files].filter((f) => f.type.startsWith('image/'))
  e.target.value = ''
  const room = props.max - model.value.length
  if (files.length > room) error.value = `เพิ่มได้อีก ${Math.max(room, 0)} รูป (สูงสุด ${props.max})`
  const next = [...model.value]
  for (const f of files.slice(0, Math.max(room, 0))) {
    try {
      next.push(await shrink(f))
    } catch {
      error.value = 'บางไฟล์อ่านไม่ได้'
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
    <p v-if="error" class="mt-1 text-xs text-rose-600">{{ error }}</p>
  </div>
</template>
