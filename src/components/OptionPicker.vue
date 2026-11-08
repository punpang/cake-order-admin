<script setup>
import { money, num } from '../lib/format'
import { MAIN_KEYS } from '../lib/constants'
import { typePrice, typeSizePrice, flavorPrice, stylePrice, shapePrice, optionPrice, isFixed, forType, bundleTags } from '../lib/pricing'
import { computed } from 'vue'
import AppIcon from './AppIcon.vue'

const props = defineProps({
  groups: { type: Array, required: true },
  scopes: { type: Object, default: null }, // { tier:{typeId,sizeIds}, whole:{typeId,sizeIds} } ให้ป้ายใช้ขนาด/ประเภทตัวเดียวกับตัวคิดราคา
  allGroups: { type: Array, default: null }, // ทุกหัวข้อ (บันเดิ้ลข้ามหัวข้อ/ข้ามส่วนต้องรู้จักกลุ่มของอีกฝั่ง)
  errors: { type: Object, default: () => ({}) },
  active: { type: Array, default: () => [] }, // แบบราคาพิเศษที่ใช้งาน
  allow: { type: Function, default: null }, // (group, option) => เลือกได้ไหม (ตามประเภท)
  sizeIds: { type: Array, default: () => [] }, // ขนาดที่เลือก (ราคาตามขนาด)
  typeOpt: { type: Object, default: null }, // ประเภทที่เลือกในชั้นนี้ (ราคาขนาดขึ้นกับประเภท)
  bundles: { type: Array, default: () => [] }, // บันเดิ้ลตัวเลือก → ติดป้ายบนชิป
  context: { type: Object, default: () => ({}) }, // ตัวเลือกของอีกส่วน (ชั้น/ทั้งก้อน) ที่ใช้รวมตรวจบันเดิ้ลข้ามกลุ่ม
})
const selections = defineModel({ type: Object, required: true })

// ราคาเค้กหลัก: ประเภท = ราคาคงที่ (+ ราคาขนาดถ้าเลือกขนาดแล้ว), เนื้อเค้ก = คงที่, ขนาด = ราคาขนาดของประเภทที่เลือก
const isMain = (g) => MAIN_KEYS.includes(g.key)
function mainPrice(g, o, active) {
  if (g.key === 'type') return typePrice(o, active) + typeSizePrice(o, props.sizeIds[0], active)
  if (g.key === 'size') return props.typeOpt ? typeSizePrice(props.typeOpt, o.id, active) : null
  if (g.key === 'style') return stylePrice(o, active)
  if (g.key === 'shape') return shapePrice(o, active)
  return flavorPrice(o, active)
}
function priceText(g, o) {
  if (isMain(g)) {
    const v = mainPrice(g, o, props.active)
    if (v == null) return ''
    if (g.key === 'size') return money(v)
    return v ? `+${money(v)}` : ''
  }
  // ตัวเลือกรอง: ราคาตามประเภทของชั้น (คงที่ หรือ ตามขนาด)
  const tid = props.typeOpt?.id
  if (isFixed(o)) {
    const v = optionPrice(o, tid, [])
    return v ? `+${money(v)}` : ''
  }
  const any = [o.sizePrices, ...Object.values(o.typePrices || {})].some((m) => Object.values(m || {}).some((v) => Number(v)))
  if (!any) return ''
  if (!props.sizeIds.length) return 'ตามขนาด'
  const v = optionPrice(o, tid, props.sizeIds)
  return v ? `+${money(v)}` : ''
}
// ราคาปกติ (แสดงขีดฆ่า) เมื่อใช้ราคาพิเศษ
function regularText(g, o) {
  if (!isMain(g)) return ''
  const reg = mainPrice(g, o, [])
  if (reg == null || reg === mainPrice(g, o, props.active)) return ''
  return g.key === 'size' ? money(reg) : `+${money(reg)}`
}

function toggle(groupId, optionId) {
  const cur = Array.isArray(selections.value[groupId]) ? [...selections.value[groupId]] : []
  const i = cur.indexOf(optionId)
  if (i >= 0) cur.splice(i, 1)
  else cur.push(optionId)
  selections.value[groupId] = cur
}

function pick(groupId, optionId, required) {
  // กดซ้ำเพื่อยกเลิกได้ ถ้าไม่บังคับ
  if (selections.value[groupId] === optionId && !required) delete selections.value[groupId]
  else selections.value[groupId] = optionId
}

const tags = computed(() => bundleTags(props.bundles, props.allGroups || props.groups, { ...props.context, ...selections.value }, { typeId: props.typeOpt?.id || null, sizeIds: props.sizeIds, allow: props.allow, scopes: props.scopes }))
const tagOf = (g, o) => tags.value.get(`${g.id}:${o.id}`) || null
// ข้อความป้ายสั้น ๆ ให้กว้างไม่เกินชิป · ชุด: 🎁/เลือกตัวนี้/✓ + "ลด x฿" · ตัวเลือกเดียว: "ลดพิเศษ x฿"
const TAG_TEXT = { idle: '🎁', partner: 'ครบชุด', done: '✓' }
const tagText = (t) => (t.single ? `${t.state === 'done' ? '✓ ' : '🎁 '}ลดพิเศษ ${num(t.amount)}฿` : `${TAG_TEXT[t.state]} ลด ${num(t.amount)}฿`)
const isOn = (g, o) =>
  g.type === 'multi' ? (selections.value[g.id] || []).includes(o.id) : selections.value[g.id] === o.id
</script>

<template>
  <div class="space-y-3">
    <div
      v-for="g in groups.filter((x) => (x.key !== 'style' || x.options.some((o) => o.active !== false)) && (!allow || allow(x, null)))"
      :key="g.id"
      class="rounded-2xl border bg-white p-3.5"
      :class="errors[g.id] ? 'border-rose-300 ring-4 ring-rose-50' : 'border-stone-200/70'"
    >
      <div class="mb-2.5 flex flex-wrap items-baseline gap-x-2">
        <span class="text-sm font-semibold text-stone-800">{{ g.name }}</span>
        <span v-if="g.required" class="text-xs font-medium text-rose-500">จำเป็น</span>
        <span v-else-if="g.type === 'multi'" class="text-xs text-stone-400">เลือกได้หลายอย่าง</span>
      </div>

      <input
        v-if="g.type === 'text'"
        v-model="selections[g.id]"
        class="input"
        :placeholder="g.placeholder || ''"
      />

      <div v-else class="flex flex-wrap gap-2">
        <button
          v-for="o in g.options.filter((x) => (x.active !== false || isOn(g, x)) && (!allow || allow(g, x)) && (isMain(g) || forType(x, typeOpt?.id)))"
          :key="o.id"
          type="button"
          class="relative inline-flex max-w-full items-center gap-1.5 rounded-xl border px-3 py-2 text-left text-sm transition active:scale-[0.98]"
          :class="[isOn(g, o) ? 'border-brand-500 bg-brand-50 text-brand-800 ring-1 ring-brand-500' : (tagOf(g, o) ? (tagOf(g, o).state === 'partner' ? 'border-amber-500 bg-amber-50 text-stone-800 ring-2 ring-amber-300 motion-safe:animate-pulse' : 'border-dashed border-emerald-500 bg-emerald-50/50 text-stone-800') : 'border-stone-200 bg-white text-stone-700 hover:border-brand-300'), tagOf(g, o) ? 'pt-3' : '']"
          :title="tagOf(g, o) ? `${tagOf(g, o).single ? 'ลดพิเศษ' : 'บันเดิ้ล'}: ${tagOf(g, o).names.join(', ')}` : null"
          :data-bundle-tag="tagOf(g, o)?.state || null"
          @click="g.type === 'multi' ? toggle(g.id, o.id) : pick(g.id, o.id, g.required)"
        >
          <AppIcon v-if="isOn(g, o)" name="check" :size="14" class="text-brand-600" />
          <span v-if="tagOf(g, o)" class="pointer-events-none absolute -top-2.5 right-2 max-w-[calc(100%-0.75rem)] truncate rounded-full px-2 py-0.5 text-[11px] leading-tight font-bold whitespace-nowrap shadow-sm" :class="tagOf(g, o).state === 'partner' ? 'bg-amber-600 text-white' : tagOf(g, o).state === 'done' ? 'bg-emerald-700 text-white' : 'bg-emerald-600 text-white'">{{ tagText(tagOf(g, o)) }}</span>
          <span class="min-w-0 break-words">{{ o.name }}</span>
          <span v-if="regularText(g, o)" class="text-xs whitespace-nowrap text-stone-400 line-through">{{ regularText(g, o) }}</span>
          <span v-if="priceText(g, o)" class="text-xs whitespace-nowrap" :class="regularText(g, o) ? 'font-medium text-rose-600' : 'text-stone-500'">{{ priceText(g, o) }}</span>
        </button>
      </div>
      <p v-if="errors[g.id]" class="mt-2 text-sm text-rose-600">{{ errors[g.id] }}</p>
    </div>
  </div>
</template>
