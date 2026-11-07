<script setup>
import { computed, ref } from 'vue'
import { db, findCustomer, upcomingBirthdays, setGreeted } from '../data/store'
import { mdLabel } from '../lib/birthday'
import { formatPhone, phoneDigits } from '../lib/format'
import AppIcon from './AppIcon.vue'

// รายชื่อวันเกิดที่จะถึง (จากวันเกิดที่กรอกในออร์เดอร์) กด "ทักแล้ว" เพื่อซ่อน
const showGreeted = ref(false)
const all = computed(() => upcomingBirthdays().map((b) => ({ ...b, c: findCustomer(b.customerId) })))
const greetedCount = computed(() => all.value.filter((b) => b.greeted).length)
const list = computed(() => all.value.filter((b) => showGreeted.value || !b.greeted))
const when = (n) => (n === 0 ? 'วันนี้' : n === 1 ? 'พรุ่งนี้' : `อีก ${n} วัน`)

const copied = ref('')
async function copyLine(b) {
  try {
    await navigator.clipboard.writeText(b.c.line)
    copied.value = b.c.line
    setTimeout(() => (copied.value = ''), 1500)
  } catch {
    copied.value = ''
  }
}
</script>

<template>
  <div>
    <p class="mb-3 text-sm text-stone-500">วันเกิดภายใน {{ db.shop.birthdayDays }} วัน · จากวันเกิดที่กรอกในออร์เดอร์</p>
    <p v-if="!list.length" class="rounded-xl bg-stone-50 p-4 text-center text-sm text-stone-500">ไม่มีวันเกิดที่ต้องทัก</p>
    <ul class="space-y-2">
      <li v-for="b in list" :key="b.customerId + b.name + b.md" class="rounded-xl border border-stone-200/70 p-3" :class="b.greeted ? 'opacity-60' : ''">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <div class="font-semibold break-words text-stone-900">{{ b.name || 'ไม่ระบุชื่อ' }} <span class="font-normal text-stone-500">· {{ mdLabel(b.md) }}</span></div>
            <div class="text-sm break-words text-stone-600">ลูกค้า {{ b.c?.name }}<span v-if="b.c?.phone"> · {{ formatPhone(b.c.phone) }}</span></div>
            <RouterLink :to="`/admin/orders/${b.order.id}`" class="text-xs text-brand-700 underline">ล่าสุด {{ b.order.code }}</RouterLink>
          </div>
          <span class="shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold" :class="b.inDays <= 3 ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700'">{{ when(b.inDays) }}</span>
        </div>
        <div class="mt-2.5 flex flex-wrap gap-2">
          <a v-if="b.c?.phone" :href="`tel:${phoneDigits(b.c.phone)}`" class="btn-outline h-9 px-3"><AppIcon name="phone" :size="16" /> โทร</a>
          <button v-if="b.c?.line" type="button" class="btn-outline h-9 px-3" @click="copyLine(b)">{{ copied === b.c.line ? 'คัดลอกแล้ว' : `คัดลอก LINE ${b.c.line}` }}</button>
          <button type="button" class="h-9 px-3" :class="b.greeted ? 'btn-outline' : 'btn-soft'" @click="setGreeted(b, !b.greeted)">
            <AppIcon :name="b.greeted ? 'x' : 'check'" :size="16" /> {{ b.greeted ? 'ยังไม่ได้ทัก' : 'ทักแล้ว' }}
          </button>
        </div>
      </li>
    </ul>
    <button v-if="greetedCount" type="button" class="mt-3 text-sm text-stone-500 underline" @click="showGreeted = !showGreeted">
      {{ showGreeted ? 'ซ่อนที่ทักแล้ว' : `แสดงที่ทักแล้ว (${greetedCount})` }}
    </button>
  </div>
</template>
