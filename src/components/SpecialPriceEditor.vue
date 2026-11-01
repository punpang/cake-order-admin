<script setup>
import { db } from '../data/store'

// v-model = { [priceListId]: ราคา } เว้นว่าง = ใช้ราคาปกติ
const special = defineModel({ type: Object, default: () => ({}) })
defineProps({ unit: { type: String, default: 'บาท' } })
</script>

<template>
  <div>
    <div class="label">ราคาพิเศษ</div>
    <p v-if="!db.priceLists.length" class="text-sm text-stone-500">
      ยังไม่มีแบบราคาพิเศษ <RouterLink to="/manage/pricing" class="text-brand-700 underline">ตั้งค่า</RouterLink>
    </p>
    <div v-else class="space-y-2">
      <div v-for="l in db.priceLists" :key="l.id" class="flex items-center gap-3">
        <span class="min-w-0 flex-1 truncate text-sm text-stone-700">
          {{ l.name }}
          <span v-if="l.active === false" class="text-xs text-stone-400">(ปิด)</span>
        </span>
        <input v-model="special[l.id]" type="number" inputmode="numeric" min="0" class="input w-32 shrink-0" :placeholder="unit" />
      </div>
      <p class="text-xs text-stone-400">เว้นว่าง = ใช้ราคาปกติ</p>
    </div>
  </div>
</template>
