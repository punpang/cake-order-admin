<script setup>
import { computed, reactive, ref } from 'vue'
import { can, db } from '../../data/store'
import { allEntries, vatReport, vatSetExtra, vatMarkFiled, vatReopen, vatDiff, vatThreshold, taxInvoices } from '../../data/acct'
import { thisMonth } from '../../lib/acct/period'
import { VAT_FORM_LABELS, salesTaxRows, purchaseTaxRows } from '../../lib/acct/vat'
import { downloadCsv } from '../../lib/acct/csv'
import { branchLabel } from '../../lib/acct/taxid'
import { money, dateOnly, toDateStr } from '../../lib/format'
import AppIcon from '../../components/AppIcon.vue'

// ภาษี: ภ.พ.30 รายเดือน · ใบกำกับภาษีที่ออก · รายงานภาษีขาย/ซื้อ (ตัวช่วยคำนวณ — ตรวจกับนักบัญชี/กรมสรรพากรก่อนยื่นจริง)
const sub = ref('pp30')
const ym = ref(thisMonth())
const tick = ref(0)
const rep = computed(() => (tick.value, vatReport(ym.value)))
const diff = computed(() => (tick.value, vatDiff(ym.value)))
const th = computed(() => vatThreshold(Number(ym.value.slice(0, 4))))
const extra = reactive({ zeroRated: '', exempt: '' })
const fil = reactive({ filedAt: toDateStr(new Date()), ref: '', paid: '' })
const reason = ref('')
const error = ref('')
const reopening = ref(false)
const STATUS = { filed: ['ยื่นแล้ว', 'bg-emerald-50 text-emerald-700'], overdue: ['เลยกำหนดยื่น', 'bg-rose-50 text-rose-700'], due: ['ถึงช่วงยื่น', 'bg-amber-50 text-amber-700'], pending: ['ยังไม่ถึงกำหนด', 'bg-stone-100 text-stone-600'] }
const canTax = computed(() => can('acctTax'))
function loadExtra() { extra.zeroRated = rep.value.filing?.extra?.zeroRated || ''; extra.exempt = rep.value.filing?.extra?.exempt || '' }
function saveExtra() {
  error.value = ''
  const r = vatSetExtra(ym.value, extra)
  if (r.error) error.value = r.error
  tick.value++
}
function file() {
  error.value = ''
  const r = vatMarkFiled(ym.value, { filedAt: fil.filedAt, ref: fil.ref, paid: fil.paid })
  if (r.error) error.value = r.error
  tick.value++
}
function reopen() {
  error.value = ''
  const r = vatReopen(ym.value, reason.value)
  if (r.error) return (error.value = r.error)
  reopening.value = false
  reason.value = ''
  tick.value++
}
const sales = computed(() => salesTaxRows(allEntries(), ym.value))
const buys = computed(() => purchaseTaxRows(allEntries(), ym.value))
const sumOf = (rows, k) => Math.round(rows.reduce((s, r) => s + Math.round(r[k] * 100), 0)) / 100
const docNo = (r) => r.docNo || r.memo || ''
function exportPp30() {
  downloadCsv(`pp30-${ym.value}.csv`, ['รายการ', 'จำนวนเงิน'], [...VAT_FORM_LABELS.map(([, l, k]) => [l, rep.value[k]]), ['เดือนภาษี', ym.value], ['กำหนดยื่น (กระดาษ)', rep.value.due.paper], ['กำหนดยื่น (ออนไลน์)', rep.value.due.online]])
}
function exportTax(kind) {
  const rows = kind === 'sales' ? sales.value : buys.value
  downloadCsv(`${kind === 'sales' ? 'sales' : 'purchase'}-tax-${ym.value}.csv`, ['วันที่', 'เลขที่เอกสาร', kind === 'sales' ? 'ชื่อผู้ซื้อ' : 'ชื่อผู้ขาย', 'เลขผู้เสียภาษี', 'มูลค่าก่อนภาษี', 'ภาษีมูลค่าเพิ่ม'], rows.map((r) => [r.date, docNo(r), r.party || '', r.taxId || '', r.base, r.vat]))
}
const invoices = computed(() => (tick.value, taxInvoices().slice().reverse()))
function exportInvoices() {
  downloadCsv('tax-invoices.csv', ['เลขที่', 'ประเภท', 'วันที่', 'ออร์เดอร์', 'ผู้ซื้อ', 'เลขผู้เสียภาษี', 'ก่อนภาษี', 'ภาษี', 'รวม', 'อ้างอิง', 'สถานะ'], taxInvoices().map((i) => [i.no, i.type === 'credit' ? 'ใบลดหนี้' : 'ใบกำกับภาษี', i.date, i.orderCode, i.buyer.name, i.buyer.taxId, i.type === 'credit' ? -i.beforeVat : i.beforeVat, i.type === 'credit' ? -i.vat : i.vat, i.type === 'credit' ? -i.total : i.total, i.refNo || '', i.voidedBy ? 'ยกเลิกแล้ว' : '']))
}
</script>

<template>
  <div class="space-y-3">
    <p class="rounded-xl bg-amber-50 p-3 text-xs text-amber-800">ตัวช่วยคำนวณเท่านั้น ระบบไม่ยื่นแทน — ตรวจตัวเลขกับนักบัญชี/กรมสรรพากรก่อนยื่นจริง · ภาษีขายนับตามจุดเกิดภาษี (รับเงิน/ส่งมอบ) ฐาน VAT คิดหลังส่วนลดทุกประเภท</p>
    <div class="flex gap-2 overflow-x-auto"><button v-for="x in [{ v: 'pp30', l: 'ภ.พ.30' }, { v: 'inv', l: 'ใบกำกับภาษี' }, { v: 'rep', l: 'รายงานภาษีขาย/ซื้อ' }]" :key="x.v" class="chip whitespace-nowrap" :class="sub === x.v ? 'chip-on' : 'chip-off'" @click="sub = x.v">{{ x.l }}</button></div>

    <div v-if="sub !== 'inv'"><label class="label">เดือนภาษี</label><input v-model="ym" type="month" class="input h-10" aria-label="เดือนภาษี" @change="loadExtra" /></div>

    <template v-if="sub === 'pp30'">
      <div v-if="!db.shop.vat?.enabled" class="card text-sm text-stone-500">ร้านยังไม่เปิดใช้ VAT (ตั้งค่าร้าน) · ถ้าไม่ได้จดทะเบียน VAT ไม่ต้องยื่น ภ.พ.30</div>
      <div v-if="th.pct >= 80" class="rounded-xl p-3 text-sm" :class="th.pct >= 100 ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-800'">รายได้ปี {{ th.year }} สะสม {{ money(th.revenue) }} ({{ th.pct }}% ของเกณฑ์จดทะเบียน VAT {{ money(th.threshold) }}) {{ th.registered ? '' : '— ควรปรึกษานักบัญชีเรื่องจดทะเบียน VAT' }}</div>
      <section class="card text-sm" aria-label="สรุป ภ.พ.30">
        <div class="mb-2 flex flex-wrap items-center justify-between gap-2"><div class="card-title mb-0">สรุปตามช่องแบบ ภ.พ.30 · {{ ym }}</div><span class="rounded-full px-2 py-0.5 text-xs font-semibold" :class="STATUS[rep.status][1]">{{ STATUS[rep.status][0] }}</span></div>
        <div v-for="[k, l, f] in VAT_FORM_LABELS" :key="k" class="flex justify-between gap-3 py-0.5" :class="['payable', 'excess'].includes(k) ? 'border-t border-stone-100 font-semibold' : ''"><span class="min-w-0 break-words">{{ l }}</span><span class="shrink-0">{{ money(rep[f]) }}</span></div>
        <p class="mt-2 text-xs text-stone-500">กำหนดยื่น: กระดาษ {{ dateOnly(rep.due.paper) }} · ออนไลน์ {{ dateOnly(rep.due.online) }} · รายการภาษีขาย {{ rep.outputCount }} · ภาษีซื้อ {{ rep.inputCount }}</p>
        <div class="mt-2 flex flex-wrap gap-2"><button class="btn-soft" @click="exportPp30"><AppIcon name="list" :size="16" /> ส่งออก CSV</button></div>
      </section>
      <p v-if="diff" class="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">ข้อมูลเปลี่ยนหลังยื่น: ภาษีขายต่างจากที่ยื่น {{ money(diff.outputVat) }} · ภาษีซื้อต่างจากที่ยื่น {{ money(diff.inputVat) }} — ตรวจสอบและยื่นแบบเพิ่มเติมถ้าจำเป็น</p>
      <section v-if="!rep.filing?.filedAt" class="card space-y-3 text-sm">
        <div class="card-title">ยอดที่กรอกเอง (ไม่อยู่ในระบบ)</div>
        <div class="grid grid-cols-2 gap-3"><div><label class="label">ยอดขายอัตราร้อยละ 0</label><input v-model="extra.zeroRated" v-num.dec class="input" :disabled="!canTax" aria-label="ยอดขายอัตราศูนย์" /></div><div><label class="label">ยอดขายที่ได้รับยกเว้น</label><input v-model="extra.exempt" v-num.dec class="input" :disabled="!canTax" aria-label="ยอดขายยกเว้น" /></div></div>
        <button v-if="canTax" class="btn-soft" @click="saveExtra">บันทึกยอด</button>
        <div class="card-title mt-2">บันทึกว่ายื่นแล้ว (ล็อกเดือนภาษี)</div>
        <div class="grid grid-cols-2 gap-3"><div><label class="label">วันที่ยื่น</label><input v-model="fil.filedAt" type="date" class="input" aria-label="วันที่ยื่น" /></div><div><label class="label">เลขอ้างอิง</label><input v-model="fil.ref" class="input" maxlength="60" aria-label="เลขอ้างอิงการยื่น" /></div><div class="col-span-2"><label class="label">ยอดที่ชำระ</label><input v-model="fil.paid" v-num.dec class="input" aria-label="ยอดภาษีที่ชำระ" /></div></div>
        <button v-if="canTax" class="btn-primary w-full" @click="file">บันทึกว่ายื่นแล้ว</button>
        <p v-else class="text-xs text-stone-500">ต้องมีสิทธิ์ "ภาษี" เพื่อบันทึกการยื่น</p>
      </section>
      <section v-else class="card space-y-2 text-sm">
        <div>ยื่นเมื่อ {{ dateOnly(rep.filing.filedAt) }}<template v-if="rep.filing.ref"> · อ้างอิง {{ rep.filing.ref }}</template> · ชำระ {{ money(rep.filing.paid) }}</div>
        <button v-if="canTax && !reopening" class="btn-outline" @click="reopening = true">ยกเลิกการยื่น (ปลดล็อกเดือน)</button>
        <div v-if="reopening" class="space-y-2"><input v-model="reason" class="input" maxlength="200" placeholder="เหตุผล" aria-label="เหตุผลยกเลิกการยื่น" /><div class="flex gap-2"><button class="btn-outline flex-1" @click="reopening = false">ไม่ยกเลิก</button><button class="btn-primary flex-1" @click="reopen">ยืนยัน</button></div></div>
      </section>
      <p v-if="error" class="text-sm text-rose-700">{{ error }}</p>
    </template>

    <template v-else-if="sub === 'inv'">
      <section class="card text-sm">
        <div class="mb-2 flex items-center justify-between"><div class="card-title mb-0">ใบกำกับภาษีที่ออก ({{ invoices.length }})</div><button class="btn-soft" @click="exportInvoices"><AppIcon name="list" :size="16" /> CSV</button></div>
        <p v-if="!invoices.length" class="py-6 text-center text-stone-400">ยังไม่มี · ออกจากหน้ารายละเอียดออร์เดอร์ (ปุ่ม "ใบกำกับภาษีเต็มรูป")</p>
        <ul class="divide-y divide-stone-100">
          <li v-for="i in invoices" :key="i.id" class="flex items-center justify-between gap-3 py-2">
            <div class="min-w-0"><div class="font-medium text-stone-800">{{ i.no }} <span v-if="i.type === 'credit'" class="text-xs text-amber-700">ใบลดหนี้ (อ้างอิง {{ i.refNo }})</span><span v-if="i.voidedBy" class="text-xs text-rose-700"> ยกเลิกแล้ว</span></div><div class="truncate text-xs text-stone-500">{{ dateOnly(i.date) }} · {{ i.orderCode }} · {{ i.buyer.name }} ({{ branchLabel(i.buyer.branch) }})</div></div>
            <b class="shrink-0">{{ money(i.type === 'credit' ? -i.total : i.total) }}</b>
          </li>
        </ul>
      </section>
    </template>

    <template v-else>
      <section class="card text-sm" aria-label="รายงานภาษีขาย">
        <div class="mb-2 flex items-center justify-between"><div class="card-title mb-0">รายงานภาษีขาย {{ ym }}</div><button class="btn-soft" @click="exportTax('sales')"><AppIcon name="list" :size="16" /> CSV</button></div>
        <p v-if="!sales.length" class="py-4 text-center text-stone-400">ไม่มีรายการ</p>
        <div v-for="(r, i) in sales" :key="'s' + i" class="flex justify-between gap-3 border-b border-stone-50 py-1"><span class="min-w-0 truncate">{{ dateOnly(r.date) }} · {{ docNo(r) }}<template v-if="r.party"> · {{ r.party }}</template></span><span class="shrink-0 text-right">{{ money(r.base) }} <b>{{ money(r.vat) }}</b></span></div>
        <div class="flex justify-between pt-2 font-semibold"><span>รวม</span><span>{{ money(sumOf(sales, 'base')) }} · {{ money(sumOf(sales, 'vat')) }}</span></div>
      </section>
      <section class="card text-sm" aria-label="รายงานภาษีซื้อ">
        <div class="mb-2 flex items-center justify-between"><div class="card-title mb-0">รายงานภาษีซื้อ {{ ym }}</div><button class="btn-soft" @click="exportTax('purchase')"><AppIcon name="list" :size="16" /> CSV</button></div>
        <p v-if="!buys.length" class="py-4 text-center text-stone-400">ไม่มีรายการ (บันทึกค่าใช้จ่ายที่ติ๊ก "ขอคืนภาษีซื้อได้")</p>
        <div v-for="(r, i) in buys" :key="'b' + i" class="flex justify-between gap-3 border-b border-stone-50 py-1"><span class="min-w-0 truncate">{{ dateOnly(r.date) }} · {{ docNo(r) }}<template v-if="r.party"> · {{ r.party }}</template></span><span class="shrink-0 text-right">{{ money(r.base) }} <b>{{ money(r.vat) }}</b></span></div>
        <div class="flex justify-between pt-2 font-semibold"><span>รวม</span><span>{{ money(sumOf(buys, 'base')) }} · {{ money(sumOf(buys, 'vat')) }}</span></div>
      </section>
    </template>
  </div>
</template>
