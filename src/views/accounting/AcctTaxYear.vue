<script setup>
import { computed, reactive, ref } from 'vue'
import { db, can } from '../../data/store'
import { annualTaxReport, saveTaxYear, saveTaxTable, taxTableOf, markTaxFiled, reopenTaxFiling, fiscalRange } from '../../data/acct'
import { downloadCsv } from '../../lib/acct/csv'
import { money, dateOnly, toDateStr } from '../../lib/format'
import AppIcon from '../../components/AppIcon.vue'
import A4Print from '../../components/A4Print.vue'

// ภาษีเงินได้ประจำปี: นิติบุคคล (ภ.ง.ด.50/51) หรือ บุคคลธรรมดา 40(8) (ภ.ง.ด.90/94) ตามตั้งค่า · ตัวช่วยคำนวณ ต้องตรวจกับนักบัญชี/กรมสรรพากรก่อนยื่นจริง
const year = ref(new Date().getFullYear())
const tick = ref(0)
const r = computed(() => (tick.value, annualTaxReport(Number(year.value))))
const juristic = computed(() => r.value.kind === 'juristic')
const locked = computed(() => !!r.value.filing?.filedAt)
const canTax = computed(() => can('acctTax'))
const err = ref(''), msg = ref('')
const inp = reactive({ lossForward: '', prepaid: '', wht: '', estimatedAnnual: '', method: 'best', allow: {}, adjLabel: '', adjAmount: '' })
function load() {
  const x = r.value.input
  Object.assign(inp, { lossForward: x.lossForward || '', prepaid: x.prepaid || '', wht: x.wht || '', estimatedAnnual: x.estimatedAnnual, method: x.method, allow: { ...x.allowances } })
}
load()
function save(extra = {}) {
  err.value = msg.value = ''
  const res = saveTaxYear(Number(year.value), { lossForward: inp.lossForward || 0, prepaid: inp.prepaid || 0, wht: inp.wht || 0, estimatedAnnual: inp.estimatedAnnual, method: inp.method, allowances: inp.allow, ...extra })
  if (res.error) err.value = res.error
  else { msg.value = 'บันทึกแล้ว'; tick.value++ }
}
function addAdj() {
  if (!inp.adjLabel.trim() || !Number(inp.adjAmount)) return (err.value = 'ใส่ชื่อรายการและจำนวนเงิน (บวก = บวกกลับ, ลบ = หักออก)')
  save({ adjustments: [...r.value.input.adjustments, { label: inp.adjLabel, amount: Number(inp.adjAmount) }] })
  inp.adjLabel = inp.adjAmount = ''
}
function delAdj(i) { save({ adjustments: r.value.input.adjustments.filter((_, k) => k !== i) }) }
const fil = reactive({ filedAt: toDateStr(new Date()), ref: '', paid: '', reason: '', reopen: false })
function file() { err.value = msg.value = ''; const x = markTaxFiled(Number(year.value), { filedAt: fil.filedAt, ref: fil.ref, paid: fil.paid }); if (x.error) err.value = x.error; else tick.value++ }
function reopenF() { err.value = msg.value = ''; const x = reopenTaxFiling(Number(year.value), fil.reason); if (x.error) return (err.value = x.error); fil.reopen = false; fil.reason = ''; tick.value++ }
const tbl = reactive({ open: false, t: null })
function openTable() { tbl.t = JSON.parse(JSON.stringify(taxTableOf(Number(year.value)))); tbl.open = true; err.value = '' }
function saveTable() { const x = saveTaxTable(Number(year.value), tbl.t); if (x.error) return (err.value = x.error); tbl.open = false; tick.value++ }
const ALLOW = [['personal', 'ส่วนตัว'], ['spouse', 'คู่สมรส'], ['children', 'บุตร'], ['insurance', 'ประกัน'], ['fund', 'กองทุน/ลงทุน'], ['other', 'อื่น ๆ']]
const printer = ref(null)
function csv() {
  const c = r.value.calc
  const rows = juristic.value
    ? [['กำไรสุทธิทางบัญชี', c.accountingProfit], ...r.value.adjustments.map((a) => [a.label, a.amount]), ['กำไรก่อนหักขาดทุนสะสม', c.profitBeforeLoss], ['หักขาดทุนสะสม', c.lossUsed], ['กำไรสุทธิทางภาษี', c.taxableProfit], ['ภาษีเงินได้', c.tax], ['หัก ภ.ง.ด.51', c.prepaid], ['หัก ณ ที่จ่าย', c.wht], ['ภาษีที่ต้องชำระ', c.payable], ['ขอคืน', c.refund]]
    : [['เงินได้พึงประเมิน', c.income], ['หักค่าใช้จ่าย (' + (c.method === 'lump' ? 'เหมา' : 'ตามจริง') + ')', c.expense], ['หักลดหย่อน', c.allowances], ['เงินได้สุทธิ', c.netIncome], ['ภาษีตามขั้นบันได', c.progressive], ['ภาษีขั้นต่ำ 0.5%', c.minTax], ['ภาษีที่ต้องเสีย', c.tax], ['หัก ภ.ง.ด.94', c.prepaid], ['หัก ณ ที่จ่าย', c.wht], ['ภาษีที่ต้องชำระ', c.payable], ['ขอคืน', c.refund]]
  downloadCsv(`annual-tax-${year.value}.csv`, ['รายการ', 'จำนวนเงิน'], rows)
}
</script>

<template>
  <div class="space-y-3">
    <p class="rounded-xl bg-amber-50 p-3 text-xs text-amber-800">ตัวช่วยคำนวณ ไม่ยื่นแทน — อัตราภาษี เพดาน และเงื่อนไขเป็นค่าตั้งต้นที่แก้ได้ต่อปีภาษี ตรวจกับนักบัญชี/กรมสรรพากรก่อนยื่นจริง ({{ juristic ? 'นิติบุคคล: ภ.ง.ด.50 / 51' : 'บุคคลธรรมดา 40(8): ภ.ง.ด.90 / 94' }} — เปลี่ยนประเภทที่แท็บ ปิดงวด/ตั้งค่า)</p>
    <div class="grid grid-cols-2 gap-2"><div><label class="label">ปีบัญชี (ค.ศ.)</label><input v-model="year" type="number" class="input h-10" aria-label="ปีภาษี" @change="load(); tick++" /></div><div class="self-end text-sm text-stone-600">{{ dateOnly(r.fy.from) }} – {{ dateOnly(r.fy.to) }}</div></div>
    <p v-if="err" class="rounded-xl bg-rose-50 p-3 text-sm text-rose-700" role="alert">{{ err }}</p>
    <p v-if="msg" class="text-sm text-emerald-700" role="status">{{ msg }}</p>
    <div v-if="locked" class="rounded-xl bg-indigo-50 p-3 text-sm text-indigo-800"><AppIcon name="lock" :size="14" class="mr-1 inline" /> ยื่นแล้ว {{ dateOnly(r.filing.filedAt) }}<template v-if="r.filing.ref"> · {{ r.filing.ref }}</template> · ล็อกการแก้ไข</div>

    <div class="flex gap-2"><button class="btn-soft" @click="csv"><AppIcon name="list" :size="16" /> CSV</button><button class="btn-soft" @click="printer?.print()"><AppIcon name="printer" :size="16" /> พิมพ์ A4</button><button v-if="can('acctSettings')" class="btn-soft" @click="openTable">ตารางอัตรา</button></div>

    <A4Print ref="printer">
      <!-- นิติบุคคล -->
      <section v-if="juristic" class="card text-sm" aria-label="ภาษีเงินได้นิติบุคคล">
        <div class="card-title">ภาษีเงินได้นิติบุคคล {{ r.fy.label }}</div>
        <div class="flex justify-between py-0.5"><span>กำไร (ขาดทุน) สุทธิทางบัญชี</span><b>{{ money(r.calc.accountingProfit) }}</b></div>
        <div v-for="(a, i) in r.adjustments" :key="i" class="flex justify-between gap-2 py-0.5 pl-3 text-xs" :class="a.amount >= 0 ? 'text-stone-700' : 'text-emerald-700'"><span class="min-w-0 break-words">{{ a.label }}<button v-if="!a.auto && !locked && canTax" class="ml-1 text-rose-600 underline print:hidden" @click="delAdj(i - r.adjustments.filter((x) => x.auto).length)">ลบ</button></span><span class="shrink-0">{{ money(a.amount) }}</span></div>
        <div class="flex justify-between border-t border-stone-100 py-0.5"><span>กำไรทางภาษีก่อนหักขาดทุนสะสม</span><span>{{ money(r.calc.profitBeforeLoss) }}</span></div>
        <div class="flex justify-between py-0.5"><span>หัก ขาดทุนสะสมยกมา (ไม่เกิน {{ r.table.lossYears }} ปี)</span><span>{{ money(r.calc.lossUsed) }}</span></div>
        <div class="flex justify-between border-t border-stone-100 py-0.5 font-semibold"><span>กำไรสุทธิทางภาษี</span><span aria-label="กำไรสุทธิทางภาษี">{{ money(r.calc.taxableProfit) }}</span></div>
        <div class="flex justify-between py-0.5"><span>อัตรา: {{ r.calc.sme ? 'SME ขั้นบันได' : `${r.table.corporateRate}%` }} <span class="text-xs text-stone-400">(ทุนชำระ {{ money(r.capital) }} · รายได้ {{ money(r.revenue) }})</span></span><b aria-label="ภาษีเงินได้">{{ money(r.calc.tax) }}</b></div>
        <div class="flex justify-between py-0.5"><span>หัก ภาษีที่ชำระครึ่งปี (ภ.ง.ด.51)</span><span>{{ money(r.calc.prepaid) }}</span></div>
        <div class="flex justify-between py-0.5"><span>หัก ภาษีหัก ณ ที่จ่ายที่ถูกหัก</span><span>{{ money(r.calc.wht) }}</span></div>
        <div class="flex justify-between border-t border-stone-200 py-1 text-base font-bold" :class="r.calc.refund ? 'text-emerald-700' : ''"><span>{{ r.calc.refund ? 'ภาษีที่ชำระเกิน (ขอคืน/เครดิต)' : 'ภาษีที่ต้องชำระ' }}</span><span aria-label="ภาษีที่ต้องชำระ">{{ money(r.calc.refund || r.calc.payable) }}</span></div>
        <p v-if="r.calc.lossCarryNew" class="text-xs text-stone-500">ขาดทุนทางภาษีปีนี้ยกไป {{ money(r.calc.lossCarryNew) }}</p>
        <div class="mt-3 rounded-xl bg-stone-50 p-2" aria-label="ภ.ง.ด.51"><div class="font-semibold text-stone-800">ภ.ง.ด.51 (ประมาณการครึ่งปี)</div>
          <div class="flex justify-between py-0.5"><span>กำไรครึ่งปีแรก</span><span>{{ money(r.halfProfit) }}</span></div>
          <div class="flex justify-between py-0.5"><span>ประมาณกำไรทั้งปี {{ r.input.estimatedAnnual === '' ? '(ครึ่งปี × 2)' : '(กรอกเอง)' }}</span><span>{{ money(r.pnd51.estimatedAnnual) }}</span></div>
          <div class="flex justify-between py-0.5"><span>ภาษีทั้งปีโดยประมาณ / ชำระครึ่งหนึ่ง</span><span>{{ money(r.pnd51.annualTax) }} / {{ money(r.pnd51.halfTax) }}</span></div>
          <div class="flex justify-between py-0.5 font-semibold"><span>ต้องชำระ ภ.ง.ด.51 (หัก ณ ที่จ่าย {{ money(r.pnd51.wht) }})</span><span>{{ money(r.pnd51.payable) }}</span></div></div>
      </section>
      <!-- บุคคลธรรมดา -->
      <section v-else class="card text-sm" aria-label="ภาษีเงินได้บุคคลธรรมดา">
        <div class="card-title">ภาษีเงินได้บุคคลธรรมดา 40(8) {{ r.fy.label }}</div>
        <div class="flex justify-between py-0.5"><span>เงินได้พึงประเมิน (รายได้ตามบัญชี)</span><b>{{ money(r.calc.income) }}</b></div>
        <div class="flex justify-between py-0.5"><span>หัก ค่าใช้จ่าย ({{ r.method === 'lump' ? `เหมา ${r.table.lumpPct}%` : 'ตามจริงจากบัญชี' }})</span><span>{{ money(r.calc.expense) }}</span></div>
        <div class="flex justify-between py-0.5"><span>หัก ค่าลดหย่อน</span><span>{{ money(r.calc.allowances) }}</span></div>
        <div class="flex justify-between border-t border-stone-100 py-0.5 font-semibold"><span>เงินได้สุทธิ</span><span aria-label="เงินได้สุทธิ">{{ money(r.calc.netIncome) }}</span></div>
        <div class="flex justify-between py-0.5"><span>ภาษีตามอัตราก้าวหน้า</span><span>{{ money(r.calc.progressive) }}</span></div>
        <div class="flex justify-between py-0.5"><span>ภาษีขั้นต่ำ {{ r.table.minTaxPct }}% ของเงินได้พึงประเมิน</span><span>{{ money(r.calc.minTax) }}</span></div>
        <div class="flex justify-between py-0.5 font-semibold"><span>ภาษีที่ต้องเสีย {{ r.calc.minApplied ? '(ใช้ภาษีขั้นต่ำ)' : '' }}</span><span aria-label="ภาษีที่ต้องเสีย">{{ money(r.calc.tax) }}</span></div>
        <div class="flex justify-between py-0.5"><span>หัก ภาษีที่ชำระครึ่งปี (ภ.ง.ด.94)</span><span>{{ money(r.calc.prepaid) }}</span></div>
        <div class="flex justify-between py-0.5"><span>หัก ภาษีหัก ณ ที่จ่าย</span><span>{{ money(r.calc.wht) }}</span></div>
        <div class="flex justify-between border-t border-stone-200 py-1 text-base font-bold" :class="r.calc.refund ? 'text-emerald-700' : ''"><span>{{ r.calc.refund ? 'ภาษีที่ชำระเกิน (ขอคืน)' : 'ภาษีที่ต้องชำระ' }}</span><span aria-label="ภาษีที่ต้องชำระ">{{ money(r.calc.refund || r.calc.payable) }}</span></div>
        <div class="mt-3 rounded-xl bg-stone-50 p-2" aria-label="เทียบวิธีหักค่าใช้จ่าย"><div class="font-semibold text-stone-800">เทียบวิธีหักค่าใช้จ่าย</div>
          <div class="flex justify-between py-0.5"><span>ตามจริง (ค่าใช้จ่ายจากบัญชี {{ money(r.actualExpense) }})</span><span>ภาษี {{ money(r.compare.actual.tax) }}</span></div>
          <div class="flex justify-between py-0.5"><span>เหมา {{ r.table.lumpPct }}%</span><span>ภาษี {{ money(r.compare.lump.tax) }}</span></div>
          <p class="text-xs text-emerald-700">เสียภาษีน้อยกว่า: {{ r.compare.better === 'lump' ? 'หักเหมา' : 'หักตามจริง' }}</p></div>
        <div class="mt-2 rounded-xl bg-stone-50 p-2" aria-label="ภ.ง.ด.94"><div class="font-semibold text-stone-800">ภ.ง.ด.94 (ตัวช่วยประมาณการ)</div>
          <p class="text-xs text-stone-500">ปรับรายได้/ค่าใช้จ่ายครึ่งปีแรกเป็นทั้งปี คำนวณภาษีทั้งปี ชำระครึ่งหนึ่ง — วิธีนี้เป็นการประมาณ ตรวจกับนักบัญชี</p>
          <div class="flex justify-between py-0.5"><span>ภาษีทั้งปีโดยประมาณ / ชำระครึ่งหนึ่ง</span><span>{{ money(r.pnd94.annualEstimate.tax) }} / {{ money(r.pnd94.halfTax) }}</span></div></div>
      </section>
    </A4Print>

    <!-- ข้อมูลที่กรอก -->
    <section v-if="!locked && canTax" class="card space-y-3 text-sm" aria-label="ข้อมูลประกอบการคำนวณภาษี">
      <div class="card-title">ข้อมูลประกอบ (กรอกเอง)</div>
      <div class="grid grid-cols-2 gap-3">
        <div v-if="juristic"><label class="label">ขาดทุนสะสมยกมา</label><input v-model="inp.lossForward" v-num.dec class="input" aria-label="ขาดทุนสะสมยกมา" /></div>
        <div><label class="label">{{ juristic ? 'ชำระ ภ.ง.ด.51 แล้ว' : 'ชำระ ภ.ง.ด.94 แล้ว' }}</label><input v-model="inp.prepaid" v-num.dec class="input" aria-label="ภาษีที่ชำระครึ่งปี" /></div>
        <div><label class="label">ภาษีหัก ณ ที่จ่ายที่ถูกหัก</label><input v-model="inp.wht" v-num.dec class="input" aria-label="ภาษีหัก ณ ที่จ่าย" /></div>
        <div v-if="juristic"><label class="label">ประมาณกำไรทั้งปี (ว่าง = ครึ่งปี×2)</label><input v-model="inp.estimatedAnnual" v-num.dec class="input" aria-label="ประมาณกำไรทั้งปี" /></div>
      </div>
      <div v-if="!juristic">
        <label class="label">วิธีหักค่าใช้จ่าย</label>
        <select v-model="inp.method" class="input" aria-label="วิธีหักค่าใช้จ่าย"><option value="best">เลือกแบบที่เสียน้อยกว่า</option><option value="actual">ตามจริง</option><option value="lump">เหมา</option></select>
        <div class="mt-2 text-sm font-semibold text-stone-800">ค่าลดหย่อน</div>
        <div class="grid grid-cols-2 gap-3"><div v-for="a in ALLOW" :key="a[0]"><label class="label">{{ a[1] }}</label><input v-model="inp.allow[a[0]]" v-num.dec class="input" :aria-label="`ลดหย่อน${a[1]}`" /></div></div>
      </div>
      <button class="btn-soft w-full" @click="save()">บันทึกข้อมูล</button>
      <div v-if="juristic" class="border-t border-stone-100 pt-3">
        <div class="font-semibold text-stone-800">รายการปรับปรุงทางภาษีเพิ่มเติม</div>
        <div class="mt-2 grid grid-cols-[1fr_6rem_auto] gap-2"><input v-model="inp.adjLabel" class="input" placeholder="ชื่อรายการ" aria-label="ชื่อรายการปรับปรุง" /><input v-model="inp.adjAmount" type="number" class="input" placeholder="+/−" aria-label="จำนวนปรับปรุง" /><button class="btn-soft px-3" @click="addAdj">เพิ่ม</button></div>
        <p class="mt-1 text-xs text-stone-500">บวก = บวกกลับ (กำไรทางภาษีเพิ่ม) · ลบ = หักออก · ค่าปรับ/ค่ารับรองเกิน/ค่าเสื่อมส่วนต่าง ระบบใส่ให้อัตโนมัติ</p>
      </div>
    </section>

    <!-- ยื่นแล้ว/ล็อก -->
    <section v-if="canTax" class="card space-y-2 text-sm">
      <template v-if="!locked">
        <div class="card-title">บันทึกว่ายื่นแล้ว</div>
        <p class="text-xs text-stone-500">ต้องปิดงวดถึง {{ dateOnly(r.fy.to) }} ก่อน (ปิดงวดถึง {{ db.acct.closedThrough ? dateOnly(db.acct.closedThrough) : 'ยังไม่เคยปิด' }})</p>
        <div class="grid grid-cols-2 gap-3"><div><label class="label">วันที่ยื่น</label><input v-model="fil.filedAt" type="date" class="input" aria-label="วันที่ยื่นภาษีประจำปี" /></div><div><label class="label">เลขอ้างอิง</label><input v-model="fil.ref" class="input" maxlength="60" aria-label="เลขอ้างอิงภาษีประจำปี" /></div><div class="col-span-2"><label class="label">ยอดที่ชำระ</label><input v-model="fil.paid" v-num.dec class="input" aria-label="ยอดภาษีประจำปีที่ชำระ" /></div></div>
        <button class="btn-primary w-full" @click="file">บันทึกว่ายื่นแล้ว</button>
      </template>
      <template v-else>
        <button v-if="!fil.reopen" class="btn-outline" @click="fil.reopen = true">ยกเลิกการยื่น (ปลดล็อก)</button>
        <div v-else class="space-y-2"><input v-model="fil.reason" class="input" maxlength="200" placeholder="เหตุผล" aria-label="เหตุผลยกเลิกการยื่นภาษีประจำปี" /><div class="flex gap-2"><button class="btn-outline flex-1" @click="fil.reopen = false">ไม่ยกเลิก</button><button class="btn-primary flex-1" @click="reopenF">ยืนยัน</button></div></div>
      </template>
    </section>

    <div v-if="tbl.open" class="fixed inset-0 z-50 overflow-y-auto overscroll-contain bg-stone-900/40" role="dialog" aria-modal="true">
    <div class="flex h-full items-end justify-center pt-8 sm:items-center sm:p-6" @click.self="tbl.open = false">
      <div class="flex max-h-full min-h-0 w-full flex-col overflow-hidden rounded-t-3xl bg-white sm:max-w-md sm:rounded-3xl">
        <div class="shrink-0 px-5 pt-4 pb-2 text-lg font-semibold">ตารางอัตราภาษี ปี {{ year }}</div>
        <div class="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 pb-3 text-sm">
          <div v-for="g in [['progressive', 'บุคคลธรรมดา (เงินได้สุทธิ)'], ['sme', 'นิติบุคคล SME (กำไรสุทธิ)']]" :key="g[0]">
            <div class="font-semibold">{{ g[1] }}</div>
            <div v-for="(b, i) in tbl.t[g[0]]" :key="i" class="mt-1 grid grid-cols-2 gap-2"><input v-if="b.upTo !== null" v-model="b.upTo" type="number" class="input h-9" :aria-label="`${g[0]} ขั้นที่ ${i + 1} ถึง`" /><div v-else class="flex h-9 items-center text-stone-500">ส่วนที่เกิน</div><input v-model="b.rate" type="number" class="input h-9" :aria-label="`${g[0]} ขั้นที่ ${i + 1} อัตรา %`" /></div>
          </div>
          <div class="grid grid-cols-2 gap-2"><div v-for="k in [['corporateRate', 'อัตรานิติบุคคลทั่วไป %'], ['smeMaxCapital', 'SME ทุนไม่เกิน'], ['smeMaxRevenue', 'SME รายได้ไม่เกิน'], ['minTaxPct', 'ภาษีขั้นต่ำ %'], ['minTaxThreshold', 'ขั้นต่ำเมื่อเงินได้เกิน'], ['lumpPct', 'หักเหมา %'], ['entertainmentPct', 'เพดานค่ารับรอง %'], ['entertainmentMax', 'เพดานค่ารับรองสูงสุด']]" :key="k[0]"><label class="label">{{ k[1] }}</label><input v-model="tbl.t[k[0]]" type="number" class="input h-9" :aria-label="k[1]" /></div></div>
          <p v-if="err" class="text-sm text-rose-600" role="alert">{{ err }}</p>
        </div>
        <div class="flex shrink-0 gap-2 border-t border-stone-100 px-5 py-3"><button class="btn-outline flex-1" @click="tbl.open = false; err = ''">ยกเลิก</button><button class="btn-primary flex-1" @click="saveTable">บันทึกตาราง</button></div>
      </div>
    </div>
    </div>
  </div>
</template>
