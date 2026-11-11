<script setup>
import { onMounted, ref, watch } from 'vue'
import { chatMediaUrl, attachLabel } from '../lib/chatMedia'

// ไฟล์แนบจากลูกค้า: รูป/สติกเกอร์/วิดีโอ/เสียง/ไฟล์ (รับและแสดงเท่านั้น)
const props = defineProps({ a: { type: Object, required: true } })
const url = ref(null)
const state = ref('loading') // loading | ok | error
const big = ref(false)

async function load() {
  if (props.a.localUrl) { url.value = props.a.localUrl; return (state.value = 'ok') } // รูปที่พนักงานเพิ่งส่ง (โหมดจำลอง)
  if (props.a.failed || !props.a.path) return (state.value = 'error')
  state.value = 'loading'
  try {
    url.value = await chatMediaUrl(props.a.path)
    state.value = url.value ? 'ok' : 'error'
  } catch {
    state.value = 'error'
  }
}
onMounted(load)
watch(() => props.a.path, load)
const isImg = () => props.a.type === 'image' || props.a.sticker
</script>

<template>
  <div class="mb-1 last:mb-0">
    <p v-if="state === 'error'" class="rounded-lg bg-stone-100 px-2 py-1.5 text-xs text-stone-500">{{ attachLabel(a) }}: โหลดไม่ได้{{ a.failed ? ' (ระบบเก็บสำเนาไม่สำเร็จ)' : '' }}</p>
    <p v-else-if="state === 'loading'" class="rounded-lg bg-stone-100 px-2 py-1.5 text-xs text-stone-400">กำลังโหลด{{ attachLabel(a) }}…</p>
    <template v-else>
      <button v-if="isImg()" type="button" class="block" :aria-label="`ดู${attachLabel(a)}ขนาดใหญ่`" @click="big = true">
        <img :src="url" :alt="attachLabel(a)" class="rounded-lg object-cover" :class="a.sticker ? 'max-h-32 max-w-32' : 'max-h-60 max-w-full'" loading="lazy" @error="state = 'error'" />
      </button>
      <video v-else-if="a.type === 'video'" :src="url" controls preload="metadata" class="max-h-60 max-w-full rounded-lg" />
      <audio v-else-if="a.type === 'audio'" :src="url" controls preload="none" class="max-w-full" />
      <a v-else :href="url" target="_blank" rel="noopener" download class="inline-flex items-center gap-1 rounded-lg border border-stone-200 bg-stone-50 px-2 py-1.5 text-xs font-medium text-brand-800 underline">{{ a.name || 'ไฟล์แนบ' }}</a>
    </template>
    <div v-if="big" class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" role="dialog" aria-label="รูปขนาดใหญ่" @click="big = false">
      <img :src="url" :alt="attachLabel(a)" class="max-h-full max-w-full rounded-lg" />
    </div>
  </div>
</template>
