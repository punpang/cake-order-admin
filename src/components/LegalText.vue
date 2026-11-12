<script setup>
import { computed } from 'vue'
import { db, legalVars } from '../data/store'
import { fillLegal, parseLegal } from '../lib/legalDefaults'

// แสดงข้อความกฎหมาย (ไม่ใช้ v-html) · mark = ไฮไลต์ช่องที่ยังไม่ได้กรอก (หน้าแอดมิน)
// level = ระดับหัวข้อของหัวข้อย่อยในเอกสาร (หน้าเอกสารที่มี h1 เป็นชื่อเอกสารใช้ 2 · ที่ฝังใต้หัวข้ออื่นใช้ 3) ให้ลำดับหัวข้อของหน้าไม่ข้ามขั้น
const props = defineProps({ kind: { type: String, default: '' }, text: { type: String, default: '' }, mark: { type: Boolean, default: false }, level: { type: Number, default: 3 } })
const filled = computed(() => fillLegal(props.kind ? db.legal.docs[props.kind]?.text : props.text, legalVars(), props.mark))
const blocks = computed(() => parseLegal(filled.value.text))
defineExpose({ missing: computed(() => filled.value.missing) })
const parts = (s) => s.split(/(【[^】]+】)/).filter(Boolean)
</script>

<template>
  <div class="space-y-2 text-sm leading-relaxed text-stone-700">
    <template v-for="(b, i) in blocks" :key="i">
      <component :is="`h${level === 2 ? 2 : 3}`" v-if="b.t === 'h'" class="pt-3 text-base font-semibold text-stone-900">{{ b.s }}</component>
      <ul v-else-if="b.t === 'ul'" class="list-disc space-y-1 pl-5">
        <li v-for="(it, j) in b.items" :key="j"><template v-for="(p, k) in parts(it)" :key="k"><mark v-if="p.startsWith('【')" class="rounded bg-amber-100 px-1">{{ p }}</mark><template v-else>{{ p }}</template></template></li>
      </ul>
      <p v-else class="break-words"><template v-for="(p, k) in parts(b.s)" :key="k"><mark v-if="p.startsWith('【')" class="rounded bg-amber-100 px-1">{{ p }}</mark><template v-else>{{ p }}</template></template></p>
    </template>
  </div>
</template>
