<script setup>
// แสดงรูปส่วนตัว: อ้างอิง sb://bucket/path → ลิงก์ชั่วคราวจาก Supabase · ค่าอื่น (data:/blob:/https) แสดงตามเดิม
// link = กดที่รูปแล้วขยายเต็มจอในหน้าเดิม (ปิดด้วยคลิกพื้นหลัง/ปุ่ม ×/Esc) · class ของคอมโพเนนต์ใช้กับตัวครอบ · imgClass ใช้กับรูป
import { ref, watch, onBeforeUnmount } from 'vue'
import { parseRef, signedUrlFor } from '../lib/storage'
import { getSupabase } from '../lib/supabase'
const props = defineProps({ src: { type: String, default: '' }, alt: { type: String, default: '' }, link: Boolean, imgClass: { type: String, default: '' } })
const url = ref('')
const failed = ref(false)
const open = ref(false)
const onKey = (e) => { if (e.key === 'Escape') close() }
function show() { open.value = true; window.addEventListener('keydown', onKey) }
function close() { open.value = false; window.removeEventListener('keydown', onKey) }
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
watch(() => props.src, async (s) => {
  failed.value = false
  if (!parseRef(s)) { url.value = s || ''; return }
  url.value = ''
  const c = await getSupabase()
  const u = c ? await signedUrlFor(c, s) : null
  if (props.src !== s) return
  if (u) url.value = u
  else failed.value = true
}, { immediate: true })
</script>

<template>
  <template v-if="link && url">
    <button type="button" class="cursor-zoom-in text-left" :aria-label="`ขยายรูป ${alt}`" @click="show"><img :src="url" :alt="alt" :class="imgClass" /></button>
    <Teleport v-if="open" to="body">
      <div class="fixed inset-0 z-[100] flex cursor-zoom-out items-center justify-center bg-black/85 p-3" role="dialog" aria-modal="true" data-lightbox @click="close">
        <img :src="url" :alt="alt" class="max-h-[92vh] max-w-[96vw] rounded-lg object-contain" />
        <button type="button" class="absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-full bg-white text-xl text-stone-900" aria-label="ปิด" @click.stop="close">×</button>
      </div>
    </Teleport>
  </template>
  <img v-else-if="url" :src="url" :alt="alt" />
  <span v-else class="text-xs text-stone-400">{{ failed ? 'โหลดรูปไม่ได้' : '' }}</span>
</template>
