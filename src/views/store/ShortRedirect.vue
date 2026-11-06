<script setup>
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { resolveShortLink } from '../../data/store'
import AppIcon from '../../components/AppIcon.vue'

// #/s/:code → ลิงก์ภายใน (router) หรือภายนอกที่อนุญาต (https)
const route = useRoute()
const router = useRouter()
const error = ref('')
onMounted(() => {
  const r = resolveShortLink(route.params.code)
  if (r.error) return (error.value = r.error)
  if (r.kind === 'internal') router.replace(r.target)
  else window.location.replace(r.target)
})
</script>

<template>
  <div class="mx-auto max-w-md px-4 py-16 text-center">
    <template v-if="error">
      <AppIcon name="alert" :size="28" class="mx-auto text-stone-300" />
      <p class="mt-3 font-medium text-stone-700">{{ error }}</p>
      <RouterLink to="/" class="mt-3 inline-block text-sm text-brand-700 underline">กลับหน้าแรก</RouterLink>
    </template>
    <p v-else class="text-stone-400">กำลังพาไป…</p>
  </div>
</template>
