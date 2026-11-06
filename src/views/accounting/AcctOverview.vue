<script setup>
import { computed, ref } from 'vue'
import { db } from '../../data/store'
import { allEntries, reportIncome, cashPosition, sourceLabel, accountOf, acctAlerts } from '../../data/acct'
import { thisMonth, monthRange, addMonths, monthLabel } from '../../lib/acct/period'
import { entrySums } from '../../lib/acct/journal'
import { money, dateOnly } from '../../lib/format'
import AppIcon from '../../components/AppIcon.vue'

defineEmits(['go'])
const ym = ref(thisMonth())
const range = computed(() => monthRange(ym.value))
const pl = computed(() => reportIncome(range.value.from, range.value.to))
const cash = computed(() => cashPosition(range.value.to))
const points = computed(() => pl.value.opex.find((r) => r.account.id === '5410')?.amount || 0)
const recent = computed(() => allEntries().slice().reverse().slice(0, 6))
const cards = computed(() => [
  { l: 'รายได้', v: pl.value.revenueTotal, cls: 'text-stone-900' },
  { l: 'ต้นทุนขาย + ค่าใช้จ่าย', v: pl.value.cogsTotal + pl.value.opexTotal, cls: 'text-stone-900' },
  { l: 'กำไร (ขาดทุน) สุทธิ', v: pl.value.netProfit, cls: pl.value.netProfit < 0 ? 'text-rose-600' : 'text-emerald-700' },
  { l: 'เงินสด + ธนาคาร (สิ้นเดือน)', v: cash.value.total, cls: 'text-stone-900' },
])
const alerts = computed(() => acctAlerts())
const total = (e) => entrySums(e).dr / 100
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between gap-2">
      <button class="btn-outline h-10 px-3" aria-label="เดือนก่อน" @click="ym = addMonths(ym, -1)">‹</button>
      <div class="text-center"><div class="font-semibold text-stone-900">{{ monthLabel(ym) }}</div><div class="text-xs text-stone-500">{{ dateOnly(range.from) }} – {{ dateOnly(range.to) }}</div></div>
      <button class="btn-outline h-10 px-3" aria-label="เดือนถัดไป" @click="ym = addMonths(ym, 1)">›</button>
    </div>
    <div class="grid grid-cols-2 gap-3">
      <div v-for="c in cards" :key="c.l" class="card"><div class="text-xs text-stone-500">{{ c.l }}</div><div class="mt-1 text-lg font-semibold" :class="c.cls">{{ money(c.v) }}</div></div>
    </div>
    <button v-if="alerts.recurring.length || alerts.installments.length" type="button" class="w-full rounded-2xl bg-amber-50 p-3 text-left text-sm text-amber-800" aria-label="แจ้งเตือนค่าใช้จ่ายประจำ" @click="$emit('go', 'plan')"><AppIcon name="alert" :size="14" class="mr-1 inline" /> <template v-if="alerts.recurring.length">ค่าใช้จ่ายประจำที่อาจยังไม่ได้บันทึก {{ alerts.recurring.length }} รายการ ({{ alerts.recurring.map((r) => r.t.name).join(', ') }}) </template><template v-if="alerts.installments.length">· งวดผ่อนใกล้/เลยกำหนด {{ alerts.installments.length }} รายการ</template></button>
    <div v-if="points" class="card text-sm text-stone-600">ค่าใช้จ่ายจากการใช้คะแนนสะสมเดือนนี้ <b class="text-stone-900">{{ money(points) }}</b></div>
    <div v-if="db.acct.closedThrough" class="rounded-2xl bg-indigo-50 p-3 text-sm text-indigo-800"><AppIcon name="lock" :size="14" class="mr-1 inline" /> ปิดงวดถึง {{ dateOnly(db.acct.closedThrough) }} · รายการถึงวันนั้นแก้ไม่ได้</div>
    <section class="card">
      <div class="mb-2 flex items-center justify-between"><div class="card-title mb-0">รายการล่าสุด</div><button class="text-sm text-brand-700 underline" @click="$emit('go', 'journal')">สมุดรายวัน</button></div>
      <p v-if="!recent.length" class="py-4 text-center text-sm text-stone-500">ยังไม่มีรายการ</p>
      <ul v-else class="divide-y divide-stone-100 text-sm">
        <li v-for="e in recent" :key="e.id" class="flex items-start justify-between gap-2 py-2">
          <span class="min-w-0"><span class="block truncate text-stone-800">{{ e.memo || sourceLabel(e) }}</span><span class="block text-xs text-stone-400">{{ dateOnly(e.date) }} · {{ e.auto ? 'อัตโนมัติ' : e.no }}</span></span>
          <b class="shrink-0 text-stone-700">{{ money(total(e)) }}</b>
        </li>
      </ul>
    </section>
    <div class="flex gap-2"><button class="btn-primary flex-1" @click="$emit('go', 'record')"><AppIcon name="plus" :size="16" /> บันทึกรายการ</button><button class="btn-soft flex-1" @click="$emit('go', 'reports')">ดูรายงาน</button></div>
  </div>
</template>
