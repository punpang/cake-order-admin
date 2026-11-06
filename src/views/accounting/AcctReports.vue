<script setup>
import { computed, ref } from 'vue'
import { db } from '../../data/store'
import { reportTrialBalance, reportIncome, reportLedger } from '../../data/acct'
import { thisMonth, monthRange } from '../../lib/acct/period'
import { money, dateOnly, toDateStr } from '../../lib/format'

// รายงานแกน: งบทดลอง · งบกำไรขาดทุน · บัญชีแยกประเภท (งบอื่น/เปรียบเทียบ/ภาษี มาในรอบถัดไป)
const kind = ref('income')
const r0 = monthRange(thisMonth())
const from = ref(r0.from)
const to = ref(r0.to)
const asOf = ref(toDateStr(new Date()))
const acc = ref('1010')
const pl = computed(() => reportIncome(from.value, to.value))
const tb = computed(() => reportTrialBalance(asOf.value))
const lg = computed(() => reportLedger(acc.value, from.value, to.value))
const pct = (n, d) => (d ? `${Math.round((n / d) * 1000) / 10}%` : '-')
</script>

<template>
  <div class="space-y-3">
    <div class="flex gap-2"><button v-for="x in [{ v: 'income', l: 'กำไรขาดทุน' }, { v: 'tb', l: 'งบทดลอง' }, { v: 'ledger', l: 'แยกประเภท' }]" :key="x.v" class="chip" :class="kind === x.v ? 'chip-on' : 'chip-off'" @click="kind = x.v">{{ x.l }}</button></div>
    <div v-if="kind !== 'tb'" class="grid grid-cols-2 gap-2"><div><label class="label">ตั้งแต่</label><input v-model="from" type="date" class="input h-10" aria-label="รายงานจากวันที่" /></div><div><label class="label">ถึง</label><input v-model="to" type="date" class="input h-10" aria-label="รายงานถึงวันที่" /></div></div>
    <div v-else><label class="label">ณ วันที่</label><input v-model="asOf" type="date" class="input h-10" aria-label="ณ วันที่" /></div>

    <section v-if="kind === 'income'" class="card text-sm" aria-label="งบกำไรขาดทุน">
      <div class="card-title">งบกำไรขาดทุน <span class="text-xs font-normal text-stone-400">{{ dateOnly(pl.from) }} – {{ dateOnly(pl.to) }}</span></div>
      <div class="font-semibold text-stone-800">รายได้</div>
      <div v-for="r in pl.revenue" :key="r.account.id" class="flex justify-between py-0.5 pl-3"><span>{{ r.account.name }}</span><span>{{ money(r.amount) }}</span></div>
      <div class="flex justify-between border-t border-stone-100 py-1 font-semibold"><span>รวมรายได้</span><span>{{ money(pl.revenueTotal) }}</span></div>
      <div class="mt-2 font-semibold text-stone-800">ต้นทุนขาย</div>
      <div v-for="r in pl.cogs" :key="r.account.id" class="flex justify-between py-0.5 pl-3"><span>{{ r.account.name }}</span><span>{{ money(r.amount) }}</span></div>
      <div class="flex justify-between border-t border-stone-100 py-1 font-semibold"><span>กำไรขั้นต้น <span class="font-normal text-stone-400">({{ pct(pl.grossProfit, pl.revenueTotal) }})</span></span><span>{{ money(pl.grossProfit) }}</span></div>
      <div class="mt-2 font-semibold text-stone-800">ค่าใช้จ่าย</div>
      <div v-for="r in pl.opex" :key="r.account.id" class="flex justify-between py-0.5 pl-3"><span>{{ r.account.name }}</span><span>{{ money(r.amount) }}</span></div>
      <div class="flex justify-between border-t border-stone-100 py-1 font-semibold"><span>รวมค่าใช้จ่าย</span><span>{{ money(pl.opexTotal) }}</span></div>
      <div class="mt-2 flex justify-between rounded-xl p-3 text-base font-bold" :class="pl.netProfit < 0 ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-800'"><span>กำไร (ขาดทุน) สุทธิ <span class="text-xs font-normal">({{ pct(pl.netProfit, pl.revenueTotal) }})</span></span><span>{{ money(pl.netProfit) }}</span></div>
    </section>

    <section v-else-if="kind === 'tb'" class="card text-sm" aria-label="งบทดลอง">
      <div class="card-title">งบทดลอง ณ {{ dateOnly(asOf) }}</div>
      <div class="grid grid-cols-[3rem_1fr_5.5rem_5.5rem] gap-x-2 border-b border-stone-200 pb-1 text-xs font-semibold text-stone-500"><span>รหัส</span><span>ชื่อบัญชี</span><span class="text-right">เดบิต</span><span class="text-right">เครดิต</span></div>
      <div v-for="r in tb.rows" :key="r.account.id" class="grid grid-cols-[3rem_1fr_5.5rem_5.5rem] gap-x-2 py-1"><span class="text-stone-500">{{ r.account.id }}</span><span class="min-w-0 break-words">{{ r.account.name }}</span><span class="text-right tabular-nums">{{ r.debit ? money(r.debit) : '' }}</span><span class="text-right tabular-nums">{{ r.credit ? money(r.credit) : '' }}</span></div>
      <div class="mt-1 grid grid-cols-[3rem_1fr_5.5rem_5.5rem] gap-x-2 border-t border-stone-200 pt-1 font-semibold"><span /><span>รวม</span><span class="text-right tabular-nums" aria-label="รวมเดบิต">{{ money(tb.debit) }}</span><span class="text-right tabular-nums" aria-label="รวมเครดิต">{{ money(tb.credit) }}</span></div>
      <p class="mt-2 text-xs" :class="tb.debit === tb.credit ? 'text-emerald-700' : 'text-rose-600'">{{ tb.debit === tb.credit ? 'งบทดลองสมดุล' : 'งบทดลองไม่สมดุล!' }}</p>
    </section>

    <section v-else class="card text-sm" aria-label="บัญชีแยกประเภท">
      <label class="label">บัญชี</label>
      <select v-model="acc" class="input mb-3" aria-label="เลือกบัญชี"><option v-for="a in db.acct.accounts" :key="a.id" :value="a.id">{{ a.id }} {{ a.name }}</option></select>
      <div v-if="lg">
        <div class="flex justify-between text-stone-600"><span>ยอดยกมา</span><b>{{ money(lg.opening) }}</b></div>
        <div v-for="(r, i) in lg.rows" :key="i" class="flex items-start justify-between gap-2 border-t border-stone-100 py-1.5"><span class="min-w-0"><span class="block break-words">{{ r.entry.memo || r.entry.no }}</span><span class="block text-xs text-stone-400">{{ dateOnly(r.entry.date) }}</span></span><span class="shrink-0 text-right text-xs"><span v-if="r.dr" class="block">Dr {{ money(r.dr) }}</span><span v-if="r.cr" class="block">Cr {{ money(r.cr) }}</span><b class="block text-sm">{{ money(r.balance) }}</b></span></div>
        <div class="mt-1 flex justify-between border-t border-stone-200 pt-1 font-semibold"><span>ยอดคงเหลือ</span><span>{{ money(lg.closing) }}</span></div>
      </div>
    </section>
  </div>
</template>
