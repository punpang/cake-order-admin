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

const A = () => db.acct
let seq = 0
const aid = (p) => `${p}${Date.now().toString(36)}${++seq}`
const today = () => toDateStr(new Date())

// ตัวสร้างรายการอัตโนมัติเพิ่มเติม (ค่าเสื่อม ตัดจำหน่าย ผ่อนชำระ ฯลฯ ลงทะเบียนในรอบถัด ๆ ไป)
export const extraGenerators = []

const ctx = () => ({
  customerOf: (o) => { const c = findCustomer(o.customerId); return c ? { name: c.tax?.name || c.name, taxId: c.tax?.taxId || '' } : null },
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
export const sourceLabel = (e) => ({ manual: 'บันทึกเอง', 'order-pay': 'รับชำระออร์เดอร์', 'order-payx': 'ยกเลิกยอดชำระ', 'order-deliver': 'ส่งมอบ/รับรู้รายได้', 'order-cancel': 'ยกเลิก/คืนเงิน', 'order-cancel-rev': 'ยกเลิก/กลับรายการ', reward: 'ของรางวัล' }[e.source?.type] || e.source?.type || '')

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
  return n
}
scheduledHooks.push(runAcctChecks)
