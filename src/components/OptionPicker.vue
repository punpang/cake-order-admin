<script setup>
import { money } from '../lib/format'

defineProps({ groups: { type: Array, required: true }, errors: { type: Object, default: () => ({}) } })
const selections = defineModel({ type: Object, required: true })

function priceText(o) {
  if (!o.price) return ''
  return o.priceType === 'per_pound' ? `+${money(o.price)}/ปอนด์` : (o.pounds ? money(o.price) : `+${money(o.price)}`)
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
  <div class="space-y-4">
    <div v-for="g in groups" :key="g.id">
      <div class="label">
        {{ g.name }}
        <span v-if="g.required" class="text-rose-500">*</span>
        <span v-if="g.type === 'multi'" class="font-normal text-stone-400">(เลือกได้หลายอย่าง)</span>
      </div>

      <input
        v-if="g.type === 'text'"
        v-model="selections[g.id]"
        class="input"
        :placeholder="g.placeholder || ''"
      />

      <div v-else class="flex flex-wrap gap-2">
        <button
          v-for="o in g.options"
          :key="o.id"
          type="button"
          class="rounded-lg border px-3 py-1.5 text-sm transition"
          :class="isOn(g, o) ? 'border-rose-400 bg-rose-50 text-rose-700' : 'border-stone-300 bg-white hover:bg-stone-50'"
          @click="g.type === 'multi' ? toggle(g.id, o.id) : pick(g.id, o.id, g.required)"
        >
          {{ o.name }}
          <span v-if="priceText(o)" class="ml-1 text-xs text-stone-500">{{ priceText(o) }}</span>
        </button>
      </div>
      <p v-if="errors[g.id]" class="mt-1 text-sm text-rose-600">{{ errors[g.id] }}</p>
    </div>
  </div>
</template>
