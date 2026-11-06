// งบการเงิน (ฟังก์ชันล้วน · สตางค์จำนวนเต็ม): งบแสดงฐานะการเงิน · งบกระแสเงินสด (ทางอ้อม) · งบแสดงการเปลี่ยนแปลงส่วนของเจ้าของ · เปรียบเทียบรายได้/ค่าใช้จ่าย
import { toS, toB } from './money'
import { sums, incomeStatement } from './reports'
import { normalSide } from './chart'
import { addMonths, monthRange, quarterRange, yearRange } from './period'

const CASH = ['1010', '1020']
const net = (a, s) => (!s ? 0 : normalSide(a.kind) === 'dr' ? s.dr - s.cr : s.cr - s.dr)
const prevDay = (ymd) => { const d = new Date(`${ymd}T00:00`); d.setDate(d.getDate() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const isNonCurrent = (a) => a.group === 'fixed' || a.group === 'long'
// กำไรสุทธิสะสม (สตางค์) ในช่วง
function profitS(accounts, m) {
  let p = 0
  for (const a of accounts) {
    if (a.kind === 'revenue') p += net(a, m.get(a.id))
    else if (a.kind === 'expense') p -= net(a, m.get(a.id))
  }
  return p
}
const rowsOf = (accounts, m, pick) => accounts.filter(pick).map((a) => ({ account: a, amount: toB(net(a, m.get(a.id))) })).filter((r) => r.amount !== 0).sort((x, y) => x.account.id.localeCompare(y.account.id))
const totalOf = (rows) => toB(rows.reduce((s, r) => s + toS(r.amount), 0))

// งบแสดงฐานะการเงิน ณ asOf · fyStart = วันแรกของปีบัญชีที่ asOf อยู่ (แยกกำไรสะสมยกมา/กำไรปีนี้)
export function balanceSheet(entries, accounts, asOf, fyStart) {
  const m = sums(entries, '', asOf)
  const prior = fyStart ? profitS(accounts, sums(entries, '', prevDay(fyStart))) : 0
  const cur = profitS(accounts, m) - prior
  const cA = rowsOf(accounts, m, (a) => a.kind === 'asset' && !isNonCurrent(a))
  const nA = rowsOf(accounts, m, (a) => a.kind === 'asset' && isNonCurrent(a))
  const cL = rowsOf(accounts, m, (a) => a.kind === 'liability' && a.group !== 'long')
  const nL = rowsOf(accounts, m, (a) => a.kind === 'liability' && a.group === 'long')
  const eq = rowsOf(accounts, m, (a) => a.kind === 'equity')
  const assets = totalOf([...cA, ...nA])
  const liabilities = totalOf([...cL, ...nL])
  const equity = toB(toS(totalOf(eq)) + prior + cur)
  return { asOf, currentAssets: cA, fixedAssets: nA, currentLiabilities: cL, longLiabilities: nL, equityRows: eq, retainedPrior: toB(prior), profitYear: toB(cur), totalCurrentAssets: totalOf(cA), totalFixedAssets: totalOf(nA), assets, totalCurrentLiabilities: totalOf(cL), totalLongLiabilities: totalOf(nL), liabilities, equity, liabilitiesEquity: toB(toS(liabilities) + toS(equity)), balanced: toS(assets) === toS(liabilities) + toS(equity) }
}

// งบกระแสเงินสด (ทางอ้อม) เทียบกับเงินสด+ธนาคารจริง: diff ต้อง 0
export function cashFlow(entries, accounts, from, to) {
  const before = from ? prevDay(from) : ''
  const m0 = from ? sums(entries, '', before) : new Map()
  const m1 = sums(entries, '', to)
  const d = (a) => net(a, m1.get(a.id)) - net(a, m0.get(a.id))
  const byId = (id) => accounts.find((a) => a.id === id)
  const ni = profitS(accounts, m1) - (from ? profitS(accounts, m0) : 0)
  const dep = byId('5800') ? d(byId('5800')) : 0
  const gain = byId('4810') ? d(byId('4810')) : 0
  const loss = byId('5820') ? d(byId('5820')) : 0
  const op = [{ label: 'กำไร (ขาดทุน) สุทธิ', amount: toB(ni) }]
  if (dep) op.push({ label: 'บวก ค่าเสื่อมราคา', amount: toB(dep) })
  if (loss) op.push({ label: 'บวก ขาดทุนจากการจำหน่ายสินทรัพย์', amount: toB(loss) })
  if (gain) op.push({ label: 'หัก กำไรจากการจำหน่ายสินทรัพย์', amount: toB(-gain) })
  for (const a of accounts) {
    if (CASH.includes(a.id) || isNonCurrent(a)) continue
    if (a.kind === 'asset') { const v = d(a); if (v) op.push({ label: `${v > 0 ? 'เพิ่มขึ้น' : 'ลดลง'}ใน ${a.name}`, amount: toB(-v) }) }
    if (a.kind === 'liability') { const v = d(a); if (v) op.push({ label: `${v > 0 ? 'เพิ่มขึ้น' : 'ลดลง'}ใน ${a.name}`, amount: toB(v) }) }
  }
  let fixedNet = 0
  for (const a of accounts) if (a.kind === 'asset' && a.group === 'fixed') fixedNet += d(a)
  const inv = []
  const invAmt = -fixedNet - dep + gain - loss
  if (invAmt) inv.push({ label: 'ซื้อ/ขายสินทรัพย์ถาวร (สุทธิ)', amount: toB(invAmt) })
  const fin = []
  for (const a of accounts) {
    if ((a.kind === 'liability' && a.group === 'long') || a.kind === 'equity') { const v = d(a); if (v) fin.push({ label: `${v > 0 ? 'เพิ่มขึ้น' : 'ลดลง'}ใน ${a.name}`, amount: toB(v) }) }
  }
  const sum = (rows) => rows.reduce((s, r) => s + toS(r.amount), 0)
  const cashAt = (m) => CASH.reduce((s, id) => s + (byId(id) ? net(byId(id), m.get(id)) : 0), 0)
  const opening = cashAt(m0), closing = cashAt(m1)
  const total = sum(op) + sum(inv) + sum(fin)
  return { from, to, operating: op, investing: inv, financing: fin, totalOperating: toB(sum(op)), totalInvesting: toB(sum(inv)), totalFinancing: toB(sum(fin)), netChange: toB(total), opening: toB(opening), closing: toB(closing), diff: toB(total - (closing - opening)) }
}

// งบแสดงการเปลี่ยนแปลงส่วนของเจ้าของ
export function equityStatement(entries, accounts, from, to) {
  const before = from ? prevDay(from) : ''
  const m0 = from ? sums(entries, '', before) : new Map()
  const m1 = sums(entries, '', to)
  const eqSum = (m) => accounts.filter((a) => a.kind === 'equity').reduce((s, a) => s + net(a, m.get(a.id)), 0)
  const d = (id) => { const a = accounts.find((x) => x.id === id); return a ? net(a, m1.get(id)) - net(a, m0.get(id)) : 0 }
  const opening = eqSum(m0) + (from ? profitS(accounts, m0) : 0)
  const ni = profitS(accounts, m1) - (from ? profitS(accounts, m0) : 0)
  const capital = d('3100'), draws = d('3300'), other = (eqSum(m1) - eqSum(m0)) - capital - draws
  return { from, to, opening: toB(opening), capital: toB(capital), draws: toB(draws), other: toB(other), netIncome: toB(ni), closing: toB(opening + capital + draws + other + ni) }
}

// ช่วงเปรียบเทียบ: งวดปัจจุบัน + งวดก่อนหน้า + งวดเดียวกันปีก่อน · kind = month | quarter | year · ref: month 'YYYY-MM' | quarter { y, q } | year number
export function comparePeriods(kind, ref) {
  if (kind === 'month') {
    const mk = (ym, label) => ({ label, ...monthRange(ym) })
    return [mk(ref, ref), mk(addMonths(ref, -1), addMonths(ref, -1)), mk(addMonths(ref, -12), addMonths(ref, -12))]
  }
  if (kind === 'quarter') {
    const { y, q } = ref
    const py = q === 1 ? y - 1 : y, pq = q === 1 ? 4 : q - 1
    return [{ label: `ไตรมาส ${q}/${y}`, ...quarterRange(y, q) }, { label: `ไตรมาส ${pq}/${py}`, ...quarterRange(py, pq) }, { label: `ไตรมาส ${q}/${y - 1}`, ...quarterRange(y - 1, q) }]
  }
  const y = Number(ref)
  return [{ label: `ปี ${y}`, ...yearRange(y) }, { label: `ปี ${y - 1}`, ...yearRange(y - 1) }, { label: `ปี ${y - 2}`, ...yearRange(y - 2) }]
}
// เปลี่ยนแปลง % เทียบฐาน (ฐาน 0 → null)
export const pctChange = (cur, base) => (base ? Math.round(((cur - base) / Math.abs(base)) * 1000) / 10 : null)
export function compareStatements(entries, accounts, periods) {
  const sts = periods.map((p) => incomeStatement(entries, accounts, p.from, p.to))
  const lines = (key) => {
    const ids = [...new Set(sts.flatMap((s) => s[key].map((r) => r.account.id)))].sort()
    return ids.map((id) => ({ account: accounts.find((a) => a.id === id), amounts: sts.map((s) => s[key].find((r) => r.account.id === id)?.amount || 0) }))
  }
  const tot = (k) => sts.map((s) => s[k])
  return { periods, revenue: lines('revenue'), cogs: lines('cogs'), opex: lines('opex'), totals: { revenue: tot('revenueTotal'), cogs: tot('cogsTotal'), grossProfit: tot('grossProfit'), opex: tot('opexTotal'), netProfit: tot('netProfit') }, grossMargin: sts.map((s) => (s.revenueTotal ? Math.round((s.grossProfit / s.revenueTotal) * 1000) / 10 : null)), netMargin: sts.map((s) => (s.revenueTotal ? Math.round((s.netProfit / s.revenueTotal) * 1000) / 10 : null)) }
}
