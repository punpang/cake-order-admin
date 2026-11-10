<script setup>
// แสดงรูปส่วนตัว: อ้างอิง sb:// หรือ r2:// → ลิงก์ชั่วคราว · ค่าอื่น (data:/blob:/https) แสดงตามเดิม
// การแตะรูปขยายเต็มจอทำโดยกล่องกลางของแอป (lib/lightbox) ไม่ต้องตั้ง prop
import { ref, watch } from 'vue'
import { parseRef, signedUrlFor } from '../lib/storage'
import { getSupabase } from '../lib/supabase'
const props = defineProps({ src: { type: String, default: '' }, alt: { type: String, default: '' }, link: Boolean, imgClass: { type: String, default: '' } })
const url = ref('')
const failed = ref(false)
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
  <img v-if="url" :src="url" :alt="alt" :class="imgClass" class="cursor-zoom-in" />
  <span v-else class="text-xs text-stone-400">{{ failed ? 'โหลดรูปไม่ได้' : '' }}</span>
</template>
