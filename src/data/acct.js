// ระบบบัญชี (จำลองในหน่วยความจำ · จุดที่จะเปลี่ยนเป็น Supabase) · ตรรกะคำนวณอยู่ใน src/lib/acct (ฟังก์ชันล้วน)
// หมายเหตุ: store.js ไม่ import ไฟล์นี้ (กัน import วน) — หน้าที่ต้องใช้ import จากไฟล์นี้โดยตรง
import { db, session, can, scheduledHooks, notify, findCustomer } from './store'
import { deriveAll } from '../lib/acct/derive'
import { buildManualEntry } from '../lib/acct/manual'
import { validateEntry, entryNo, entrySums } from '../lib/acct/journal'
import { trialBalance, incomeStatement, ledger, sums, balanceOf } from '../lib/acct/reports'
import { accountMap, KIND_LABEL } from '../lib/acct/chart'
import { toDateStr } from '../lib/format'
import { toS, toB } from '../lib/acct/money'
import { vatSummary, vatDue, vatStatus, prevMonth, nextMonth } from '../lib/acct/vat'
import { validTaxId, validBranch } from '../lib/acct/taxid'
import { bahtText } from '../lib/acct/thaiBaht'
import { orderTotals } from '../lib/pricing'
import { deprSchedule, deprAccum, taxDeprByYear, amortSchedule, loanSchedule, recurringDue, recurringState, addDays, ASSET_CATEGORIES } from '../lib/acct/plan'
import { thisMonth, addMonths } from '../lib/acct/period'

const A = () => db.acct
let seq = 0
const aid = (p) => `${p}${Date.now().toString(36)}${++seq}`
const today = () => toDateStr(new Date())

// ตัวสร้างรายการอัตโนมัติเพิ่มเติม (ค่าเสื่อม ตัดจำหน่าย ผ่อนชำระ ฯลฯ ลงทะเบียนในรอบถัด ๆ ไป)
export const extraGenerators = []

const ctx = () => ({
  customerOf: (o) => { const c = findCustomer(o.customerId); return c ? { name: c.tax?.name || c.name, taxId: c.tax?.taxId || '' } : null },
  todayStr: today(),
  orders: db.orders, groups: db.optionGroups, retail: db.retailItems, ingredients: db.ingredients,
  coupons: db.coupons, rewards: db.rewards, pointValue: db.loyalty.pointValue, acct: db.acct, shop: db.shop,
})

// รายการอัตโนมัติ (ทั้งหมด ไม่สนปิดงวด)
export const derivedEntries = () => deriveAll(ctx(), extraGenerators)

// รายการทั้งหมดที่ใช้ในรายงาน = บันทึกเอง + ที่แช่แข็งตอนปิดงวด + ดึงอัตโนมัติหลังวันที่ปิดงวด (เรียงตามวัน พร้อมเลขที่)
export function allEntries() {
  const closed = A().closedThrough
  const auto = derivedEntries().filter((e) => !closed || e.date > closed)
  const rows = [...A().entries.map((e) => ({ ...e, no: e.no })), ...A().frozen, ...auto]
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.createdAt || a.id) < (b.createdAt || b.id) ? -1 : 1))
  return rows
}
export const activeAccounts = () => A().accounts.filter((a) => a.active !== false)
export const accountOf = (id) => accountMap(A().accounts).get(id)
export const locked = (date) => !!A().closedThrough && date <= A().closedThrough
export const sourceLabel = (e) => ({ 'asset-depr': 'ค่าเสื่อมราคา', 'asset-dispose': 'จำหน่ายสินทรัพย์', deferral: 'ตัดจำหน่ายล่วงหน้า', manual: 'บันทึกเอง', 'order-pay': 'รับชำระออร์เดอร์', 'order-payx': 'ยกเลิกยอดชำระ', 'order-deliver': 'ส่งมอบ/รับรู้รายได้', 'order-cancel': 'ยกเลิก/คืนเงิน', 'order-cancel-rev': 'ยกเลิก/กลับรายการ', reward: 'ของรางวัล' }[e.source?.type] || e.source?.type || '')

const LINKED = ['asset', 'deferral', 'loan', 'installment']
function nextNo(prefix, date) {
  const key = `${prefix}-${date.slice(0, 4)}`
  A().seq[key] = (A().seq[key] || 0) + 1
  return entryNo(prefix, date, A().seq[key])
}
// เลขที่ใบกำกับภาษี/ใบลดหนี้: รันต่อปี (พ.ศ.) 5 หลัก ไม่ขาดช่วง เช่น INV-2569-00001
function nextDocNo(prefix, date) {
  const key = `${prefix}-${date.slice(0, 4)}`
  A().seq[key] = (A().seq[key] || 0) + 1
  return `${prefix}-${Number(date.slice(0, 4)) + 543}-${String(A().seq[key]).padStart(5, '0')}`
}
function guard(perm = 'acctRecord') {
  if (!can(perm)) return { error: 'ไม่มีสิทธิ์' }
  return null
}

// ---------- บันทึกเอง ----------
// form = ฟอร์มรายได้/ค่าใช้จ่าย (buildManualEntry) · id = แก้ไขรายการเดิม
export function saveManual(form, id = null) {
  const g = guard()
  if (g) return g
  const r = buildManualEntry(form)
  if (r.error) return r
  return commit(r.entry, id, 'JV')
}
// รายการบัญชีขั้นสูง: lines = [{ account, dr, cr }]
export function saveJournal({ date, memo, lines }, id = null) {
  const g = guard()
  if (g) return g
  const clean = (lines || []).map((l) => ({ account: l.account, ...(Number(l.dr) > 0 ? { dr: toB(toS(l.dr)) } : { cr: toB(toS(l.cr || 0)) }) })).filter((l) => (l.dr || l.cr))
  return commit({ date, memo: String(memo || '').trim().slice(0, 200), lines: clean, source: { type: 'manual', kind: 'journal' } }, id, 'JV')
}
function commit(entry, id, prefix) {
  const err = validateEntry(entry, A().accounts)
  if (err) return { error: err }
  if (entry.tax?.length && vatFiled(entry.date.slice(0, 7))) return { error: `เดือนภาษี ${entry.date.slice(0, 7)} ยื่น ภ.พ.30 แล้ว ลงรายการที่มีภาษีในเดือนนั้นไม่ได้ (ยกเลิกการยื่นก่อน หรือลงเดือนถัดไป)` }
  if (locked(entry.date)) return { error: `งวดถึง ${A().closedThrough} ปิดแล้ว ลงรายการในวันนั้นไม่ได้ (ใช้วันที่หลังปิดงวด หรือกลับรายการ)` }
  if (id) {
    const cur = A().entries.find((e) => e.id === id)
    if (!cur) return { error: 'ไม่พบรายการ' }
    if (locked(cur.date)) return { error: 'รายการอยู่ในงวดที่ปิดแล้ว แก้ไม่ได้ (กลับรายการแทน)' }
    if (LINKED.includes(cur.source?.kind)) return { error: 'รายการนี้สร้างจากหน้าสินทรัพย์/ล่วงหน้า/ผ่อนชำระ แก้ที่หน้านั้น (หรือกลับรายการ)' }
    if (cur.reversedBy || cur.source?.reverses) return { error: 'รายการที่กลับรายการแล้ว/เป็นรายการกลับ แก้ไม่ได้' }
    if (cur.tax?.length && vatFiled(cur.date.slice(0, 7))) return { error: `เดือนภาษี ${cur.date.slice(0, 7)} ยื่น ภ.พ.30 แล้ว แก้ไม่ได้` }
    if (entry.tax?.length) cur.tax = entry.tax
    else delete cur.tax
    Object.assign(cur, { date: entry.date, memo: entry.memo, lines: entry.lines, source: entry.source, updatedAt: new Date().toISOString(), updatedBy: session.userId })
    return { ok: true, entry: cur }
  }
  const e = { id: aid('jv'), no: nextNo(prefix, entry.date), createdAt: new Date().toISOString(), by: session.userId, ...entry }
  A().entries.push(e)
  return { ok: true, entry: e }
}
export function deleteManual(id) {
  const g = guard()
  if (g) return g
  const i = A().entries.findIndex((e) => e.id === id)
  if (i < 0) return { error: 'ไม่พบรายการ' }
  const e = A().entries[i]
  if (locked(e.date)) return { error: 'อยู่ในงวดที่ปิดแล้ว ลบไม่ได้ (กลับรายการแทน)' }
  if (e.tax?.length && vatFiled(e.date.slice(0, 7))) return { error: `เดือนภาษี ${e.date.slice(0, 7)} ยื่น ภ.พ.30 แล้ว ลบไม่ได้ (กลับรายการแทนในเดือนถัดไป)` }
  if (LINKED.includes(e.source?.kind)) return { error: 'รายการนี้สร้างจากหน้าสินทรัพย์/ล่วงหน้า/ผ่อนชำระ ลบที่หน้านั้น (หรือกลับรายการ)' }
  if (e.reversedBy || e.source?.reverses) return { error: 'ลบรายการกลับรายการไม่ได้' }
  A().entries.splice(i, 1)
  return { ok: true }
}
// กลับรายการ (สำหรับรายการในงวดที่ปิดแล้ว): สร้างรายการกลับด้านลงวันนี้ (หรือวันที่ระบุ หลังปิดงวด)
export function reverseEntry(id, date = today(), memo = '') {
  const g = guard()
  if (g) return g
  const cur = A().entries.find((e) => e.id === id)
  if (!cur) return { error: 'ไม่พบรายการ (กลับรายการได้เฉพาะรายการที่บันทึกเอง)' }
  if (cur.reversedBy) return { error: 'กลับรายการไปแล้ว' }
  if (cur.source?.reverses) return { error: 'ไม่กลับรายการของรายการกลับ' }
  const lines = cur.lines.map((l) => ({ account: l.account, ...(l.dr ? { cr: l.dr } : { dr: l.cr }) }))
  const r = commit({ date, memo: memo.trim() || `กลับรายการ ${cur.no}`, lines, source: { type: 'manual', kind: 'journal', reverses: cur.id }, ...(cur.tax?.length ? { tax: cur.tax.map((t) => ({ ...t, base: -t.base, vat: -t.vat })) } : {}) }, null, 'JV')
  if (r.error) return r
  cur.reversedBy = r.entry.id
  return r
}
// ชำระเจ้าหนี้/รับชำระลูกหนี้ ของรายการที่ค้าง
export function settleEntry(id, { date, method }) {
  const g = guard()
  if (g) return g
  const cur = A().entries.find((e) => e.id === id)
  if (!cur || !['payable', 'receivable'].includes(cur.source?.settle)) return { error: 'รายการนี้ไม่ได้ค้างจ่าย/ค้างรับ' }
  if (cur.settledBy) return { error: 'ชำระแล้ว' }
  const bank = method === 'bank' ? '1020' : '1010'
  const amt = cur.source.total
  const payable = cur.source.settle === 'payable'
  const lines = payable ? [{ account: '2100', dr: amt }, { account: bank, cr: amt }] : [{ account: bank, dr: amt }, { account: '1100', cr: amt }]
  const r = commit({ date, memo: `${payable ? 'ชำระเจ้าหนี้' : 'รับชำระลูกหนี้'} ${cur.no}`, lines, source: { type: 'manual', kind: 'settle', settles: cur.id } }, null, 'JV')
  if (r.error) return r
  cur.settledBy = r.entry.id
  return r
}

// ---------- ผังบัญชี ----------
export function saveAccount(a) {
  const g = guard('acctSettings')
  if (g) return g
  const id = String(a.id || '').trim()
  if (!/^[1-5]\d{3}$/.test(id)) return { error: 'รหัสบัญชีต้องเป็นเลข 4 หลัก ขึ้นต้น 1–5' }
  const name = String(a.name || '').trim().slice(0, 80)
  if (!name) return { error: 'ใส่ชื่อบัญชี' }
  if (!KIND_LABEL[a.kind]) return { error: 'หมวดบัญชีไม่ถูกต้อง' }
  const cur = A().accounts.find((x) => x.id === id)
  const used = allEntries().some((e) => e.lines.some((l) => l.account === id))
  if (cur) {
    if (cur.kind !== a.kind && used) return { error: 'บัญชีมีรายการแล้ว เปลี่ยนหมวดไม่ได้' }
    if (cur.system && a.active === false) return { error: 'บัญชีที่ระบบใช้ ปิดใช้งานไม่ได้' }
    Object.assign(cur, { name, kind: cur.system ? cur.kind : a.kind, active: cur.system ? true : a.active !== false, quick: !!a.quick, taxDeductible: a.taxDeductible !== false })
    return { ok: true, account: cur }
  }
  const acc = { id, name, kind: a.kind, active: a.active !== false, system: false, quick: !!a.quick, taxDeductible: a.kind === 'expense' ? a.taxDeductible !== false : false }
  A().accounts.push(acc)
  A().accounts.sort((x, y) => x.id.localeCompare(y.id))
  return { ok: true, account: acc }
}
export function removeAccount(id) {
  const g = guard('acctSettings')
  if (g) return g
  const cur = A().accounts.find((x) => x.id === id)
  if (!cur) return { error: 'ไม่พบบัญชี' }
  if (cur.system) return { error: 'บัญชีที่ระบบใช้ ลบไม่ได้' }
  if (allEntries().some((e) => e.lines.some((l) => l.account === id))) return { error: 'มีรายการแล้ว ลบไม่ได้ (ปิดใช้งานแทน)' }
  A().accounts.splice(A().accounts.indexOf(cur), 1)
  return { ok: true }
}

// ---------- ปิดงวด ----------
// ปิดงวดถึงวันที่ date: รายการอัตโนมัติถึงวันนั้นถูกแช่แข็ง (ไม่เปลี่ยนแม้แก้ออร์เดอร์ย้อนหลัง) · บันทึกเองถึงวันนั้นแก้ไม่ได้
export function closePeriod(date) {
  const g = guard('acctClose')
  if (g) return g
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: 'วันที่ไม่ถูกต้อง' }
  if (date > today()) return { error: 'ปิดงวดล่วงหน้าไม่ได้' }
  if (A().closedThrough && date <= A().closedThrough) return { error: `ปิดงวดถึง ${A().closedThrough} ไปแล้ว` }
  const have = new Set(A().frozen.map((e) => e.id))
  const fresh = derivedEntries().filter((e) => e.date <= date && !have.has(e.id) && (!A().closedThrough || e.date > A().closedThrough))
  const un = fresh.filter((e) => e.lines.length && entrySums(e).dr !== entrySums(e).cr)
  if (un.length) return { error: `มีรายการอัตโนมัติไม่สมดุล ${un.length} รายการ ปิดงวดไม่ได้` }
  A().frozen.push(...fresh.map((e) => JSON.parse(JSON.stringify(e))))
  A().closedThrough = date
  return { ok: true, frozen: fresh.length }
}
// เปิดงวดกลับ: ย้ายวันที่ปิดงวดถอยไป (ว่าง = เปิดทั้งหมด) รายการแช่แข็งหลังวันนั้นถูกคำนวณใหม่
export function reopenPeriod(toDate = '') {
  const g = guard('acctClose')
  if (g) return g
  if (toDate && toDate >= A().closedThrough) return { error: 'ต้องถอยวันที่ปิดงวดไปก่อนหน้าเดิม' }
  A().frozen = A().frozen.filter((e) => !!toDate && e.date <= toDate)
  A().closedThrough = toDate
  return { ok: true }
}

// ---------- รายงาน (ห่อฟังก์ชันล้วนด้วยข้อมูลปัจจุบัน) ----------
export const reportTrialBalance = (asOf = '') => trialBalance(allEntries(), A().accounts, asOf)
export const reportIncome = (from, to) => incomeStatement(allEntries(), A().accounts, from, to)
export const reportLedger = (accountId, from = '', to = '') => ledger(allEntries(), A().accounts, accountId, from, to)
export function cashPosition(asOf = '') {
  const m = sums(allEntries(), '', asOf)
  const bal = (id) => balanceOf(accountOf(id), m.get(id))
  return { cash: bal('1010'), bank: bal('1020'), total: toB(toS(bal('1010')) + toS(bal('1020'))) }
}

// ---------- ภาษีมูลค่าเพิ่ม (ภ.พ.30) ----------
const filings = () => (A().vatFilings ||= {})
export const vatFiled = (ym) => !!filings()[ym]?.filedAt
export const vatFilingOf = (ym) => filings()[ym] || null
export const vatReport = (ym) => {
  const prev = filings()[prevMonth(ym)]
  // ภาษีเกินยกมา = ยอดเกินของเดือนก่อน (คำนวณสดตามข้อมูลปัจจุบัน ถ้าเดือนก่อนยื่นแล้วใช้ตัวเลขที่ยื่น)
  const carry = prev?.filedAt ? prev.excess : vatSummary(allEntries(), prevMonth(ym), { prevExcess: carryIn(prevMonth(ym)) }).excess
  return { ...vatSummary(allEntries(), ym, { prevExcess: carry, extra: filings()[ym]?.extra || {} }), due: vatDue(ym), status: vatStatus(ym, filings(), today()), filing: filings()[ym] || null }
}
function carryIn(ym, depth = 0) {
  if (depth > 24) return 0
  const prev = filings()[prevMonth(ym)]
  if (prev?.filedAt) return prev.excess
  if (!allEntries().some((e) => e.tax?.length && e.date < `${ym}-01`)) return 0
  return vatSummary(allEntries(), prevMonth(ym), { prevExcess: carryIn(prevMonth(ym), depth + 1) }).excess
}
export function vatSetExtra(ym, extra) {
  const g = guard('acctTax')
  if (g) return g
  if (vatFiled(ym)) return { error: 'ยื่นแล้ว แก้ไม่ได้' }
  filings()[ym] = { ...(filings()[ym] || {}), extra: { zeroRated: Math.max(0, Number(extra?.zeroRated) || 0), exempt: Math.max(0, Number(extra?.exempt) || 0) } }
  return { ok: true }
}
// บันทึกว่ายื่นแล้ว: เก็บตัวเลข ณ วันที่ยื่น (snapshot) และล็อกเดือนภาษี
export function vatMarkFiled(ym, { filedAt = today(), ref = '', paid = 0 } = {}) {
  const g = guard('acctTax')
  if (g) return g
  if (!/^\d{4}-\d{2}$/.test(ym)) return { error: 'เดือนภาษีไม่ถูกต้อง' }
  if (vatFiled(ym)) return { error: 'ยื่นแล้ว' }
  const prevM = prevMonth(ym)
  if (vatSummary(allEntries(), prevM).outputCount + vatSummary(allEntries(), prevM).inputCount > 0 && !vatFiled(prevM)) return { error: `ยังไม่ได้บันทึกยื่นเดือน ${prevM} (บันทึกตามลำดับเพื่อให้ยกยอดภาษีเกินถูกต้อง)` }
  const r = vatReport(ym)
  const { due, status, filing, ...snap } = r
  filings()[ym] = { ...(filing || {}), filedAt, ref: String(ref).trim().slice(0, 60), paid: Math.max(0, Number(paid) || 0), by: session.userId, snapshot: snap, excess: r.excess, outputVat: r.outputVat, inputVat: r.inputVat, payable: r.payable }
  return { ok: true }
}
export function vatReopen(ym, reason) {
  const g = guard('acctTax')
  if (g) return g
  if (!vatFiled(ym)) return { error: 'ยังไม่ได้ยื่น' }
  const nxt = nextMonth(ym)
  if (vatFiled(nxt)) return { error: `เดือน ${nxt} ยื่นแล้ว ต้องยกเลิกเดือนนั้นก่อน` }
  if (!String(reason || '').trim()) return { error: 'ระบุเหตุผล' }
  const f = filings()[ym]
  ;(f.history ||= []).push({ at: new Date().toISOString(), by: session.userId, reason: String(reason).trim().slice(0, 200), filedAt: f.filedAt, ref: f.ref })
  delete f.filedAt
  return { ok: true }
}
// ตัวเลขที่ยื่นไว้ต่างจากข้อมูลปัจจุบัน (มีใบ/ออร์เดอร์เปลี่ยนหลังยื่น)
export function vatDiff(ym) {
  const f = filings()[ym]
  if (!f?.filedAt) return null
  const cur = vatSummary(allEntries(), ym, { prevExcess: f.snapshot.prevExcess, extra: f.extra || {} })
  const d = { outputVat: toB(toS(cur.outputVat) - toS(f.outputVat)), inputVat: toB(toS(cur.inputVat) - toS(f.inputVat)) }
  return d.outputVat || d.inputVat ? d : null
}
// เกณฑ์จดทะเบียน VAT: รายได้สะสมปีปฏิทิน (ยอดขายก่อน VAT ตามข้อมูลบัญชี) เทียบ 1.8 ล้านบาท
export const VAT_THRESHOLD = 1800000
export function vatThreshold(year = new Date().getFullYear()) {
  const rev = reportIncome(`${year}-01-01`, `${year}-12-31`)
  const total = rev.revenueTotal
  return { year, revenue: total, threshold: VAT_THRESHOLD, pct: Math.round((total / VAT_THRESHOLD) * 100), registered: !!db.shop.vat?.enabled }
}

// ---------- ใบกำกับภาษีเต็มรูป ----------
const invs = () => (A().taxInvoices ||= [])
export const taxInvoices = () => invs()
export const invoiceOfOrder = (orderId) => invs().find((i) => i.type === 'invoice' && i.orderId === orderId && !i.voidedBy) || null
const sellerOk = () => {
  const v = db.shop.vat || {}
  if (!v.enabled) return 'ร้านยังไม่เปิดใช้ VAT'
  if (!validTaxId(v.taxId)) return 'เลขประจำตัวผู้เสียภาษีของร้านไม่ถูกต้อง (ตั้งค่าร้าน → VAT)'
  if (!String(v.legalName || '').trim() || !String(v.address || '').trim()) return 'กรอกชื่อและที่อยู่ผู้ประกอบการในตั้งค่า VAT ก่อน'
  return ''
}
// ตรวจก่อนออกใบ: คืนข้อความผิดพลาด หรือ ''
export function invoiceBlock(order, buyer = null) {
  if (!order?.vat || !(Number(order.vat.rate) > 0)) return 'ออร์เดอร์นี้ไม่ได้คิด VAT'
  if (order.status === 'cancelled' || order.status === 'draft') return 'ออร์เดอร์นี้ออกใบกำกับภาษีไม่ได้'
  if (invoiceOfOrder(order.id)) return 'ออกใบกำกับภาษีของออร์เดอร์นี้แล้ว (ยกเลิกด้วยใบลดหนี้ก่อนจึงออกใหม่)'
  const t = orderTotals(order)
  if (t.balance > 0.004) return 'ชำระยังไม่ครบ (ออกใบกำกับภาษีเมื่อรับชำระครบ)'
  if (!(t.vat > 0)) return 'ไม่มี VAT ในออร์เดอร์นี้'
  const s = sellerOk()
  if (s) return s
  const b = buyer || buyerOf(order)
  if (!String(b.name || '').trim()) return 'ไม่มีชื่อผู้ซื้อ'
  if (!validTaxId(b.taxId)) return 'เลขประจำตัวผู้เสียภาษีผู้ซื้อไม่ถูกต้อง (13 หลัก)'
  if (!validBranch(b.branch)) return 'รหัสสาขาผู้ซื้อต้อง 5 หลัก (สำนักงานใหญ่ = 00000)'
  if (!String(b.address || '').trim()) return 'ไม่มีที่อยู่ผู้ซื้อ'
  return ''
}
export const buyerOf = (order) => {
  const c = findCustomer(order.customerId)
  return { name: c?.tax?.name || '', taxId: c?.tax?.taxId || '', branch: c?.tax?.branch || '00000', address: c?.tax?.address || '' }
}
// ออกใบกำกับภาษีเต็มรูป (snapshot · แก้ไม่ได้) buyer = ข้อมูลผู้ซื้อ ณ วันออก (ไม่ส่ง = ใช้ของลูกค้า)
export function issueTaxInvoice(orderId, buyer = null) {
  const g = guard('taxInvoice')
  if (g) return g
  const order = db.orders.find((o) => o.id === orderId)
  if (!order) return { error: 'ไม่พบออร์เดอร์' }
  const b = buyer ? { name: String(buyer.name || '').trim().slice(0, 120), taxId: String(buyer.taxId || '').replace(/\D/g, ''), branch: String(buyer.branch || '00000').replace(/\D/g, ''), address: String(buyer.address || '').trim().slice(0, 300) } : buyerOf(order)
  const err = invoiceBlock(order, b)
  if (err) return { error: err }
  const t = orderTotals(order)
  const v = db.shop.vat
  const date = today()
  const lines = [
    ...order.items.map((i) => ({ name: i.name, qty: i.qty, unitPrice: i.unitPrice, amount: toB(toS(i.unitPrice) * i.qty) })),
    ...(t.shipping ? [{ name: 'ค่าจัดส่ง', qty: 1, unitPrice: t.shipping, amount: t.shipping }] : []),
  ]
  const inv = {
    id: aid('ti'), no: nextDocNo('INV', date), type: 'invoice', date, orderId: order.id, orderCode: order.code,
    seller: { name: v.legalName, taxId: v.taxId, branch: v.branch || '00000', address: v.address },
    buyer: b, lines, discounts: t.discountLines.map((d) => ({ label: d.label, amount: d.amount })),
    rate: t.vatRate, mode: t.vatMode, beforeVat: toB(toS(t.total) - toS(t.vat)), vat: t.vat, total: t.total,
    totalText: bahtText(t.total), copies: 0, by: session.userId, createdAt: new Date().toISOString(),
  }
  invs().push(inv)
  return { ok: true, invoice: inv }
}
// ยกเลิก = ออกใบลดหนี้เต็มจำนวนอ้างใบเดิม (ใบเดิมไม่ถูกลบ) · ต้องมีเหตุผล
export function voidTaxInvoice(id, reason) {
  const g = guard('taxInvoice')
  if (g) return g
  const inv = invs().find((i) => i.id === id)
  if (!inv || inv.type !== 'invoice') return { error: 'ไม่พบใบกำกับภาษี' }
  if (inv.voidedBy) return { error: 'ยกเลิกแล้ว' }
  if (!String(reason || '').trim()) return { error: 'ระบุเหตุผล' }
  const date = today()
  const cn = { ...inv, id: aid('ti'), no: nextDocNo('CN', date), type: 'credit', date, refNo: inv.no, refId: inv.id, reason: String(reason).trim().slice(0, 200), copies: 0, by: session.userId, createdAt: new Date().toISOString(), voidedBy: undefined }
  delete cn.voidedBy
  invs().push(cn)
  inv.voidedBy = cn.id
  return { ok: true, creditNote: cn }
}
export function markInvoiceCopy(id) {
  const inv = invs().find((i) => i.id === id)
  if (inv) inv.copies = (inv.copies || 0) + 1
  return inv?.copies || 0
}

// ---------- รอบ O: สินทรัพย์ถาวร · ล่วงหน้า · ค่าใช้จ่ายประจำ · ผ่อนชำระ ----------
const lst = (k) => (A()[k] ||= [])
const validDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d)) && !Number.isNaN(Date.parse(d)) && new Date(d).toISOString().slice(0, 10) === d
const cashOf = (m) => (m === 'bank' ? '1020' : '1010')
const lastOfMonth = (ym) => { const [y, m] = ym.split('-').map(Number); return toDateStr(new Date(y, m, 0)) }
// สร้างรายการลงบัญชีที่ผูกกับเอกสารต้นทาง (ข้ามสิทธิ์ตามเจ้าของฟังก์ชันที่เรียก ซึ่งตรวจสิทธิ์ไปแล้ว)
function book(date, memo, lines, source, tax) {
  return commit({ date, memo, lines: lines.filter((l) => (l.dr || l.cr)), source: { type: 'manual', ...source }, ...(tax ? { tax } : {}) }, null, 'JV')
}
const removeBooking = (id) => {
  const i = A().entries.findIndex((e) => e.id === id)
  if (i < 0) return null
  const e = A().entries[i]
  if (locked(e.date)) return 'รายการซื้อ/บันทึกอยู่ในงวดที่ปิดแล้ว ลบไม่ได้ (กลับรายการแทน)'
  A().entries.splice(i, 1)
  return null
}

// --- สินทรัพย์ถาวร ---
export const ASSET_CATS = ASSET_CATEGORIES
export const assets = () => lst('assets')
export const taxRateOf = (cat) => Number(A().settings.taxDeprRates?.[cat] ?? ASSET_CATEGORIES.find((c) => c.id === cat)?.taxRate ?? 20)
export const assetSchedule = (a) => deprSchedule({ ...a, disposalDate: a.disposal?.date || '' })
export const assetTaxDepr = (a) => taxDeprByYear({ ...a, disposalDate: a.disposal?.date || '' }, taxRateOf(a.category))
const deprStarted = (a) => assetSchedule(a).some((r) => r.date <= today())
export function saveAsset(d, id = null) {
  const g = guard('acctAssets')
  if (g) return g
  const cur = id ? assets().find((x) => x.id === id) : null
  if (id && !cur) return { error: 'ไม่พบสินทรัพย์' }
  const name = String(d.name ?? '').trim().slice(0, 100)
  if (!name) return { error: 'กรอกชื่อสินทรัพย์' }
  const cat = ASSET_CATEGORIES.some((c) => c.id === d.category) ? d.category : 'other'
  const note = String(d.note ?? '').trim().slice(0, 300)
  if (cur && deprStarted(cur)) { Object.assign(cur, { name, category: cat, note }); return { ok: true, asset: cur } }
  const cost = Number(d.cost), salvage = Number(d.salvage || 0), life = Number(d.lifeYears)
  const min = Number(A().settings.assetMinCost ?? 500)
  if (!(cost > 0)) return { error: 'ใส่ราคาทุนมากกว่า 0' }
  if (cost < min) return { error: `ราคาต่ำกว่า ${min} บาท ให้บันทึกเป็นค่าใช้จ่ายทันที ไม่ต้องตั้งเป็นสินทรัพย์` }
  if (!(salvage >= 0) || salvage >= cost) return { error: 'มูลค่าซากต้องไม่ติดลบและน้อยกว่าราคาทุน' }
  if (!(life > 0) || life > 100) return { error: 'อายุใช้งาน (ปี) ต้องมากกว่า 0' }
  const method = d.method === 'db' ? 'db' : 'sl'
  const rate = Number(d.rate || 0)
  if (method === 'db' && !(rate > 0 && rate <= 100)) return { error: 'ใส่อัตราค่าเสื่อม % ต่อปี (0–100) สำหรับวิธียอดลดลง' }
  if (!validDate(d.buyDate) || !validDate(d.startDate)) return { error: 'วันที่ไม่ถูกต้อง' }
  if (d.startDate < d.buyDate) return { error: 'วันที่เริ่มใช้ต้องไม่ก่อนวันที่ซื้อ' }
  const acquire = ['cash', 'bank', 'payable', 'none'].includes(d.acquire) ? d.acquire : 'none'
  const a = cur || { id: aid('as'), code: `AS-${String((A().seq.AS = (A().seq.AS || 0) + 1)).padStart(3, '0')}`, createdAt: new Date().toISOString(), disposal: null }
  if (!cur) {
    if (acquire !== 'none') {
      const r = book(d.buyDate, `ซื้อสินทรัพย์ ${name}`, [{ account: '1500', dr: toB(toS(cost)) }, { account: acquire === 'payable' ? '2100' : cashOf(acquire), cr: toB(toS(cost)) }], { kind: 'asset', assetId: a.id, ...(acquire === 'payable' ? { settle: 'payable', total: toB(toS(cost)) } : {}) })
      if (r.error) { A().seq.AS--; return r }
      a.bookingId = r.entry.id
    }
    lst('assets').push(a)
  }
  Object.assign(a, { name, category: cat, note, buyDate: d.buyDate, startDate: d.startDate, cost: toB(toS(cost)), salvage: toB(toS(salvage)), lifeYears: life, method, rate: method === 'db' ? rate : 0, acquire })
  return { ok: true, asset: a }
}
export function disposeAsset(id, { date, proceeds = 0, method = 'cash' } = {}) {
  const g = guard('acctAssets')
  if (g) return g
  const a = assets().find((x) => x.id === id)
  if (!a) return { error: 'ไม่พบสินทรัพย์' }
  if (a.disposal) return { error: 'จำหน่ายไปแล้ว' }
  if (!validDate(date)) return { error: 'วันที่ไม่ถูกต้อง' }
  if (date < a.startDate) return { error: 'วันที่จำหน่ายต้องไม่ก่อนวันที่เริ่มใช้' }
  if (date > today()) return { error: 'วันที่จำหน่ายเป็นอนาคตไม่ได้' }
  if (locked(date)) return { error: `งวดถึง ${A().closedThrough} ปิดแล้ว จำหน่ายในวันนั้นไม่ได้` }
  const p = Number(proceeds || 0)
  if (!(p >= 0)) return { error: 'ยอดขายต้องไม่ติดลบ' }
  a.disposal = { date, proceeds: toB(toS(p)), method: method === 'bank' ? 'bank' : 'cash', at: new Date().toISOString(), by: session.userId }
  return { ok: true }
}
export function removeAsset(id) {
  const g = guard('acctAssets')
  if (g) return g
  const a = assets().find((x) => x.id === id)
  if (!a) return { error: 'ไม่พบสินทรัพย์' }
  if (a.disposal || deprStarted(a)) return { error: 'เริ่มตัดค่าเสื่อม/จำหน่ายแล้ว ลบไม่ได้ (ใช้จำหน่ายแทน)' }
  if (a.bookingId) { const e = removeBooking(a.bookingId); if (e) return { error: e } }
  A().assets = assets().filter((x) => x.id !== id)
  return { ok: true }
}
// ตัวสร้างรายการอัตโนมัติ: ค่าเสื่อมรายเดือน (ลงเมื่อสิ้นเดือนผ่านไปแล้ว) · จำหน่ายสินทรัพย์ · ตัดจำหน่ายล่วงหน้า
function planEntries(c) {
  const out = []
  const t = c.todayStr
  for (const a of c.acct.assets || []) {
    const sch = deprSchedule({ ...a, disposalDate: a.disposal?.date || '' })
    for (const r of sch) {
      const isDisp = a.disposal && r.ym === a.disposal.date.slice(0, 7)
      const date = isDisp ? a.disposal.date : r.date
      if (date > t || r.amount <= 0) continue
      out.push({ id: `depr:${a.id}:${r.ym}`, date, memo: `ค่าเสื่อมราคา ${a.name} ${r.ym}`, source: { type: 'asset-depr', assetId: a.id }, auto: true, lines: [{ account: '5800', dr: r.amount }, { account: '1590', cr: r.amount }] })
    }
    if (a.disposal && a.disposal.date <= t) {
      const accum = sch.length ? sch.at(-1).accum : 0
      const cost = toS(a.cost), ac = toS(accum), pr = toS(a.disposal.proceeds)
      const diff = pr - (cost - ac)
      const lines = [
        { account: a.disposal.method === 'bank' ? '1020' : '1010', dr: toB(pr) }, { account: '1590', dr: toB(ac) },
        { account: '5820', dr: toB(Math.max(0, -diff)) }, { account: '1500', cr: toB(cost) }, { account: '4810', cr: toB(Math.max(0, diff)) },
      ].filter((l) => l.dr || l.cr)
      out.push({ id: `dispose:${a.id}`, date: a.disposal.date, memo: `จำหน่ายสินทรัพย์ ${a.name}`, source: { type: 'asset-dispose', assetId: a.id }, auto: true, lines })
    }
  }
  for (const d of c.acct.deferrals || []) {
    for (const r of amortSchedule(d.total, d.months, d.startMonth)) {
      if (r.date > t) continue
      const lines = d.kind === 'unearned' ? [{ account: '2350', dr: r.amount }, { account: d.account, cr: r.amount }] : [{ account: d.account, dr: r.amount }, { account: '1300', cr: r.amount }]
      out.push({ id: `defer:${d.id}:${r.ym}`, date: r.date, memo: `ตัดจำหน่าย${d.kind === 'unearned' ? 'รายได้รับล่วงหน้า' : 'ค่าใช้จ่ายล่วงหน้า'} ${d.name} งวด ${r.no}/${d.months}`, source: { type: 'deferral', deferralId: d.id }, auto: true, lines })
    }
  }
  return out
}
extraGenerators.push(planEntries)

// --- รายได้/ค่าใช้จ่ายล่วงหน้า ---
export const deferrals = () => lst('deferrals')
export function saveDeferral(d) {
  const g = guard()
  if (g) return g
  const kind = d.kind === 'unearned' ? 'unearned' : 'prepaid'
  const name = String(d.name ?? '').trim().slice(0, 100)
  const total = Number(d.total), months = Math.round(Number(d.months))
  if (!name) return { error: 'กรอกชื่อรายการ' }
  if (!(total > 0)) return { error: 'ใส่จำนวนเงินมากกว่า 0' }
  if (!(months >= 1 && months <= 120)) return { error: 'จำนวนเดือนต้อง 1–120' }
  if (!/^\d{4}-\d{2}$/.test(String(d.startMonth))) return { error: 'เลือกเดือนที่เริ่มตัดจำหน่าย' }
  if (!validDate(d.payDate)) return { error: 'วันที่รับ/จ่ายเงินไม่ถูกต้อง' }
  const acc = accountOf(d.account)
  if (!acc || acc.kind !== (kind === 'unearned' ? 'revenue' : 'expense')) return { error: kind === 'unearned' ? 'เลือกบัญชีรายได้ที่จะรับรู้' : 'เลือกบัญชีค่าใช้จ่ายที่จะตัด' }
  const method = ['cash', 'bank', 'payable'].includes(d.method) ? d.method : 'cash'
  if (kind === 'unearned' && method === 'payable') return { error: 'รายได้รับล่วงหน้าเลือกค้างจ่ายไม่ได้' }
  const id = aid('df')
  const amt = toB(toS(total))
  const lines = kind === 'unearned' ? [{ account: cashOf(method), dr: amt }, { account: '2350', cr: amt }] : [{ account: '1300', dr: amt }, { account: method === 'payable' ? '2100' : cashOf(method), cr: amt }]
  const r = book(d.payDate, `${kind === 'unearned' ? 'รับเงินล่วงหน้า' : 'จ่ายล่วงหน้า'} ${name}`, lines, { kind: 'deferral', deferralId: id, ...(method === 'payable' ? { settle: 'payable', total: amt } : {}) })
  if (r.error) return r
  const x = { id, kind, name, total: amt, months, startMonth: d.startMonth, account: d.account, payDate: d.payDate, method, bookingId: r.entry.id, createdAt: new Date().toISOString() }
  lst('deferrals').push(x)
  return { ok: true, deferral: x }
}
export const deferralRows = (d) => amortSchedule(d.total, d.months, d.startMonth).map((r) => ({ ...r, posted: r.date <= today() }))
export function removeDeferral(id) {
  const g = guard()
  if (g) return g
  const d = deferrals().find((x) => x.id === id)
  if (!d) return { error: 'ไม่พบรายการ' }
  if (deferralRows(d).some((r) => r.posted)) return { error: 'เริ่มตัดจำหน่ายแล้ว ลบไม่ได้' }
  const e = removeBooking(d.bookingId)
  if (e) return { error: e }
  A().deferrals = deferrals().filter((x) => x.id !== id)
  return { ok: true }
}

// --- ค่าใช้จ่ายประจำเดือน ---
export const recurring = () => lst('recurring')
const rForm = (t, ym, o = {}) => ({ kind: 'expense', date: o.date || recurringDue(t, ym), account: t.account, amount: o.amount ?? t.amount, vatMode: t.vatMode || 'none', vatRate: t.vatRate || 7, claimable: !!t.claimable, settle: t.settle || 'cash', payee: t.payee || '', memo: o.memo ?? `${t.name} ${ym}`, recurringId: t.id, recurringYm: ym })
export function saveRecurring(d, id = null) {
  const g = guard()
  if (g) return g
  const cur = id ? recurring().find((x) => x.id === id) : null
  if (id && !cur) return { error: 'ไม่พบรายการ' }
  const name = String(d.name ?? '').trim().slice(0, 100)
  if (!name) return { error: 'กรอกชื่อรายการ' }
  const acc = accountOf(d.account)
  if (!acc || acc.kind !== 'expense') return { error: 'เลือกบัญชีค่าใช้จ่าย' }
  const kind = d.kind === 'variable' ? 'variable' : 'fixed'
  const amount = Number(d.amount || 0), estimate = Number(d.estimate || 0)
  if (kind === 'fixed' && !(amount > 0)) return { error: 'ค่าใช้จ่ายคงที่ต้องใส่จำนวนเงินมากกว่า 0' }
  if (kind === 'variable' && !(estimate >= 0)) return { error: 'ประมาณการต้องไม่ติดลบ' }
  const dueDay = Math.round(Number(d.dueDay))
  if (!(dueDay >= 1 && dueDay <= 31)) return { error: 'วันครบกำหนดต้อง 1–31' }
  const grace = Math.round(Number(d.graceDays ?? 3))
  if (!(grace >= 0 && grace <= 30)) return { error: 'วันผ่อนผันต้อง 0–30' }
  const settle = ['cash', 'bank', 'payable'].includes(d.settle) ? d.settle : 'cash'
  const t = {
    name, account: d.account, kind, amount: kind === 'fixed' ? toB(toS(amount)) : 0, estimate: kind === 'variable' ? toB(toS(estimate)) : 0, dueDay, graceDays: grace,
    vatMode: ['none', 'included', 'excluded'].includes(d.vatMode) ? d.vatMode : 'none', vatRate: Number(d.vatRate) || 7, claimable: !!d.claimable, payee: String(d.payee ?? '').trim().slice(0, 100), settle,
    autoPost: kind === 'fixed' && !!d.autoPost, startMonth: /^\d{4}-\d{2}$/.test(String(d.startMonth)) ? d.startMonth : thisMonth(), active: d.active !== false,
  }
  if (cur) { Object.assign(cur, t); return { ok: true, item: cur } }
  const x = { id: aid('rc'), createdAt: new Date().toISOString(), ...t }
  lst('recurring').push(x)
  return { ok: true, item: x }
}
export function removeRecurring(id) {
  const g = guard()
  if (g) return g
  const t = recurring().find((x) => x.id === id)
  if (!t) return { error: 'ไม่พบรายการ' }
  // ไม่ลบประวัติ: ถ้าเคยบันทึกแล้วให้ปิดใช้งานแทน
  if (A().entries.some((e) => e.source?.recurringId === id)) { t.active = false; return { ok: true, deactivated: true } }
  A().recurring = recurring().filter((x) => x.id !== id)
  return { ok: true }
}
const postedOf = (t, ym) => A().entries.find((e) => e.source?.recurringId === t.id && e.source?.recurringYm === ym && !e.reversedBy)
const skipOf = (t, ym) => lst('recurringSkips').find((s) => s.recurringId === t.id && s.ym === ym)
export function recurringStatus(ym = thisMonth(), todayStr = today()) {
  return recurring().map((t) => ({ t, ym, due: recurringDue(t, ym), posted: postedOf(t, ym) || null, skip: skipOf(t, ym) || null, state: recurringState(t, ym, { posted: !!postedOf(t, ym), skipped: !!skipOf(t, ym), today: todayStr }) }))
}
export function postRecurring(id, ym, { amount, date, memo } = {}, system = false) {
  if (!system) { const g = guard(); if (g) return g }
  const t = recurring().find((x) => x.id === id)
  if (!t) return { error: 'ไม่พบรายการ' }
  if (postedOf(t, ym)) return { error: 'บันทึกเดือนนี้แล้ว' }
  const amt = amount ?? t.amount
  if (!(Number(amt) > 0)) return { error: 'ใส่จำนวนเงินของเดือนนี้' }
  const r = buildManualEntry(rForm(t, ym, { amount: amt, date, memo }))
  if (r.error) return r
  const c = commit(r.entry, null, 'JV')
  if (c.ok) { const s = lst('recurringSkips'); const i = s.findIndex((x) => x.recurringId === id && x.ym === ym); if (i >= 0) s.splice(i, 1); }
  return c
}
export function skipRecurring(id, ym, reason) {
  const g = guard()
  if (g) return g
  const t = recurring().find((x) => x.id === id)
  if (!t) return { error: 'ไม่พบรายการ' }
  if (postedOf(t, ym)) return { error: 'บันทึกเดือนนี้แล้ว' }
  if (!String(reason || '').trim()) return { error: 'ระบุเหตุผลที่ข้ามเดือนนี้' }
  lst('recurringSkips').push({ recurringId: id, ym, reason: String(reason).trim().slice(0, 200), by: session.userId, at: new Date().toISOString() })
  return { ok: true }
}

// --- ผ่อนชำระ (เงินกู้ / ซื้อผ่อน) ---
export const installments = () => lst('installments')
export const installmentRows = (x) => loanSchedule(x).map((r) => ({ ...r, paid: x.payments.find((p) => p.no === r.no) || null }))
export function saveInstallment(d) {
  const g = guard()
  if (g) return g
  const kind = d.kind === 'purchase' ? 'purchase' : 'loan'
  const name = String(d.name ?? '').trim().slice(0, 100)
  const principal = Number(d.principal), rate = Number(d.ratePct || 0), n = Math.round(Number(d.n))
  if (!name) return { error: 'กรอกชื่อรายการ' }
  if (!(principal > 0)) return { error: 'ใส่ยอดเงินต้นมากกว่า 0' }
  if (!(rate >= 0 && rate <= 100)) return { error: 'ดอกเบี้ยต้อง 0–100% ต่อปี' }
  if (!(n >= 1 && n <= 360)) return { error: 'จำนวนงวดต้อง 1–360' }
  if (!validDate(d.startDate) || !validDate(d.firstDue)) return { error: 'วันที่ไม่ถูกต้อง' }
  if (d.firstDue < d.startDate) return { error: 'งวดแรกต้องไม่ก่อนวันที่เริ่ม' }
  const method = d.method === 'flat' ? 'flat' : 'reducing'
  const receive = d.receive === 'bank' ? 'bank' : 'cash'
  let debit = cashOf(receive)
  if (kind === 'purchase') {
    const acc = accountOf(d.account)
    if (!acc || !['asset', 'expense'].includes(acc.kind) || ['1010', '1020', '2400'].includes(d.account)) return { error: 'เลือกบัญชีสินทรัพย์/ค่าใช้จ่ายที่ซื้อมา' }
    debit = d.account
  }
  const id = aid('in')
  const amt = toB(toS(principal))
  const r = book(d.startDate, kind === 'loan' ? `รับเงินกู้ ${name}` : `ซื้อผ่อน ${name}`, [{ account: debit, dr: amt }, { account: '2400', cr: amt }], { kind: 'loan', installmentId: id })
  if (r.error) return r
  const x = { id, kind, name, principal: amt, ratePct: rate, n, method, startDate: d.startDate, firstDue: d.firstDue, receive, account: debit, payments: [], bookingId: r.entry.id, createdAt: new Date().toISOString() }
  lst('installments').push(x)
  return { ok: true, installment: x }
}
// จ่ายงวดถัดไปตามลำดับ: Dr เงินต้น 2400 + ดอกเบี้ย 5810 / Cr เงินสด/ธนาคาร
export function payInstallment(id, { date = today(), method = 'bank' } = {}) {
  const g = guard()
  if (g) return g
  const x = installments().find((v) => v.id === id)
  if (!x) return { error: 'ไม่พบรายการ' }
  const row = installmentRows(x).find((r) => !r.paid)
  if (!row) return { error: 'ชำระครบทุกงวดแล้ว' }
  if (!validDate(date)) return { error: 'วันที่ไม่ถูกต้อง' }
  const lines = [{ account: '2400', dr: row.principal }, { account: '5810', dr: row.interest }, { account: cashOf(method), cr: row.payment }]
  const r = book(date, `ผ่อนชำระ ${x.name} งวด ${row.no}/${x.n}`, lines, { kind: 'installment', installmentId: id, no: row.no })
  if (r.error) return r
  x.payments.push({ no: row.no, date, entryId: r.entry.id, method: method === 'cash' ? 'cash' : 'bank' })
  return { ok: true, entry: r.entry }
}
export function removeInstallment(id) {
  const g = guard()
  if (g) return g
  const x = installments().find((v) => v.id === id)
  if (!x) return { error: 'ไม่พบรายการ' }
  if (x.payments.length) return { error: 'มีการชำระแล้ว ลบไม่ได้' }
  const e = removeBooking(x.bookingId)
  if (e) return { error: e }
  A().installments = installments().filter((v) => v.id !== id)
  return { ok: true }
}
// งวดใกล้ครบกำหนด (ภายใน days วัน) หรือเลยกำหนด ที่ยังไม่ชำระ
export function installmentAlerts(todayStr = today(), days = 3) {
  const out = []
  for (const x of installments()) {
    const row = installmentRows(x).find((r) => !r.paid)
    if (row && row.due <= addDays(todayStr, days)) out.push({ x, row, overdue: row.due < todayStr })
  }
  return out
}
// สรุปเตือนสำหรับหน้าภาพรวม
export function acctAlerts(todayStr = today()) {
  const ym = todayStr.slice(0, 7)
  const rec = [...recurringStatus(addMonths(ym, -1), todayStr), ...recurringStatus(ym, todayStr)].filter((r) => r.state === 'missing' || r.state === 'due')
  return { recurring: rec, installments: installmentAlerts(todayStr) }
}

// ---------- ตรวจตามเวลา (เรียกจาก runScheduledChecks ของ store) ----------
export function runAcctChecks(once, todayStr = today()) {
  let n = 0
  const ym = prevMonth(todayStr.slice(0, 7))
  for (const m of [ym]) {
    const s = vatSummary(allEntries(), m)
    if (!s.outputCount && !s.inputCount) continue
    if (vatFiled(m)) continue
    const due = vatDue(m)
    if (todayStr >= due.online) once(`vatdue|${m}`, () => (n += notify('team_vat_due', { vars: { เดือนภาษี: m, ชำระก่อน: due.online } }), 0))
  }
  // ค่าใช้จ่ายประจำ: บันทึกอัตโนมัติ (คงที่ + autoPost) / เตือนที่ยังไม่บันทึก
  for (const m of [addMonths(todayStr.slice(0, 7), -1), todayStr.slice(0, 7)]) {
    for (const r of recurringStatus(m, todayStr)) {
      if (r.state !== 'missing' && r.state !== 'due') continue
      if (r.t.autoPost && r.t.kind === 'fixed' && !locked(r.due) && !(r.t.vatMode !== 'none' && vatFiled(r.due.slice(0, 7)))) { postRecurring(r.t.id, m, {}, true); continue }
      if (r.state === 'missing') once(`expmiss|${r.t.id}|${m}`, () => (n += notify('team_expense_missing', { vars: { รายการ: r.t.name, เดือนภาษี: m, วันที่: r.due } }), 0))
    }
  }
  for (const a of installmentAlerts(todayStr, 1)) once(`instdue|${a.x.id}|${a.row.no}`, () => (n += notify('team_installment_due', { vars: { รายการ: a.x.name, งวด: String(a.row.no), วันที่: a.row.due, ยอดรวม: String(a.row.payment) } }), 0))
  return n
}

scheduledHooks.push(runAcctChecks)
