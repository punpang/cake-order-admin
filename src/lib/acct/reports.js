// รายงานบัญชีแกน (ฟังก์ชันล้วน) · entries = รายการทั้งหมด (บันทึกเอง + แช่แข็ง + ดึงอัตโนมัติ)
import { toS, toB } from './money'
import { normalSide, accountMap } from './chart'

export const inRange = (e, from, to) => (!from || e.date >= from) && (!to || e.date <= to)

// ยอดสุทธิรายบัญชีในช่วง (สตางค์) → Map<accountId, { dr, cr }>
export function sums(entries, from = '', to = '') {
  const m = new Map()
  for (const e of entries) {
    if (!inRange(e, from, to)) continue
    for (const l of e.lines) {
      const cur = m.get(l.account) || { dr: 0, cr: 0 }
      cur.dr += toS(l.dr || 0)
      cur.cr += toS(l.cr || 0)
      m.set(l.account, cur)
    }
  }
  return m
}

// ยอดคงเหลือตามด้านปกติของบัญชี (บาท, ติดลบ = กลับด้าน)
export function balanceOf(a, s) {
  if (!s) return 0
  return toB(normalSide(a.kind) === 'dr' ? s.dr - s.cr : s.cr - s.dr)
}

// งบทดลอง ณ วันที่ (สะสมตั้งแต่ต้น)
export function trialBalance(entries, accounts, asOf = '') {
  const m = sums(entries, '', asOf)
  const rows = accounts
    .filter((a) => m.has(a.id))
    .map((a) => {
      const s = m.get(a.id)
      const net = s.dr - s.cr
      return { account: a, debit: net > 0 ? toB(net) : 0, credit: net < 0 ? toB(-net) : 0, dr: toB(s.dr), cr: toB(s.cr) }
    })
    .filter((r) => r.debit || r.credit || r.dr || r.cr)
    .sort((x, y) => x.account.id.localeCompare(y.account.id))
  return { rows, debit: toB(rows.reduce((s, r) => s + toS(r.debit), 0)), credit: toB(rows.reduce((s, r) => s + toS(r.credit), 0)) }
}

// งบกำไรขาดทุนในช่วง: รายได้ − ต้นทุนขาย = กำไรขั้นต้น − ค่าใช้จ่าย = กำไรสุทธิ
export function incomeStatement(entries, accounts, from, to) {
  const m = sums(entries, from, to)
  const rows = (kind) => accounts.filter((a) => a.kind === kind && m.has(a.id)).map((a) => ({ account: a, amount: balanceOf(a, m.get(a.id)) })).filter((r) => r.amount !== 0).sort((x, y) => x.account.id.localeCompare(y.account.id))
  const revenue = rows('revenue')
  const expense = rows('expense')
  const cogs = expense.filter((r) => r.account.id === '5100')
  const opex = expense.filter((r) => r.account.id !== '5100')
  const sum = (list) => toB(list.reduce((s, r) => s + toS(r.amount), 0))
  const revenueTotal = sum(revenue)
  const cogsTotal = sum(cogs)
  const opexTotal = sum(opex)
  return {
    from, to, revenue, cogs, opex, revenueTotal, cogsTotal, grossProfit: toB(toS(revenueTotal) - toS(cogsTotal)), opexTotal,
    netProfit: toB(toS(revenueTotal) - toS(cogsTotal) - toS(opexTotal)),
  }
}

// บัญชีแยกประเภทของบัญชีเดียว: ยอดยกมาก่อน from + รายการในช่วง พร้อมยอดสะสม
export function ledger(entries, accounts, accountId, from, to) {
  const a = accountMap(accounts).get(accountId)
  if (!a) return null
  const before = sums(entries, '', from ? prevDay(from) : '').get(accountId)
  const opening = from ? balanceOf(a, before) : 0
  let run = toS(opening)
  const sign = normalSide(a.kind) === 'dr' ? 1 : -1
  const rows = []
  for (const e of entries.filter((x) => inRange(x, from, to)).sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : x.id < y.id ? -1 : 1))) {
    const lines = e.lines.filter((l) => l.account === accountId)
    if (!lines.length) continue
    const d = lines.reduce((s, l) => s + toS(l.dr || 0), 0)
    const c = lines.reduce((s, l) => s + toS(l.cr || 0), 0)
    run += sign * (d - c)
    rows.push({ entry: e, dr: toB(d), cr: toB(c), balance: toB(run) })
  }
  return { account: a, opening, rows, closing: toB(run) }
}
function prevDay(ymd) {
  const d = new Date(`${ymd}T00:00`)
  d.setDate(d.getDate() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
