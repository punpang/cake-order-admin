<script setup>
import { computed, ref, watch } from 'vue'
import { allEntries, sourceLabel, accountOf, needFrom } from '../../data/acct'
import { entrySums } from '../../lib/acct/journal'
import { thisMonth, monthRange } from '../../lib/acct/period'
import { money, dateOnly } from '../../lib/format'

// สมุดรายวัน: ทุกรายการ (บันทึกเอง + ดึงอัตโนมัติ) กรองช่วงวัน/ที่มา กางดูบรรทัดเดบิต-เครดิต
const r0 = monthRange(thisMonth())
const from = ref(r0.from)
const to = ref(r0.to)
watch(from, (v) => needFrom(v), { immediate: true }) // ดูช่วงก่อนรายละเอียดที่โหลดไว้ → ดึงเพิ่ม
const src = ref('all')
const q = ref('')
const rows = computed(() =>
  allEntries().filter((e) => (!from.value || e.date >= from.value) && (!to.value || e.date <= to.value) && (src.value === 'all' || (src.value === 'auto' ? e.auto || e.source?.type !== 'manual' : e.source?.type === 'manual')) && (!q.value.trim() || `${e.memo} ${e.no || ''} ${sourceLabel(e)}`.toLowerCase().includes(q.value.trim().toLowerCase()))),
)
const open = ref({})
const name = (id) => `${id} ${accountOf(id)?.name || ''}`
const total = (e) => entrySums(e).dr / 100
</script>

<template>
  <div class="space-y-3">
    <div class="grid grid-cols-2 gap-2"><div><label class="label">ตั้งแต่</label><input v-model="from" type="date" class="input h-10" aria-label="จากวันที่" /></div><div><label class="label">ถึง</label><input v-model="to" type="date" class="input h-10" aria-label="ถึงวันที่" /></div></div>
    <input v-model="q" type="search" class="input" placeholder="ค้นหา คำอธิบาย / เลขที่" aria-label="ค้นหารายการ" />
    <div class="flex gap-2"><button v-for="x in [{ v: 'all', l: 'ทั้งหมด' }, { v: 'auto', l: 'อัตโนมัติ' }, { v: 'manual', l: 'บันทึกเอง' }]" :key="x.v" class="chip" :class="src === x.v ? 'chip-on' : 'chip-off'" @click="src = x.v">{{ x.l }}</button></div>
    <p class="text-xs text-stone-500">{{ rows.length }} รายการ</p>
    <p v-if="!rows.length" class="card py-8 text-center text-sm text-stone-500">ไม่มีรายการในช่วงนี้</p>
    <ul class="space-y-2">
      <li v-for="e in rows" :key="e.id" class="card p-0 text-sm">
        <button type="button" class="flex w-full items-start justify-between gap-2 px-4 py-3 text-left" :aria-expanded="!!open[e.id]" @click="open[e.id] = !open[e.id]">
          <span class="min-w-0"><span class="block break-words font-medium text-stone-900">{{ e.memo || sourceLabel(e) }}</span><span class="block text-xs text-stone-500">{{ dateOnly(e.date) }} · {{ e.auto ? 'อัตโนมัติ · ' + sourceLabel(e) : (e.no || '') }}</span></span>
          <b class="shrink-0 text-stone-700">{{ money(total(e)) }}</b>
        </button>
        <div v-if="open[e.id]" class="border-t border-stone-100 px-4 py-2 text-xs">
          <div v-for="(l, i) in e.lines" :key="i" class="flex justify-between gap-2 py-0.5" :class="l.cr ? 'pl-4' : ''"><span class="min-w-0 break-words text-stone-700">{{ name(l.account) }}</span><span class="shrink-0 tabular-nums text-stone-600">{{ l.dr ? money(l.dr) : '' }}{{ l.cr ? money(l.cr) : '' }}</span></div>
        </div>
      </li>
    </ul>
  </div>
</template>
