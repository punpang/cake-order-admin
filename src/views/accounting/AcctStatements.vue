<script setup>
import { computed, ref } from 'vue'
import { db } from '../../data/store'
import { reportBalanceSheet, reportCashFlow, reportEquity, reportCompare, periodSummary, fiscalRange, fiscalStartOf, assets, assetSchedule, activeAccounts } from '../../data/acct'
import { thisMonth, monthRange, yearRange } from '../../lib/acct/period'
import { pctChange } from '../../lib/acct/statements'
import { downloadCsv } from '../../lib/acct/csv'
import { money, dateOnly, toDateStr } from '../../lib/format'
import AppIcon from '../../components/AppIcon.vue'
import A4Print from '../../components/A4Print.vue'

// รายงานประจำเดือน/ปี · เปรียบเทียบ · งบแสดงฐานะการเงิน · งบกระแสเงินสด · งบส่วนของเจ้าของ · หมายเหตุ
const props = defineProps({ kind: { type: String, required: true } })
const indiv = computed(() => db.acct.settings.entityType === 'individual')
const today = toDateStr(new Date())
const y0 = new Date().getFullYear()
const mode = ref('month')
const ym = ref(thisMonth())
const yr = ref(y0)
const range = computed(() => (mode.value === 'month' ? monthRange(ym.value) : yearRange(Number(yr.value)) ))
const sm = computed(() => periodSummary(range.value.from, range.value.to))
const cmpKind = ref('month')
const cmpQ = ref(Math.floor(new Date().getMonth() / 3) + 1)
const cmpRef = computed(() => (cmpKind.value === 'month' ? ym.value : cmpKind.value === 'quarter' ? { y: Number(yr.value), q: Number(cmpQ.value) } : Number(yr.value)))
const cmp = computed(() => reportCompare(cmpKind.value, cmpRef.value))
const asOf = ref(today)
const bs = computed(() => reportBalanceSheet(asOf.value))
const from = ref(fiscalStartOf(today))
const to = ref(today)
const cf = computed(() => reportCashFlow(from.value, to.value))
const eq = computed(() => reportEquity(from.value, to.value))
const printer = ref(null)
const pct = (c, b) => { const v = pctChange(c, b); return v == null ? '-' : `${v > 0 ? '+' : ''}${v}%` }
const cls = (c, b, good = 'up') => { const v = pctChange(c, b); if (v == null || v === 0) return 'text-stone-400'; return (v > 0) === (good === 'up') ? 'text-success-700' : 'text-danger-700' }
const barMax = computed(() => Math.max(1, ...cmp.value.totals.revenue.map(Math.abs), ...cmp.value.totals.netProfit.map(Math.abs)))
const notesAssets = computed(() => assets().map((a) => ({ a, accum: Math.round((a.cost - (assetSchedule(a).filter((r) => r.date <= asOf.value).at(-1)?.book ?? a.cost)) * 100) / 100 })))
const bsFy = computed(() => fiscalStartOf(asOf.value))

function csv() {
  const k = props.kind
  if (k === 'summary') {
    const p = sm.value.pl
    downloadCsv(`summary-${mode.value === 'month' ? ym.value : yr.value}.csv`, ['รายการ', 'จำนวนเงิน'], [['รายได้', p.revenueTotal], ['ต้นทุนขาย', p.cogsTotal], ['กำไรขั้นต้น', p.grossProfit], ...p.opex.map((r) => [r.account.name, r.amount]), ['รวมค่าใช้จ่าย', p.opexTotal], ['กำไรสุทธิ', p.netProfit], ['รับเงินสด', sm.value.receipts.cash], ['รับเงินธนาคาร', sm.value.receipts.bank], ['ภาษีขาย', sm.value.vat.output], ['ภาษีซื้อ', sm.value.vat.input]])
  } else if (k === 'compare') {
    const c = cmp.value
    const L = c.periods.map((p) => p.label)
    const rows = []
    for (const [t, key] of [['รายได้', 'revenue'], ['ต้นทุนขาย', 'cogs'], ['ค่าใช้จ่าย', 'opex']]) for (const r of c[key]) rows.push([t, r.account.name, ...r.amounts])
    for (const [t, key] of [['รวมรายได้', 'revenue'], ['รวมต้นทุนขาย', 'cogs'], ['กำไรขั้นต้น', 'grossProfit'], ['รวมค่าใช้จ่าย', 'opex'], ['กำไรสุทธิ', 'netProfit']]) rows.push([t, '', ...c.totals[key]])
    downloadCsv('compare.csv', ['หมวด', 'รายการ', ...L], rows)
  } else if (k === 'bs') {
    const b = bs.value
    const rows = [...b.currentAssets.map((r) => ['สินทรัพย์หมุนเวียน', r.account.name, r.amount]), ...b.fixedAssets.map((r) => ['สินทรัพย์ไม่หมุนเวียน', r.account.name, r.amount]), ['รวมสินทรัพย์', '', b.assets], ...b.currentLiabilities.map((r) => ['หนี้สินหมุนเวียน', r.account.name, r.amount]), ...b.longLiabilities.map((r) => ['หนี้สินระยะยาว', r.account.name, r.amount]), ['รวมหนี้สิน', '', b.liabilities], ...b.equityRows.map((r) => ['ส่วนของเจ้าของ', r.account.name, r.amount]), ['ส่วนของเจ้าของ', 'กำไรสะสมยกมา', b.retainedPrior], ['ส่วนของเจ้าของ', 'กำไร (ขาดทุน) ปีนี้', b.profitYear], ['รวมส่วนของเจ้าของ', '', b.equity], ['รวมหนี้สินและส่วนของเจ้าของ', '', b.liabilitiesEquity]]
    downloadCsv(`balance-sheet-${asOf.value}.csv`, ['หมวด', 'รายการ', 'จำนวนเงิน'], rows)
  } else if (k === 'cf') {
    const c = cf.value
    downloadCsv(`cash-flow-${from.value}_${to.value}.csv`, ['หมวด', 'รายการ', 'จำนวนเงิน'], [...c.operating.map((r) => ['ดำเนินงาน', r.label, r.amount]), ['ดำเนินงาน', 'รวม', c.totalOperating], ...c.investing.map((r) => ['ลงทุน', r.label, r.amount]), ['ลงทุน', 'รวม', c.totalInvesting], ...c.financing.map((r) => ['จัดหาเงิน', r.label, r.amount]), ['จัดหาเงิน', 'รวม', c.totalFinancing], ['เงินสดเพิ่มสุทธิ', '', c.netChange], ['เงินสดต้นงวด', '', c.opening], ['เงินสดปลายงวด', '', c.closing]])
  } else if (k === 'eq') {
    const e = eq.value
    downloadCsv(`equity-${from.value}_${to.value}.csv`, ['รายการ', 'จำนวนเงิน'], [['ยอดต้นงวด', e.opening], ['เพิ่มทุน', e.capital], ['กำไรสุทธิ', e.netIncome], ['ถอนใช้ส่วนตัว', e.draws], ['อื่น ๆ', e.other], ['ยอดปลายงวด', e.closing]])
  }
}
const titleOf = computed(() => ({ summary: indiv.value ? 'สรุปรายรับ-รายจ่าย' : 'สรุปรายได้-ค่าใช้จ่าย', compare: 'เปรียบเทียบรายได้/ค่าใช้จ่าย', bs: 'งบแสดงฐานะการเงิน', cf: 'งบกระแสเงินสด', eq: 'งบแสดงการเปลี่ยนแปลงส่วนของเจ้าของ', notes: 'หมายเหตุประกอบงบการเงิน' }[props.kind]))
</script>

<template>
  <div class="space-y-3">
    <!-- ตัวเลือกช่วง -->
    <div v-if="kind === 'summary' || kind === 'compare'" class="space-y-2">
      <div v-if="kind === 'summary'" class="grid grid-cols-2 gap-1 seg-grid"><button v-for="m in [['month', 'รายเดือน'], ['year', 'รายปี']]" :key="m[0]" type="button" class="h-9 rounded-lg text-sm font-medium" :class="mode === m[0] ? 'bg-white text-brand-800 shadow-sm' : 'text-stone-600'" @click="mode = m[0]">{{ m[1] }}</button></div>
      <div v-else class="grid grid-cols-3 gap-1 seg-grid"><button v-for="m in [['month', 'เดือน'], ['quarter', 'ไตรมาส'], ['year', 'ปี']]" :key="m[0]" type="button" class="h-9 rounded-lg text-sm font-medium" :class="cmpKind === m[0] ? 'bg-white text-brand-800 shadow-sm' : 'text-stone-600'" @click="cmpKind = m[0]">{{ m[1] }}</button></div>
      <div class="grid grid-cols-2 gap-2">
        <div v-if="(kind === 'summary' && mode === 'month') || (kind === 'compare' && cmpKind === 'month')"><label class="label">เดือน</label><input v-model="ym" type="month" class="input h-10" aria-label="เดือนรายงาน" /></div>
        <div v-else><label class="label">ปี (ค.ศ.)</label><input v-model="yr" type="number" class="input h-10" aria-label="ปีรายงาน" /></div>
        <div v-if="kind === 'compare' && cmpKind === 'quarter'"><label class="label">ไตรมาส</label><select v-model="cmpQ" class="input h-10" aria-label="ไตรมาส"><option v-for="q in 4" :key="q" :value="q">{{ q }}</option></select></div>
      </div>
    </div>
    <div v-else-if="kind === 'bs'"><label class="label">ณ วันที่</label><input v-model="asOf" type="date" class="input h-10" aria-label="งบดุล ณ วันที่" /></div>
    <div v-else-if="kind === 'cf' || kind === 'eq'" class="grid grid-cols-2 gap-2"><div><label class="label">ตั้งแต่</label><input v-model="from" type="date" class="input h-10" aria-label="งบตั้งแต่" /></div><div><label class="label">ถึง</label><input v-model="to" type="date" class="input h-10" aria-label="งบถึง" /></div></div>
    <div v-if="kind !== 'notes'" class="flex gap-2"><button class="btn-soft" @click="csv"><AppIcon name="list" :size="16" /> CSV</button><button class="btn-soft" @click="printer?.print()"><AppIcon name="printer" :size="16" /> พิมพ์ A4</button></div>

    <A4Print ref="printer">
      <div class="mb-1 hidden text-sm font-semibold print:block">{{ db.shop.vat?.legalName || db.shop.name }} · {{ titleOf }}</div>
      <!-- สรุป -->
      <section v-if="kind === 'summary'" class="card text-sm" aria-label="สรุปรายงาน">
        <div class="card-title">{{ titleOf }} <span class="text-xs font-normal text-stone-400">{{ dateOnly(sm.from) }} – {{ dateOnly(sm.to) }}</span></div>
        <div class="grid grid-cols-2 gap-2 pb-2"><div class="rounded-xl bg-stone-50 p-2"><div class="text-xs text-stone-500">{{ indiv ? 'รายรับ' : 'รายได้' }}</div><b>{{ money(sm.pl.revenueTotal) }}</b></div><div class="rounded-xl p-2" :class="sm.pl.netProfit < 0 ? 'bg-danger-50' : 'bg-success-50'"><div class="text-xs text-stone-500">{{ indiv ? 'รายรับ − รายจ่าย' : 'กำไร (ขาดทุน) สุทธิ' }}</div><b>{{ money(sm.pl.netProfit) }}</b></div></div>
        <div class="font-semibold text-stone-800">{{ indiv ? 'รายรับ' : 'รายได้' }}ตามหมวด</div>
        <div v-for="r in sm.pl.revenue" :key="r.account.id" class="flex justify-between py-0.5 pl-3"><span>{{ r.account.name }}</span><span>{{ money(r.amount) }}</span></div>
        <div class="mt-2 font-semibold text-stone-800">ต้นทุนและ{{ indiv ? 'รายจ่าย' : 'ค่าใช้จ่าย' }}ตามหมวด</div>
        <div v-for="r in [...sm.pl.cogs, ...sm.pl.opex]" :key="r.account.id" class="flex justify-between py-0.5 pl-3"><span>{{ r.account.name }}</span><span>{{ money(r.amount) }}</span></div>
        <div class="mt-2 font-semibold text-stone-800">ช่องทางรับเงิน</div>
        <div class="flex justify-between py-0.5 pl-3"><span>เงินสด</span><span>{{ money(sm.receipts.cash) }}</span></div><div class="flex justify-between py-0.5 pl-3"><span>ธนาคาร/โอน/บัตร</span><span>{{ money(sm.receipts.bank) }}</span></div>
        <div class="mt-2 font-semibold text-stone-800">ภาษีมูลค่าเพิ่ม · ลูกหนี้/เจ้าหนี้ · อื่น ๆ</div>
        <div class="flex justify-between py-0.5 pl-3"><span>ภาษีขาย / ภาษีซื้อ</span><span>{{ money(sm.vat.output) }} / {{ money(sm.vat.input) }}</span></div>
        <div class="flex justify-between py-0.5 pl-3"><span>ลูกหนี้ / เจ้าหนี้ ณ สิ้นงวด</span><span>{{ money(sm.ar) }} / {{ money(sm.ap) }}</span></div>
        <div class="flex justify-between py-0.5 pl-3"><span>ค่าเสื่อมราคา</span><span>{{ money(sm.depreciation) }}</span></div>
        <div class="flex justify-between py-0.5 pl-3"><span>ค่าใช้จ่ายคะแนนสะสม / คูปอง</span><span>{{ money(sm.pointsCost) }} / {{ money(sm.couponCost) }}</span></div>
      </section>

      <!-- เปรียบเทียบ -->
      <section v-else-if="kind === 'compare'" class="card text-sm" aria-label="เปรียบเทียบ">
        <div class="card-title">{{ titleOf }}</div>
        <div class="mb-3 space-y-1.5" aria-hidden="true">
          <div v-for="(p, i) in cmp.periods" :key="p.label" class="text-xs"><div class="flex justify-between text-stone-600"><span>{{ p.label }}</span><span>รายได้ {{ money(cmp.totals.revenue[i]) }} · กำไร {{ money(cmp.totals.netProfit[i]) }}</span></div><div class="mt-0.5 h-2 rounded-full bg-stone-100"><div class="h-2 rounded-full bg-brand-500" :style="{ width: `${Math.max(0, Math.min(100, (cmp.totals.revenue[i] / barMax) * 100))}%` }" /></div></div>
        </div>
        <div class="overflow-x-auto"><div class="min-w-[34rem]"><div class="grid grid-cols-[1fr_4.5rem_4.5rem_3.2rem_4.5rem_3.2rem] gap-x-1 border-b border-stone-200 pb-1 text-xs font-semibold text-stone-500"><span>รายการ</span><span class="text-right">{{ cmp.periods[0].label }}</span><span class="text-right">{{ cmp.periods[1].label }}</span><span class="text-right">%</span><span class="text-right">{{ cmp.periods[2].label }}</span><span class="text-right">%</span></div>
        <template v-for="[t, key, good] in [['รายได้', 'revenue', 'up'], ['ต้นทุนขาย', 'cogs', 'down'], ['ค่าใช้จ่าย', 'opex', 'down']]" :key="key">
          <div class="mt-1 text-xs font-semibold text-stone-700">{{ t }}</div>
          <div v-for="r in cmp[key]" :key="r.account.id" class="grid grid-cols-[1fr_4.5rem_4.5rem_3.2rem_4.5rem_3.2rem] gap-x-1 py-0.5 text-xs"><span class="min-w-0 break-words">{{ r.account.name }}</span><span class="text-right tabular-nums">{{ r.amounts[0].toLocaleString() }}</span><span class="text-right tabular-nums">{{ r.amounts[1].toLocaleString() }}</span><span class="text-right" :class="cls(r.amounts[0], r.amounts[1], good)">{{ pct(r.amounts[0], r.amounts[1]) }}</span><span class="text-right tabular-nums">{{ r.amounts[2].toLocaleString() }}</span><span class="text-right" :class="cls(r.amounts[0], r.amounts[2], good)">{{ pct(r.amounts[0], r.amounts[2]) }}</span></div>
        </template>
        <div v-for="[t, key, good] in [['รวมรายได้', 'revenue', 'up'], ['กำไรขั้นต้น', 'grossProfit', 'up'], ['รวมค่าใช้จ่าย', 'opex', 'down'], ['กำไรสุทธิ', 'netProfit', 'up']]" :key="key" class="mt-1 grid grid-cols-[1fr_4.5rem_4.5rem_3.2rem_4.5rem_3.2rem] gap-x-1 border-t border-stone-200 pt-1 text-xs font-semibold"><span>{{ t }}</span><span class="text-right tabular-nums">{{ cmp.totals[key][0].toLocaleString() }}</span><span class="text-right tabular-nums">{{ cmp.totals[key][1].toLocaleString() }}</span><span class="text-right" :class="cls(cmp.totals[key][0], cmp.totals[key][1], good)">{{ pct(cmp.totals[key][0], cmp.totals[key][1]) }}</span><span class="text-right tabular-nums">{{ cmp.totals[key][2].toLocaleString() }}</span><span class="text-right" :class="cls(cmp.totals[key][0], cmp.totals[key][2], good)">{{ pct(cmp.totals[key][0], cmp.totals[key][2]) }}</span></div>
        </div></div>
        <p class="mt-2 text-xs text-stone-500">อัตรากำไรขั้นต้น {{ cmp.grossMargin.map((v) => (v == null ? '-' : v + '%')).join(' · ') }} · อัตรากำไรสุทธิ {{ cmp.netMargin.map((v) => (v == null ? '-' : v + '%')).join(' · ') }}</p>
      </section>

      <!-- งบดุล -->
      <section v-else-if="kind === 'bs'" class="card text-sm" aria-label="งบแสดงฐานะการเงิน">
        <div class="card-title">{{ titleOf }} ณ {{ dateOnly(bs.asOf) }}</div>
        <div class="font-semibold text-stone-800">สินทรัพย์หมุนเวียน</div>
        <div v-for="r in bs.currentAssets" :key="r.account.id" class="flex justify-between py-0.5 pl-3"><span>{{ r.account.name }}</span><span>{{ money(r.amount) }}</span></div>
        <div class="font-semibold text-stone-800">สินทรัพย์ไม่หมุนเวียน</div>
        <div v-for="r in bs.fixedAssets" :key="r.account.id" class="flex justify-between py-0.5 pl-3"><span>{{ r.account.name }}</span><span>{{ money(r.amount) }}</span></div>
        <div class="flex justify-between border-t border-stone-200 py-1 font-semibold"><span>รวมสินทรัพย์</span><span aria-label="รวมสินทรัพย์">{{ money(bs.assets) }}</span></div>
        <div class="mt-2 font-semibold text-stone-800">หนี้สินหมุนเวียน</div>
        <div v-for="r in bs.currentLiabilities" :key="r.account.id" class="flex justify-between py-0.5 pl-3"><span>{{ r.account.name }}</span><span>{{ money(r.amount) }}</span></div>
        <div class="font-semibold text-stone-800">หนี้สินระยะยาว</div>
        <div v-for="r in bs.longLiabilities" :key="r.account.id" class="flex justify-between py-0.5 pl-3"><span>{{ r.account.name }}</span><span>{{ money(r.amount) }}</span></div>
        <div class="flex justify-between border-t border-stone-100 py-1 font-semibold"><span>รวมหนี้สิน</span><span>{{ money(bs.liabilities) }}</span></div>
        <div class="font-semibold text-stone-800">ส่วนของเจ้าของ</div>
        <div v-for="r in bs.equityRows" :key="r.account.id" class="flex justify-between py-0.5 pl-3"><span>{{ r.account.name }}</span><span>{{ money(r.amount) }}</span></div>
        <div class="flex justify-between py-0.5 pl-3"><span>กำไรสะสมยกมา (ก่อน {{ dateOnly(bsFy) }})</span><span>{{ money(bs.retainedPrior) }}</span></div>
        <div class="flex justify-between py-0.5 pl-3"><span>กำไร (ขาดทุน) ปีบัญชีนี้</span><span>{{ money(bs.profitYear) }}</span></div>
        <div class="flex justify-between border-t border-stone-100 py-1 font-semibold"><span>รวมส่วนของเจ้าของ</span><span>{{ money(bs.equity) }}</span></div>
        <div class="flex justify-between border-t border-stone-200 py-1 font-semibold"><span>รวมหนี้สินและส่วนของเจ้าของ</span><span aria-label="รวมหนี้สินและส่วนของเจ้าของ">{{ money(bs.liabilitiesEquity) }}</span></div>
        <p class="mt-1 text-xs" :class="bs.balanced ? 'text-success-700' : 'text-danger-700'">{{ bs.balanced ? 'งบดุลสมดุล (สินทรัพย์ = หนี้สิน + ส่วนของเจ้าของ)' : 'งบดุลไม่สมดุล!' }}</p>
      </section>

      <!-- กระแสเงินสด -->
      <section v-else-if="kind === 'cf'" class="card text-sm" aria-label="งบกระแสเงินสด">
        <div class="card-title">{{ titleOf }} <span class="text-xs font-normal text-stone-400">{{ dateOnly(cf.from) }} – {{ dateOnly(cf.to) }} (ทางอ้อม)</span></div>
        <div class="font-semibold text-stone-800">กิจกรรมดำเนินงาน</div>
        <div v-for="(r, i) in cf.operating" :key="'o' + i" class="flex justify-between gap-2 py-0.5 pl-3"><span class="min-w-0 break-words">{{ r.label }}</span><span class="shrink-0">{{ money(r.amount) }}</span></div>
        <div class="flex justify-between border-t border-stone-100 py-1 font-semibold"><span>เงินสดสุทธิจากกิจกรรมดำเนินงาน</span><span>{{ money(cf.totalOperating) }}</span></div>
        <div class="font-semibold text-stone-800">กิจกรรมลงทุน</div>
        <div v-for="(r, i) in cf.investing" :key="'i' + i" class="flex justify-between gap-2 py-0.5 pl-3"><span>{{ r.label }}</span><span>{{ money(r.amount) }}</span></div>
        <div class="flex justify-between border-t border-stone-100 py-1 font-semibold"><span>เงินสดสุทธิจากกิจกรรมลงทุน</span><span>{{ money(cf.totalInvesting) }}</span></div>
        <div class="font-semibold text-stone-800">กิจกรรมจัดหาเงิน</div>
        <div v-for="(r, i) in cf.financing" :key="'f' + i" class="flex justify-between gap-2 py-0.5 pl-3"><span class="min-w-0 break-words">{{ r.label }}</span><span class="shrink-0">{{ money(r.amount) }}</span></div>
        <div class="flex justify-between border-t border-stone-100 py-1 font-semibold"><span>เงินสดสุทธิจากกิจกรรมจัดหาเงิน</span><span>{{ money(cf.totalFinancing) }}</span></div>
        <div class="mt-1 flex justify-between border-t border-stone-200 py-1 font-semibold"><span>เงินสดและธนาคารเพิ่มขึ้น (ลดลง) สุทธิ</span><span>{{ money(cf.netChange) }}</span></div>
        <div class="flex justify-between py-0.5"><span>ยอดต้นงวด</span><span>{{ money(cf.opening) }}</span></div>
        <div class="flex justify-between py-0.5 font-semibold"><span>ยอดปลายงวด</span><span aria-label="เงินสดปลายงวด">{{ money(cf.closing) }}</span></div>
        <p class="mt-1 text-xs" :class="cf.diff === 0 ? 'text-success-700' : 'text-danger-700'">{{ cf.diff === 0 ? 'กระทบยอดตรงกับเงินสด+ธนาคารตามบัญชี' : `ผลต่าง ${money(cf.diff)} — ตรวจรายการ` }}</p>
      </section>

      <!-- ส่วนของเจ้าของ -->
      <section v-else-if="kind === 'eq'" class="card text-sm" aria-label="งบส่วนของเจ้าของ">
        <div class="card-title">{{ titleOf }} <span class="text-xs font-normal text-stone-400">{{ dateOnly(eq.from) }} – {{ dateOnly(eq.to) }}</span></div>
        <div class="flex justify-between py-0.5"><span>ยอดต้นงวด</span><b>{{ money(eq.opening) }}</b></div>
        <div class="flex justify-between py-0.5 pl-3"><span>เพิ่มทุน</span><span>{{ money(eq.capital) }}</span></div>
        <div class="flex justify-between py-0.5 pl-3"><span>กำไร (ขาดทุน) สุทธิ</span><span>{{ money(eq.netIncome) }}</span></div>
        <div class="flex justify-between py-0.5 pl-3"><span>ถอนใช้ส่วนตัว</span><span>{{ money(eq.draws) }}</span></div>
        <div class="flex justify-between py-0.5 pl-3"><span>ปรับปรุงอื่น ๆ</span><span>{{ money(eq.other) }}</span></div>
        <div class="flex justify-between border-t border-stone-200 py-1 font-semibold"><span>ยอดปลายงวด</span><span aria-label="ส่วนของเจ้าของปลายงวด">{{ money(eq.closing) }}</span></div>
      </section>

      <!-- หมายเหตุ -->
      <section v-else class="card space-y-2 text-sm" aria-label="หมายเหตุประกอบงบ">
        <div class="card-title">{{ titleOf }}</div>
        <div class="flex items-center gap-2"><label class="label mb-0">ณ วันที่</label><input v-model="asOf" type="date" class="input h-9 w-auto" aria-label="หมายเหตุ ณ วันที่" /></div>
        <div><b>1. นโยบายการบัญชี</b><p class="text-stone-600">บันทึกบัญชีคู่ตามเกณฑ์คงค้าง รับรู้รายได้เมื่อส่งมอบสินค้า เงินที่รับก่อนส่งมอบแสดงเป็นรายได้รับล่วงหน้า ภาษีขายเกิดเมื่อรับเงิน ต้นทุนขายคำนวณจากสูตรวัตถุดิบโดยประมาณ ค่าเสื่อมราคาคิดเต็มเดือนตั้งแต่เดือนที่เริ่มใช้ ({{ db.acct.settings.entityType === 'individual' ? 'บุคคลธรรมดา' : 'นิติบุคคล' }})</p></div>
        <div><b>2. สินทรัพย์ถาวรและค่าเสื่อมราคา</b>
          <p v-if="!notesAssets.length" class="text-stone-400">ไม่มีสินทรัพย์ถาวร</p>
          <div v-for="n in notesAssets" :key="n.a.id" class="flex justify-between gap-2 py-0.5"><span class="min-w-0 break-words">{{ n.a.code }} {{ n.a.name }} ({{ n.a.method === 'sl' ? 'เส้นตรง' : 'ยอดลดลง' }} {{ n.a.lifeYears }} ปี)</span><span class="shrink-0">ทุน {{ money(n.a.cost) }} · สะสม {{ money(n.accum) }}</span></div>
        </div>
        <div><b>3. ภาระคะแนนสะสม</b><p class="text-stone-600">คะแนนที่แจกไม่ตั้งเป็นหนี้สิน บันทึกเป็นค่าใช้จ่ายเมื่อลูกค้านำไปใช้เป็นส่วนลด ส่วนคะแนนที่ได้จากการคืนเงินแสดงเป็นหนี้สินจนกว่าจะถูกใช้</p></div>
        <div><b>4. ข้อจำกัด</b><p class="text-stone-600">ข้อมูลทั้งหมดเป็นตัวช่วยบันทึกบัญชี ผู้ประกอบการและนักบัญชีต้องตรวจสอบก่อนใช้ยื่นภาษีหรือนำเสนอต่อบุคคลภายนอก</p></div>
      </section>
    </A4Print>
  </div>
</template>
