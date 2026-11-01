<script setup>
import { computed } from 'vue'
import { db } from '../data/store'
import { describeSelections } from '../lib/pricing'
import { money } from '../lib/format'
import AppIcon from './AppIcon.vue'

const props = defineProps({ item: { type: Object, required: true } })
const details = computed(() => describeSelections(props.item, db.optionGroups))
</script>

<template>
  <div class="rounded-2xl border border-stone-200/70 bg-white p-3.5">
    <div class="flex items-start gap-3">
      <div class="hidden h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600 sm:flex">
        <AppIcon name="cake" :size="22" />
      </div>
      <div class="min-w-0 flex-1">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <div class="font-semibold break-words text-stone-900">{{ item.name }}</div>
            <div class="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-stone-500">
              <span class="rounded-md bg-stone-100 px-1.5 py-0.5 text-xs font-medium text-stone-600">{{ item.kind === 'custom' ? 'สั่งทำ' : 'สำเร็จ' }}</span>
              <span>{{ item.qty }} × {{ money(item.unitPrice) }}</span>
              <span v-if="item.specials?.length && item.regularPrice !== item.unitPrice" class="text-xs text-stone-400 line-through">{{ money(item.regularPrice) }}</span>
              <span v-if="item.specials?.length" class="rounded-md bg-rose-50 px-1.5 py-0.5 text-xs font-medium text-rose-600">{{ item.specials.join(', ') }}</span>
            </div>
          </div>
          <div class="shrink-0 font-semibold text-stone-900">{{ money(item.unitPrice * item.qty) }}</div>
        </div>

        <dl v-if="details.length" class="mt-3 space-y-1.5 rounded-xl bg-stone-50 p-3 text-sm">
          <div v-for="d in details" :key="d.group" class="flex gap-3">
            <dt class="w-24 shrink-0 text-stone-500">{{ d.group }}</dt>
            <dd class="min-w-0 flex-1 break-words text-stone-800">{{ d.value }}</dd>
          </div>
        </dl>

        <p v-if="item.note" class="mt-2 text-sm break-words text-stone-600">
          <span class="text-stone-400">หมายเหตุ ·</span> {{ item.note }}
        </p>

        <div v-if="item.images?.length" class="mt-3 flex gap-2 overflow-x-auto">
          <img v-for="src in item.images" :key="src" :src="src" class="h-16 w-16 shrink-0 rounded-xl object-cover" />
        </div>

        <div v-if="$slots.default" class="mt-3 flex justify-end gap-2 border-t border-stone-100 pt-3">
          <slot />
        </div>
      </div>
    </div>
  </div>
</template>
