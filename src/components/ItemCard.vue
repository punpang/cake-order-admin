<script setup>
import { computed } from 'vue'
import { db } from '../data/store'
import { tiersOf, isTierGroup, discountLines } from '../lib/pricing'
import { MAIN_KEYS } from '../lib/constants'
import { money } from '../lib/format'
import AppIcon from './AppIcon.vue'
import DiscountDetail from './DiscountDetail.vue'

const props = defineProps({ item: { type: Object, required: true } })

// ชื่อกลุ่มแบบสั้น: "On top / ท็อปปิ้ง" → "ท็อปปิ้ง"
const short = (name) => name.split('/').pop().trim()
const ids = (sel) => (sel == null ? [] : Array.isArray(sel) ? sel : [sel])
// ข้อความบนเค้ก = กลุ่มพิมพ์ข้อความที่ชื่อมีคำว่า "ข้อความ" (แสดงเด่นแยก)
const isMessage = (g) => g.type === 'text' && g.name.includes('ข้อความ')

// ชิปของชุดตัวเลือก (ไม่รวมกลุ่มหลักของสั่งทำ เพราะอยู่ในชื่อแล้ว และไม่รวมข้อความบนเค้ก)
function chipsOf(groups, sels) {
  const out = []
  for (const g of groups) {
    if (props.item.kind === 'custom' && MAIN_KEYS.includes(g.key)) continue
    if (isMessage(g)) continue
    const v = sels?.[g.id]
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) continue
    const value = g.type === 'text' ? v : ids(v).map((id) => g.options.find((o) => o.id === id)?.name).filter(Boolean).join(', ')
    if (value) out.push({ key: g.id, label: short(g.name), value })
  }
  return out
}

const tiers = computed(() => tiersOf(props.item))
const tierGroups = computed(() => db.optionGroups.filter((g) => isTierGroup(g, props.item)))
const wholeGroups = computed(() => db.optionGroups.filter((g) => !isTierGroup(g, props.item)))
// หลายชั้น: แยกชิปตามชั้น · ชั้นเดียว: รวมเป็นแถวเดียว
const tierChips = computed(() => tiers.value.map((t) => chipsOf(tierGroups.value, t.selections)))
const wholeChips = computed(() => chipsOf(wholeGroups.value, props.item.selections))
const allChips = computed(() => (tiers.value.length > 1 ? wholeChips.value : [...(tierChips.value[0] || []), ...wholeChips.value]))
const messages = computed(() =>
  db.optionGroups.filter((g) => isMessage(g) && props.item.selections?.[g.id]).map((g) => ({ key: g.id, text: props.item.selections[g.id] })),
)

// ราคาเต็ม (ไม่มีราคาพิเศษ/บันเดิ้ล) × จำนวน · รายการเก่าที่ไม่มี fullPrice = ราคาที่บันทึกไว้
const full = computed(() => (props.item.fullPrice ?? props.item.unitPrice) * props.item.qty)
const lines = computed(() => discountLines(props.item.discounts, props.item.qty))
</script>

<template>
  <div class="rounded-2xl border border-stone-200 bg-white p-4">
    <!-- หัว: ชื่อ + ราคา -->
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <div class="text-[15px] font-semibold break-words text-stone-900">{{ item.name }}</div>
        <div class="mt-1 flex flex-wrap items-center gap-2 text-sm text-stone-500">
          <span class="rounded-md bg-stone-100 px-1.5 py-0.5 text-xs font-medium text-stone-600">{{ item.kind === 'custom' ? 'สั่งทำ' : item.kind === 'retail' ? 'หน้าร้าน' : 'สำเร็จ' }}</span>
          <span v-if="item.qty > 1">{{ item.qty }} ชิ้น × {{ money(item.unitPrice) }}</span>
          <span v-if="item.mods?.length" class="text-brand-700">{{ item.mods.map((m) => m.name).join(' · ') }}</span>
        </div>
      </div>
      <DiscountDetail class="shrink-0" :full="full" :final="item.unitPrice * item.qty" :lines="lines" />
    </div>

    <!-- ข้อความบนเค้ก -->
    <div v-for="m in messages" :key="m.key" class="mt-3 rounded-xl bg-brand-50 px-3.5 py-2.5 text-base font-medium break-words text-brand-900">“{{ m.text }}”</div>

    <!-- ตัวเลือก (หลายชั้นแยกตามชั้น) -->
    <template v-if="tiers.length > 1">
      <div v-for="(chips, i) in tierChips" :key="i" class="mt-3">
        <div class="mb-1.5 text-xs font-semibold text-stone-500">ชั้นที่ {{ i + 1 }}</div>
        <div class="flex flex-wrap gap-1.5">
          <span v-for="c in chips" :key="c.key" class="inline-flex max-w-full items-baseline gap-1 rounded-lg bg-stone-100 px-2 py-1 text-sm">
            <span class="shrink-0 text-xs text-stone-500">{{ c.label }}</span>
            <span class="min-w-0 break-words text-stone-900">{{ c.value }}</span>
          </span>
          <span v-if="!chips.length" class="text-sm text-stone-400">-</span>
        </div>
      </div>
    </template>
    <div v-if="allChips.length" class="mt-3 flex flex-wrap gap-1.5">
      <span v-for="c in allChips" :key="c.key" class="inline-flex max-w-full items-baseline gap-1 rounded-lg bg-stone-100 px-2 py-1 text-sm">
        <span class="shrink-0 text-xs text-stone-500">{{ c.label }}</span>
        <span class="min-w-0 break-words text-stone-900">{{ c.value }}</span>
      </span>
    </div>

    <!-- หมายเหตุ -->
    <p v-if="item.note" class="mt-3 flex items-start gap-1.5 text-sm break-words text-stone-600">
      <AppIcon name="edit" :size="14" class="mt-0.5 shrink-0 text-stone-400" />
      <span class="min-w-0">{{ item.note }}</span>
    </p>

    <div v-if="item.images?.length" class="mt-3 flex gap-2 overflow-x-auto">
      <img v-for="src in item.images" :key="src" :src="src" class="h-16 w-16 shrink-0 rounded-xl object-cover" />
    </div>

    <div v-if="$slots.default" class="mt-3 flex justify-end gap-2 border-t border-stone-100 pt-3">
      <slot />
    </div>
  </div>
</template>
