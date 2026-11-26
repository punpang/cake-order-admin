<script setup>
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { resolveShortLink } from '../../data/store'
import { supabaseEnabled, getSupabase } from '../../lib/supabase'
import AppIcon from '../../components/AppIcon.vue'

// #/s/:code → ลิงก์ภายใน (router) หรือภายนอกที่อนุญาต (https)
// โหมด Supabase: เซิร์ฟเวอร์ (RPC punpang_resolve_short_link) ตรวจ allowlist/วันหมดอายุ/นับคลิกให้ ผู้เยี่ยมชมไม่ต้องอ่านตารางลิงก์ย่อ
// โหมดจำลอง: ใช้ข้อมูลในเครื่องเหมือนเดิม
const route = useRoute()
const router = useRouter()
const error = ref('')
const NOT_VALID = 'ลิงก์ไม่ถูกต้องหรือหมดอายุ'
onMounted(async () => {
  let r
  if (supabaseEnabled) {
    try {
      const c = await getSupabase()
      const { data, error: e } = await c.rpc('punpang_resolve_short_link', { p_code: String(route.params.code ?? '').toLowerCase() })
      r = !e && data?.target ? { kind: data.kind, target: data.target } : { error: NOT_VALID }
    } catch { r = { error: NOT_VALID } }
  } else r = resolveShortLink(route.params.code)
  if (r.error) return (error.value = r.error)
  if (r.kind === 'internal') router.replace(r.target)
  else if (/^https:\/\//i.test(r.target)) window.location.replace(r.target)
  else error.value = NOT_VALID
})
</script>

<template>
  <div class="mx-auto max-w-md px-4 py-16 text-center">
    <template v-if="error">
      <AppIcon name="alert" :size="28" class="mx-auto text-stone-500" />
      <p class="mt-3 font-medium text-stone-700">{{ error }}</p>
      <RouterLink to="/" class="mt-3 inline-block text-sm text-brand-700 underline">กลับหน้าแรก</RouterLink>
    </template>
    <p v-else class="text-stone-500">กำลังพาไป…</p>
  </div>
</template>
