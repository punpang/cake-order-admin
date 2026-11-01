<script setup>
import { computed } from 'vue'
import { db } from '../data/store'
import { RECIPE_PER } from '../lib/constants'
import AppIcon from './AppIcon.vue'
import { askConfirm } from '../lib/confirm'

// v-model = [{ ingredientId, qty, per: 'pound' | 'piece' }]
const recipe = defineModel({ type: Array, default: () => [] })

const choices = computed(() => db.ingredients.filter((m) => m.active !== false || recipe.value.some((x) => x.ingredientId === m.id)))
const unitOf = (id) => db.ingredients.find((m) => m.id === id)?.unit || ''

const add = () => recipe.value.push({ ingredientId: '', qty: 0, per: 'pound' })
async function remove(i) {
  const name = db.ingredients.find((m) => m.id === recipe.value[i].ingredientId)?.name || 'บรรทัดนี้'
  if (await askConfirm({ title: 'ลบบรรทัดสูตร', message: name, okText: 'ลบ', danger: true })) recipe.value.splice(i, 1)
}
</script>

<template>
  <div>
    <div class="label">สูตรวัตถุดิบ</div>
    <p v-if="!db.ingredients.length" class="text-sm text-stone-500">
      ยังไม่มีวัตถุดิบ <RouterLink to="/manage/ingredients" class="text-brand-700 underline">เพิ่มวัตถุดิบ</RouterLink>
    </p>
    <template v-else>
      <div class="space-y-2">
        <div v-for="(line, i) in recipe" :key="i" class="rounded-xl border border-stone-200 p-2.5">
          <div class="flex gap-2">
            <select v-model="line.ingredientId" class="input min-w-0 flex-1">
              <option value="" disabled>เลือกวัตถุดิบ</option>
              <option v-for="m in choices" :key="m.id" :value="m.id">{{ m.name }}{{ m.active === false ? ' (ปิดใช้งาน)' : '' }}</option>
            </select>
            <button type="button" class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-stone-400 hover:bg-rose-50 hover:text-rose-600" aria-label="ลบบรรทัด" @click="remove(i)">
              <AppIcon name="trash" :size="18" />
            </button>
          </div>
          <div class="mt-2 flex items-center gap-2">
            <input v-model.number="line.qty" type="number" inputmode="decimal" min="0" step="any" class="input w-28 shrink-0" />
            <span class="w-10 shrink-0 text-sm text-stone-500">{{ unitOf(line.ingredientId) }}</span>
            <div class="grid flex-1 grid-cols-2 gap-1 rounded-xl bg-stone-100 p-1">
              <button
                v-for="(label, key) in RECIPE_PER"
                :key="key"
                type="button"
                class="h-9 rounded-lg text-xs font-semibold transition"
                :class="line.per === key ? 'bg-white text-brand-700 shadow-sm' : 'text-stone-500'"
                @click="line.per = key"
              >{{ label }}</button>
            </div>
          </div>
        </div>
      </div>
      <button type="button" class="btn-soft mt-2 w-full" @click="add"><AppIcon name="plus" :size="16" /> เพิ่มวัตถุดิบ</button>
      <p class="mt-1 text-xs text-stone-400">ต่อปอนด์ = คูณขนาดเค้ก · ต่อชิ้น = ใช้เท่าเดิมทุกขนาด</p>
    </template>
  </div>
</template>
