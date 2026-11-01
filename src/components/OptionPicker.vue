<script setup>
import { money } from '../lib/format'
import { db } from '../data/store'
import { effectivePrice, sizePriceOf, sizePrice, levelPrice } from '../lib/pricing'
import AppIcon from './AppIcon.vue'

const props = defineProps({
  groups: { type: Array, required: true },
  errors: { type: Object, default: () => ({}) },
  active: { type: Array, default: () => [] }, // แบบราคาพิเศษที่ใช้งาน
  allow: { type: Function, default: null }, // (group, option) => เลือกได้ไหม (ตามหน้าเค้ก)
  sizeIds: { type: Array, default: () => [] }, // ขนาดที่เลือก (ราคาตัวเลือกแบบตามขนาด)
})
const selections = defineModel({ type: Object, required: true })

function fmt(o, price) {
  return o.priceType === 'per_pound' ? `+${money(price)}/ปอนด์` : `+${money(price)}`
}
const levelName = (id) => db.priceLevels.find((l) => l.id === id)?.name || ''
// ราคาเค้กหลัก: ขนาด = ราคาขนาด, หน้าเค้ก/เนื้อเค้ก = ระดับราคาตามขนาดของชั้น (ยังไม่เลือกขนาด แสดงชื่อระดับ)
function mainPrice(g, o, active) {
  if (g.key === 'size') return sizePrice(o, active)
  return levelPrice(db.priceLevels, o.level, props.sizeIds[0], active)
}
function priceText(g, o) {
  if (g.key === 'size') return money(mainPrice(g, o, props.active))
  if (g.key === 'face' || g.key === 'flavor') {
    if (!props.sizeIds.length) return levelName(o.level)
    const v = mainPrice(g, o, props.active)
    return v ? `+${money(v)}` : ''
  }
  if (o.priceType === 'per_size') return props.sizeIds.length ? `+${money(sizePriceOf(o, props.sizeIds))}` : 'ตามขนาด'
  const price = effectivePrice(o, props.active).price
  if (!price) return ''
  return fmt(o, price)
}
// ราคาปกติ (แสดงขีดฆ่า) เมื่อใช้ราคาพิเศษ
function regularText(g, o) {
  if (g.key === 'size' || ((g.key === 'face' || g.key === 'flavor') && props.sizeIds.length)) {
    const reg = mainPrice(g, o, [])
    if (reg === mainPrice(g, o, props.active)) return ''
    return g.key === 'size' ? money(reg) : `+${money(reg)}`
  }
  if (g.key === 'face' || g.key === 'flavor' || o.priceType === 'per_size') return ''
  const r = effectivePrice(o, props.active)
  return r.list && r.price !== (o.price || 0) && o.price ? fmt(o, o.price) : ''
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

const isOn = (g, o) =>
  g.type === 'multi' ? (selections.value[g.id] || []).includes(o.id) : selections.value[g.id] === o.id
</script>

<template>
  <div class="space-y-3">
    <div
      v-for="g in groups"
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
          v-for="o in g.options.filter((x) => (x.active !== false || isOn(g, x)) && (!allow || allow(g, x)))"
          :key="o.id"
          type="button"
          class="inline-flex max-w-full items-center gap-1.5 rounded-xl border px-3 py-2 text-left text-sm transition active:scale-[0.98]"
          :class="isOn(g, o) ? 'border-brand-500 bg-brand-50 text-brand-800 ring-1 ring-brand-500' : 'border-stone-200 bg-white text-stone-700 hover:border-brand-300'"
          @click="g.type === 'multi' ? toggle(g.id, o.id) : pick(g.id, o.id, g.required)"
        >
          <AppIcon v-if="isOn(g, o)" name="check" :size="14" class="text-brand-600" />
          <span class="min-w-0 break-words">{{ o.name }}</span>
          <span v-if="regularText(g, o)" class="text-xs whitespace-nowrap text-stone-400 line-through">{{ regularText(g, o) }}</span>
          <span v-if="priceText(g, o)" class="text-xs whitespace-nowrap" :class="regularText(g, o) ? 'font-medium text-rose-600' : 'text-stone-500'">{{ priceText(g, o) }}</span>
        </button>
      </div>
      <p v-if="errors[g.id]" class="mt-2 text-sm text-rose-600">{{ errors[g.id] }}</p>
    </div>
  </div>
</template>
