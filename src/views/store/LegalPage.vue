<script setup>
import { computed } from 'vue'
import { db } from '../../data/store'
import { LEGAL_KINDS } from '../../lib/legalDefaults'
import { dateOnly } from '../../lib/format'
import LegalText from '../../components/LegalText.vue'

// หน้าสาธารณะ: /legal/privacy | /legal/terms | /legal/cookie
const props = defineProps({ kind: { type: String, required: true } })
const doc = computed(() => (LEGAL_KINDS[props.kind] ? db.legal.docs[props.kind] : null))
</script>

<template>
  <div class="mx-auto max-w-2xl px-4 pt-6">
    <div v-if="!doc" class="card py-12 text-center text-stone-500">ไม่พบเอกสาร <RouterLink to="/" class="text-brand-700 underline">กลับหน้าแรก</RouterLink></div>
    <article v-else class="card">
      <h1 class="text-xl font-semibold text-stone-900">{{ doc.title }}</h1>
      <p class="text-xs text-stone-400">เวอร์ชัน {{ doc.version }} · ปรับปรุงล่าสุด {{ dateOnly(doc.updatedAt) }}</p>
      <LegalText :kind="kind" class="mt-3" />
      <nav class="mt-6 flex flex-wrap gap-x-4 gap-y-1 border-t border-stone-100 pt-3 text-sm">
        <RouterLink v-for="(k, key) in LEGAL_KINDS" :key="key" :to="`/legal/${key}`" class="text-brand-700 underline">{{ k.short }}</RouterLink>
      </nav>
    </article>
  </div>
</template>
