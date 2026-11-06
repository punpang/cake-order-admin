// ภาษีมูลค่าเพิ่ม (ฟังก์ชันล้วน) · รายการบัญชีที่เกี่ยวกับ VAT มี e.tax = [{ kind: 'output'|'input', base, vat, rate, party?, docNo?, taxId?, branch? }]
// (ลบ = กลับรายการ/ใบลดหนี้) · ภ.พ.30 รายเดือน · รายงานภาษีขาย/ซื้อ · วันครบกำหนดยื่น
import { toS, toB } from './money'
import { monthRange } from './period'

export function taxLines(entries, from, to) {
  const out = []
  for (const e of entries) {
    if (!e.tax || e.date < from || e.date > to) continue
    for (const t of e.tax) out.push({ ...t, date: e.date, entryId: e.id, memo: e.memo, source: e.source })
  }
  return out
}
const sum = (list, k) => list.reduce((s, x) => s + toS(x[k] || 0), 0)

// ภ.พ.30 ของเดือน ym · prevExcess = ภาษีชำระเกินยกมาจากเดือนก่อน · extra = { zeroRated, exempt } กรอกเอง
export function vatSummary(entries, ym, { prevExcess = 0, extra = {} } = {}) {
  const { from, to } = monthRange(ym)
  const lines = taxLines(entries, from, to)
  const out = lines.filter((l) => l.kind === 'output')
  const inn = lines.filter((l) => l.kind === 'input')
  const salesBase = sum(out, 'base')
  const outVat = sum(out, 'vat')
  const buyBase = sum(inn, 'base')
  const inVat = sum(inn, 'vat')
  const carry = toS(prevExcess)
  const net = outVat - inVat - carry
  return {
    ym, from, to,
    salesTaxable: toB(salesBase), salesZero: toB(toS(extra.zeroRated || 0)), salesExempt: toB(toS(extra.exempt || 0)), salesTotal: toB(salesBase + toS(extra.zeroRated || 0) + toS(extra.exempt || 0)),
    purchaseBase: toB(buyBase), outputVat: toB(outVat), inputVat: toB(inVat), prevExcess: toB(carry),
    payable: toB(Math.max(0, net)), excess: toB(Math.max(0, -net)), outputCount: out.length, inputCount: inn.length,
  }
}
// ข้อมูลในช่องเดียวกับแบบ (ป้ายปรับได้): ใช้แสดงผลสรุปตามช่อง
export const VAT_FORM_LABELS = [
  ['sales', 'ยอดขายที่ต้องเสียภาษี (มูลค่าก่อน VAT)', 'salesTaxable'],
  ['zero', 'ยอดขายอัตราร้อยละ 0', 'salesZero'],
  ['exempt', 'ยอดขายที่ได้รับยกเว้น', 'salesExempt'],
  ['total', 'รวมยอดขาย', 'salesTotal'],
  ['buy', 'ยอดซื้อที่ต้องเสียภาษี (มูลค่าก่อน VAT)', 'purchaseBase'],
  ['out', 'ภาษีขายเดือนนี้', 'outputVat'],
  ['in', 'ภาษีซื้อเดือนนี้', 'inputVat'],
  ['carry', 'ภาษีชำระเกินยกมาจากเดือนก่อน', 'prevExcess'],
  ['payable', 'ภาษีที่ต้องชำระ', 'payable'],
  ['excess', 'ภาษีที่ชำระเกิน (ยกไปเดือนถัดไป/ขอคืน)', 'excess'],
]

// รายงานภาษีขาย: เรียงตามวัน (รายการลบ = กลับรายการ/ใบลดหนี้)
export const salesTaxRows = (entries, ym) => {
  const { from, to } = monthRange(ym)
  return taxLines(entries, from, to).filter((l) => l.kind === 'output').sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.entryId < b.entryId ? -1 : 1))
}
export const purchaseTaxRows = (entries, ym) => {
  const { from, to } = monthRange(ym)
  return taxLines(entries, from, to).filter((l) => l.kind === 'input').sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.entryId < b.entryId ? -1 : 1))
}

// กำหนดยื่น ภ.พ.30 ของเดือนภาษี ym: กระดาษ วันที่ 15 ของเดือนถัดไป · ยื่นออนไลน์ +8 วัน (วันที่ 23)
export function vatDue(ym) {
  const [y, m] = ym.split('-').map(Number)
  const d = (day) => {
    const x = new Date(y, m, day)
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
  }
  return { paper: d(15), online: d(23) }
}
// สถานะ: filed | overdue (เลยวันยื่นออนไลน์) | due (ถึงกำหนดยื่นแล้ว ยังไม่เลย) | pending
export function vatStatus(ym, filings, today) {
  if (filings?.[ym]?.filedAt) return 'filed'
  const due = vatDue(ym)
  if (today > due.online) return 'overdue'
  if (today >= due.paper.slice(0, 8) + '01') return 'due'
  return 'pending'
}
export const nextMonth = (ym) => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
export const prevMonth = (ym) => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 2, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
