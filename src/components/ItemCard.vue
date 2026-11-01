<script setup>
import { computed } from 'vue'
import { db } from '../data/store'
import { describeSelections } from '../lib/pricing'
import { money } from '../lib/format'

const props = defineProps({ item: { type: Object, required: true } })
const details = computed(() => describeSelections(props.item, db.optionGroups))
</script>

<template>
  <div class="rounded-lg border border-stone-200 p-3">
    <div class="flex items-start justify-between gap-2">
      <div>
        <div class="font-medium">
          {{ item.name }}
          <span class="ml-1 rounded bg-stone-100 px-1.5 py-0.5 text-xs font-normal text-stone-600">{{ item.kind === 'custom' ? 'สั่งทำ' : 'สำเร็จ' }}</span>
        </div>
        <div class="text-sm text-stone-500">{{ item.qty }} × {{ money(item.unitPrice) }}</div>
      </div>
      <div class="whitespace-nowrap font-semibold">{{ money(item.unitPrice * item.qty) }}</div>
    </div>
    <dl v-if="details.length" class="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
      <template v-for="d in details" :key="d.group">
        <dt class="text-stone-500">{{ d.group }}</dt>
        <dd>{{ d.value }}</dd>
      </template>
    </dl>
    <p v-if="item.note" class="mt-1 text-sm"><span class="text-stone-500">หมายเหตุ</span> {{ item.note }}</p>
    <div v-if="item.images?.length" class="mt-2 flex flex-wrap gap-2">
      <img v-for="src in item.images" :key="src" :src="src" class="h-16 w-16 rounded-lg object-cover" />
    </div>
    <div v-if="$slots.default" class="mt-2 flex justify-end gap-2">
      <slot />
    </div>
  </div>
</template>
