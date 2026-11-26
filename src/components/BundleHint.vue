<script setup>
import { computed } from 'vue'
import { bundleHints } from '../lib/pricing'
import { money } from '../lib/format'

// กล่องแนะนำบันเดิ้ล: เลือกตัวเลือกในบันเดิ้ลแล้วแต่ยังไม่ครบ → "เลือกเพิ่ม X ได้บันเดิ้ล ลด ฿Y" + ปุ่มเพิ่มให้
// scope: 'tier' = บันเดิ้ลที่มีกลุ่มแยกชั้น (ตรวจทีละชั้น) · 'whole' = บันเดิ้ลที่มีแต่กลุ่มทั้งก้อน (เหมือนตัวคิดราคา)
const props = defineProps({
  scope: { type: String, default: 'tier' },
  bundles: { type: Array, default: () => [] },
  groups: { type: Array, default: () => [] }, // กลุ่มตัวเลือกที่ใช้อยู่ทั้งหมด
  tierSels: { type: Object, default: null },
  wholeSels: { type: Object, default: () => ({}) },
  sizeIds: { type: Array, default: () => [] },
  typeId: { type: String, default: null },
  styleId: { type: String, default: null },
  allow: { type: Function, default: null },
})
const tierIds = computed(() => new Set(props.groups.filter((g) => g.perTier).map((g) => g.id)))
const scoped = computed(() => props.bundles.filter((b) => {
  const t = (b.items || []).some((x) => tierIds.value.has(x.groupId))
  return props.scope === 'tier' ? t : !t
}))
const hints = computed(() => bundleHints(scoped.value, props.groups, { ...props.wholeSels, ...(props.tierSels || {}) }, { typeId: props.typeId, sizeIds: props.sizeIds, styleId: props.styleId, allow: props.allow }))
function add(h) {
  for (const m of h.missing) {
    const g = props.groups.find((x) => x.id === m.groupId)
    const target = g?.perTier ? props.tierSels : props.wholeSels
    if (!target) continue
    if (g.type === 'multi') target[g.id] = [...new Set([...(Array.isArray(target[g.id]) ? target[g.id] : []), m.optionId])]
    else target[g.id] = m.optionId
  }
}
</script>

<template>
  <ul v-if="hints.length" class="mt-2 space-y-1.5" aria-label="แนะนำบันเดิ้ล" data-bundle-hints>
    <li v-for="h in hints" :key="h.bundle.id" class="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-info-50 px-3 py-2 text-sm text-info-800">
      <span class="min-w-0 flex-1 break-words">💡 เลือกเพิ่ม <b>{{ h.missing.map((m) => m.name).join(' + ') }}</b> <template v-if="h.tie">ครบชุด "{{ h.bundle.name }}" รวม <b>{{ money(h.setTotal) }}</b></template><template v-else>ได้บันเดิ้ล "{{ h.bundle.name }}" <b class="text-success-700">ลด {{ money(h.amount) }}</b></template></span>
      <button type="button" class="shrink-0 rounded-full bg-white px-3 py-1 text-xs font-semibold text-info-800 shadow-sm ring-1 ring-sky-200 hover:bg-info-100" data-bundle-add @click="add(h)">เพิ่มให้</button>
    </li>
  </ul>
</template>
