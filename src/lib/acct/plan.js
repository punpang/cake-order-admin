// ตารางคำนวณบัญชีล่วงหน้า (ฟังก์ชันล้วน · เงินเป็นสตางค์จำนวนเต็ม): ค่าเสื่อม · ตัดจำหน่ายล่วงหน้า · ผ่อนชำระ · ค่าใช้จ่ายประจำ
import { toS, toB, allocate } from './money'
import { addMonths, monthRange } from './period'

const pad = (n) => String(n).padStart(2, '0')
const lastDay = (ym) => monthRange(ym).to
const daysIn = (ym) => Number(monthRange(ym).to.slice(8))
const ymdAdd = (d, n) => { const [y, m, dd] = d.split('-').map(Number); const x = new Date(y, m - 1, dd + n); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}` }
export const addDays = ymdAdd
// เลื่อนวันที่ไปอีก k เดือน (วันที่เกินสิ้นเดือน → สิ้นเดือน)
export function addMonthsDate(date, k) {
  const ym = addMonths(date.slice(0, 7), k)
  return `${ym}-${pad(Math.min(Number(date.slice(8, 10)), daysIn(ym)))}`
}

// ---------- ค่าเสื่อมราคา ----------
// a: { cost, salvage, lifeYears, method: 'sl' | 'db', rate (% ต่อปี สำหรับ db), startDate, disposalDate } · คิดเต็มเดือนตั้งแต่เดือนที่เริ่มใช้ถึงเดือนที่จำหน่าย (รวม)
export function deprSchedule(a) {
  const cost = toS(a.cost)
  const salvage = Math.min(toS(a.salvage || 0), cost)
  const L = Math.max(1, Math.round(Number(a.lifeYears) * 12))
  const start = String(a.startDate).slice(0, 7)
  const endYm = a.disposalDate ? String(a.disposalDate).slice(0, 7) : null
  let amounts
  if (a.method === 'db') {
    const mr = (Number(a.rate) || 0) / 1200
    amounts = []
    let book = cost
    for (let i = 0; i < L; i++) {
      const room = book - salvage
      const d = i === L - 1 ? room : Math.min(room, Math.round(book * mr))
      amounts.push(Math.max(0, d))
      book -= Math.max(0, d)
    }
  } else amounts = allocate(cost - salvage, Array(L).fill(1))
  const rows = []
  let accum = 0
  for (let i = 0; i < L; i++) {
    const ym = addMonths(start, i)
    if (endYm && ym > endYm) break
    accum += amounts[i]
    rows.push({ ym, date: lastDay(ym), amount: toB(amounts[i]), accum: toB(accum), book: toB(cost - accum) })
  }
  return rows
}
export const deprAccum = (a, ym) => { const r = deprSchedule(a).filter((x) => x.ym <= ym); return r.length ? r.at(-1).accum : 0 }

// ค่าเสื่อมตามภาษี: อัตรา % ต่อปีของราคาทุน คิดเต็มเดือนเหมือนทางบัญชี หยุดเมื่อเหลือมูลค่า 1 บาท · คืน { [YYYY-MM]: จำนวนเงิน }
export function taxDeprByMonth(a, ratePct) {
  const cost = toS(a.cost)
  const cap = Math.max(0, cost - 100)
  const start = String(a.startDate).slice(0, 7)
  const endYm = a.disposalDate ? String(a.disposalDate).slice(0, 7) : null
  const m = Math.round((cost * (Number(ratePct) || 0)) / 1200)
  const out = {}
  let acc = 0
  for (let i = 0; i < 1200 && acc < cap; i++) {
    const ym = addMonths(start, i)
    if (endYm && ym > endYm) break
    const d = Math.min(m, cap - acc)
    if (d <= 0) break
    acc += d
    out[ym] = d
  }
  return Object.fromEntries(Object.entries(out).map(([k, s]) => [k, toB(s)]))
}
// รวมเป็นรายปีปฏิทิน { [ปี]: จำนวนเงิน }
export function taxDeprByYear(a, ratePct) {
  const out = {}
  for (const [ym, v] of Object.entries(taxDeprByMonth(a, ratePct))) out[ym.slice(0, 4)] = (out[ym.slice(0, 4)] || 0) + toS(v)
  return Object.fromEntries(Object.entries(out).map(([y, s]) => [y, toB(s)]))
}

// ---------- ตัดจำหน่ายรายได้/ค่าใช้จ่ายล่วงหน้า (เท่ากันทุกเดือน เศษไปงวดสุดท้าย) ----------
export function amortSchedule(total, months, startYm) {
  const n = Math.max(1, Math.round(Number(months)))
  const parts = allocate(toS(total), Array(n).fill(1))
  return parts.map((s, i) => { const ym = addMonths(startYm, i); return { no: i + 1, ym, date: lastDay(ym), amount: toB(s) } })
}

// ---------- ตารางผ่อนชำระ ----------
// { principal, ratePct (ต่อปี), n, method: 'flat' | 'reducing', firstDue } → [{ no, due, principal, interest, payment, balance }]
export function loanSchedule({ principal, ratePct = 0, n, method = 'reducing', firstDue }) {
  const P = toS(principal)
  const N = Math.max(1, Math.round(Number(n)))
  const rate = Number(ratePct) || 0
  const rows = []
  let bal = P
  let pr, it
  if (method === 'flat' || rate === 0) {
    const totalInt = method === 'flat' ? Math.round((P * rate * N) / 1200) : 0
    pr = allocate(P, Array(N).fill(1))
    it = allocate(totalInt, Array(N).fill(1))
  } else {
    const r = rate / 1200
    const pmt = Math.round((P * r) / (1 - Math.pow(1 + r, -N)))
    pr = []
    it = []
    for (let k = 0; k < N; k++) {
      const i = Math.round(bal * r)
      const p = k === N - 1 ? bal : Math.min(bal, pmt - i)
      it.push(i)
      pr.push(p)
      bal -= p
    }
    bal = P
  }
  for (let k = 0; k < N; k++) {
    bal -= pr[k]
    rows.push({ no: k + 1, due: addMonthsDate(firstDue, k), principal: toB(pr[k]), interest: toB(it[k]), payment: toB(pr[k] + it[k]), balance: toB(bal) })
  }
  return rows
}

// ---------- ค่าใช้จ่ายประจำเดือน ----------
export const recurringDue = (t, ym) => `${ym}-${pad(Math.min(Math.max(1, Math.round(Number(t.dueDay) || 1)), daysIn(ym)))}`
// สถานะของแม่แบบในเดือน ym: posted | skipped | missing (เลยกำหนด + ผ่อนผัน) | due (ถึงวันครบกำหนดแล้ว ยังอยู่ในช่วงผ่อนผัน) | upcoming | inactive
export function recurringState(t, ym, { posted = false, skipped = false, today }) {
  if (t.active === false) return 'inactive'
  if (posted) return 'posted'
  if (skipped) return 'skipped'
  if (t.startMonth && ym < t.startMonth) return 'inactive'
  const due = recurringDue(t, ym)
  if (today < due) return 'upcoming'
  return today > addDays(due, Number(t.graceDays ?? 3)) ? 'missing' : 'due'
}

// หมวดสินทรัพย์ถาวร + อัตราค่าเสื่อมสูงสุดทางภาษี (% ต่อปี · ค่าตั้งต้น ต้องตรวจกับประกาศกรมสรรพากรปัจจุบัน แก้ได้ในตั้งค่า)
export const ASSET_CATEGORIES = [
  { id: 'building', label: 'อาคาร/ส่วนปรับปรุงอาคาร', taxRate: 5 },
  { id: 'equipment', label: 'เครื่องจักร/อุปกรณ์ร้าน (เตาอบ ตู้เย็น ฯลฯ)', taxRate: 20 },
  { id: 'furniture', label: 'เฟอร์นิเจอร์/ตกแต่ง', taxRate: 20 },
  { id: 'vehicle', label: 'ยานพาหนะ', taxRate: 20 },
  { id: 'computer', label: 'คอมพิวเตอร์/อุปกรณ์สำนักงาน', taxRate: 33.33 },
  { id: 'other', label: 'อื่น ๆ', taxRate: 20 },
]
