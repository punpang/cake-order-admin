<script setup>
// แสดงรูปส่วนตัว: อ้างอิง sb://bucket/path → ลิงก์ชั่วคราวจาก Supabase · ค่าอื่น (data:/blob:/https) แสดงตามเดิม
// link = ครอบด้วยลิงก์เปิดรูปใหญ่ในแท็บใหม่ (class ของคอมโพเนนต์ใช้กับลิงก์ · imgClass ใช้กับรูป)
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
  <a v-if="link && url" :href="url" target="_blank" rel="noopener"><img :src="url" :alt="alt" :class="imgClass" /></a>
  <img v-else-if="url" :src="url" :alt="alt" />
  <span v-else class="text-xs text-stone-400">{{ failed ? 'โหลดรูปไม่ได้' : '' }}</span>
</template>
