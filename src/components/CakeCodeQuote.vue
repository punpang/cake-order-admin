<script setup>
// ประเมินราคาจากรหัสเค้กสั่งทำที่ลูกค้าคัดลอกมา · ไม่บันทึกอะไร จนกว่าพนักงานจะกด "เพิ่มเข้าออร์เดอร์"
import { computed, ref } from 'vue'
import { db, activeListsAt } from '../data/store'
import { decodeCake, findCodes } from '../lib/cakeCode'
import { describeSelections } from '../lib/pricing'
import { money } from '../lib/format'
import AppIcon from './AppIcon.vue'

const props = defineProps({
  priceDate: { type: String, default: '' }, // วันที่ของออร์เดอร์ (ใช้เลือกราคาพิเศษเหมือนฟอร์มสินค้า)
})
const emit = defineEmits(['add'])

const text = ref('')
const result = ref(null) // null | { error } | { item, warnings, expected, extra }

const lines = computed(() => (result.value?.item ? describeSelections(result.value.item, db.optionGroups) : []))

function evaluate() {
  const codes = findCodes(text.value)
  if (!codes.length) return (result.value = { error: 'ไม่พบรหัสสินค้า (#CK1…) ในข้อความ' })
  const r = decodeCake(codes[0], {
    groups: db.optionGroups,
    products: db.retailItems,
    active: activeListsAt(props.priceDate),
    bundles: db.bundles,
  })
  result.value = { ...r, extra: codes.length > 1 }
}

function clear() {
  text.value = ''
  result.value = null
}

// ส่งรายการที่ประเมินแล้วให้หน้าออร์เดอร์ เปิดในฟอร์มสินค้า (ตรวจ/บันทึกตามขั้นตอนเดิม รวมความยินยอมข้อมูลแพ้อาหาร)
function addToOrder() {
  if (!result.value?.item) return
  emit('add', { ...result.value.item, images: [] })
  clear()
}
</script>

<template>
  <div class="card space-y-3">
    <div class="card-title"><AppIcon name="cake" class="text-brand-600" /> ประเมินราคาจากรหัสลูกค้า <span class="font-normal text-stone-400">(ยังไม่สร้างออร์เดอร์)</span></div>

    <div class="flex gap-2">
      <textarea v-model="text" rows="2" class="input min-w-0 flex-1 font-mono text-xs" placeholder="วางรหัส #CK1.…" aria-label="รหัสเค้กจากลูกค้า" @keydown.ctrl.enter="evaluate" @keydown.meta.enter="evaluate"></textarea>
      <button type="button" class="btn-soft self-start" :disabled="!text.trim()" @click="evaluate">ประเมิน</button>
    </div>

    <p v-if="result?.error" class="text-sm text-rose-700" role="alert">{{ result.error }}</p>

    <template v-else-if="result?.item">
      <div class="rounded-xl bg-stone-50 p-3">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="font-semibold text-stone-900">{{ result.item.name }}</div>
            <div class="text-xs text-stone-500">จำนวน {{ result.item.qty }} ชิ้น</div>
          </div>
          <div class="shrink-0 text-right">
            <div class="text-xs text-stone-500">ราคาตอนนี้ / ชิ้น</div>
            <div class="font-semibold text-stone-900">{{ money(result.item.unitPrice) }}</div>
            <div v-if="result.item.qty > 1" class="text-xs text-stone-500">รวม {{ money(result.item.unitPrice * result.item.qty) }}</div>
          </div>
        </div>
        <ul v-if="lines.length" class="mt-2 space-y-0.5 text-sm text-stone-600">
          <li v-for="(d, i) in lines" :key="i">{{ d.group }}: {{ d.value }}</li>
        </ul>
        <p v-if="result.item.note" class="mt-2 text-sm text-stone-600">หมายเหตุ: {{ result.item.note }}</p>
      </div>

      <p v-for="(w, i) in result.warnings" :key="i" class="text-sm text-amber-700">⚠ {{ w.text }}</p>
      <p v-if="result.extra" class="text-sm text-amber-700">⚠ พบมากกว่า 1 รหัส ประเมินเฉพาะรหัสแรก</p>

      <div class="flex flex-wrap justify-end gap-2">
        <button type="button" class="btn-outline" @click="clear">ล้าง</button>
        <button type="button" class="btn-primary" @click="addToOrder"><AppIcon name="plus" :size="16" /> เพิ่มเข้าออร์เดอร์</button>
      </div>
    </template>
  </div>
</template>
