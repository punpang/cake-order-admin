// ภาษีเงินได้ประจำปี (ฟังก์ชันล้วน) · ตารางอัตราเป็นค่าตั้งต้น แก้ได้ต่อปีภาษี (กฎหมายเปลี่ยนได้) · ตัวช่วยคำนวณ ต้องตรวจกับนักบัญชี/กรมสรรพากรก่อนยื่นจริง
import { toS, toB } from './money'

export const DEFAULT_TAX_TABLE = {
  // บุคคลธรรมดา: เงินได้สุทธิ (ส่วนที่ไม่เกิน upTo) → อัตรา % ขั้นบันได
  progressive: [{ upTo: 150000, rate: 0 }, { upTo: 300000, rate: 5 }, { upTo: 500000, rate: 10 }, { upTo: 750000, rate: 15 }, { upTo: 1000000, rate: 20 }, { upTo: 2000000, rate: 25 }, { upTo: 5000000, rate: 30 }, { upTo: null, rate: 35 }],
  // นิติบุคคล SME: กำไรสุทธิ
  sme: [{ upTo: 300000, rate: 0 }, { upTo: 3000000, rate: 15 }, { upTo: null, rate: 20 }],
  corporateRate: 20, smeMaxCapital: 5000000, smeMaxRevenue: 30000000,
  minTaxPct: 0.5, minTaxThreshold: 120000, lumpPct: 60,
  entertainmentPct: 0.3, entertainmentMax: 10000000, lossYears: 5,
}
export const cloneTable = (t = DEFAULT_TAX_TABLE) => JSON.parse(JSON.stringify(t))

// ภาษีขั้นบันได (สตางค์ → บาท)
export function bracketTax(amount, brackets) {
  const a = toS(Math.max(0, Number(amount) || 0))
  let prev = 0, tax = 0
  for (const b of brackets) {
    const top = b.upTo == null ? Infinity : toS(b.upTo)
    if (a > prev) tax += Math.round(((Math.min(a, top) - prev) * (Number(b.rate) || 0)) / 100)
    if (a <= top) break
    prev = top
  }
  return toB(tax)
}
export const smeEligible = (capital, revenue, t = DEFAULT_TAX_TABLE) => Number(capital) <= t.smeMaxCapital && Number(revenue) <= t.smeMaxRevenue
export const corpTax = (profit, { sme = false, table = DEFAULT_TAX_TABLE } = {}) => (profit > 0 ? (sme ? bracketTax(profit, table.sme) : toB(Math.round((toS(profit) * table.corporateRate) / 100))) : 0)
export const entertainmentCap = (revenue, capital, t = DEFAULT_TAX_TABLE) => toB(Math.min(toS(t.entertainmentMax), Math.round((Math.max(toS(revenue), toS(capital)) * t.entertainmentPct) / 100)))

// ภาษีเงินได้นิติบุคคลประจำปี (ภ.ง.ด.50) · adjustments = [{ label, amount }] บวก = บวกกลับ (ทำให้กำไรทางภาษีสูงขึ้น) ลบ = หักออก
export function juristicAnnual({ accountingProfit, adjustments = [], lossForward = 0, capital = 0, revenue = 0, sme, prepaid = 0, wht = 0, table = DEFAULT_TAX_TABLE }) {
  const adj = adjustments.reduce((s, x) => s + toS(x.amount), 0)
  const before = toS(accountingProfit) + adj
  const lossUsed = Math.min(toS(Math.max(0, lossForward)), Math.max(0, before))
  const taxable = Math.max(0, before - lossUsed)
  const isSme = sme ?? smeEligible(capital, revenue, table)
  const tax = corpTax(toB(taxable), { sme: isSme, table })
  const credit = toS(prepaid) + toS(wht)
  const net = toS(tax) - credit
  return { accountingProfit: toB(toS(accountingProfit)), adjustmentsTotal: toB(adj), profitBeforeLoss: toB(before), lossUsed: toB(lossUsed), lossCarryNew: toB(before < 0 ? -before : 0), taxableProfit: toB(taxable), sme: isSme, tax, prepaid: toB(toS(prepaid)), wht: toB(toS(wht)), payable: toB(Math.max(0, net)), refund: toB(Math.max(0, -net)) }
}
// ภ.ง.ด.51: ประมาณกำไรทั้งปี (ไม่ระบุ = กำไรครึ่งปี × 2) → ภาษีทั้งปี → ชำระครึ่งหนึ่ง หักภาษีหัก ณ ที่จ่ายที่ถูกหัก
export function pnd51({ halfProfit, estimatedAnnual = null, capital = 0, revenue = 0, sme, wht = 0, table = DEFAULT_TAX_TABLE }) {
  const est = estimatedAnnual != null && estimatedAnnual !== '' ? Number(estimatedAnnual) : toB(toS(halfProfit) * 2)
  const isSme = sme ?? smeEligible(capital, revenue, table)
  const annual = corpTax(est, { sme: isSme, table })
  const half = toB(Math.round(toS(annual) / 2))
  const net = toS(half) - toS(wht)
  return { estimatedAnnual: toB(toS(est)), sme: isSme, annualTax: annual, halfTax: half, wht: toB(toS(wht)), payable: toB(Math.max(0, net)), excessCredit: toB(Math.max(0, -net)) }
}

// บุคคลธรรมดา 40(8): method = 'actual' (ค่าใช้จ่ายตามจริง) | 'lump' (เหมา % ของเงินได้) · allowances = ผลรวมค่าลดหย่อน
export function individualAnnual({ income, actualExpense = 0, method = 'actual', allowances = 0, prepaid = 0, wht = 0, table = DEFAULT_TAX_TABLE }) {
  const inc = toS(income)
  const expense = method === 'lump' ? Math.round((inc * table.lumpPct) / 100) : Math.min(toS(actualExpense), Math.max(inc, 0))
  const netIncome = Math.max(0, inc - expense - toS(allowances))
  const progressive = bracketTax(toB(netIncome), table.progressive)
  const minTax = inc > toS(table.minTaxThreshold) ? toB(Math.round((inc * table.minTaxPct) / 100)) : 0
  const minApplied = toS(minTax) > toS(progressive)
  const due = minApplied ? minTax : progressive
  const net = toS(due) - toS(prepaid) - toS(wht)
  return { method, income: toB(inc), expense: toB(expense), allowances: toB(toS(allowances)), netIncome: toB(netIncome), progressive, minTax, minApplied, tax: due, prepaid: toB(toS(prepaid)), wht: toB(toS(wht)), payable: toB(Math.max(0, net)), refund: toB(Math.max(0, -net)) }
}
// เทียบหักตามจริง vs เหมา
export const compareMethods = (p) => { const a = individualAnnual({ ...p, method: 'actual' }), l = individualAnnual({ ...p, method: 'lump' }); return { actual: a, lump: l, better: l.tax < a.tax ? 'lump' : 'actual' } }
// ภ.ง.ด.94 (ตัวช่วยประมาณการ ทำนองเดียวกับ ภ.ง.ด.51): ปรับรายได้/ค่าใช้จ่ายครึ่งปีเป็นทั้งปี → ภาษีทั้งปี → ชำระครึ่งหนึ่ง
export function pnd94Estimate({ halfIncome, halfExpense = 0, method = 'actual', allowances = 0, wht = 0, table = DEFAULT_TAX_TABLE }) {
  const r = individualAnnual({ income: toB(toS(halfIncome) * 2), actualExpense: toB(toS(halfExpense) * 2), method, allowances, table })
  const half = toB(Math.round(toS(r.tax) / 2))
  const net = toS(half) - toS(wht)
  return { annualEstimate: r, halfTax: half, wht: toB(toS(wht)), payable: toB(Math.max(0, net)) }
}
