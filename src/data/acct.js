// ระบบบัญชี (จำลองในหน่วยความจำ · จุดที่จะเปลี่ยนเป็น Supabase) · ตรรกะคำนวณอยู่ใน src/lib/acct (ฟังก์ชันล้วน)
// หมายเหตุ: store.js ไม่ import ไฟล์นี้ (กัน import วน) — หน้าที่ต้องใช้ import จากไฟล์นี้โดยตรง
import { supabaseEnabled, getSupabase } from '../lib/supabase'
import { reactive } from 'vue'
import { readSessionToken } from '../lib/customerRemote'
import { MAX_CUSTOMER_REVISIONS, cleanBuyer, buyerError, sellerCheck, customerInvoiceState, buildInvoice, buildCreditNote, buildPartialCreditNote, remainingOf, partialCreditBlock } from '../lib/taxInvoice'
import { round2 } from '../lib/posPromo'
import { db, session, can, ctxOrder, scheduledHooks, cancelHooks, refundHooks, refundGuards, notify, findCustomer, customerSession, myCustomer } from './store'
import { deriveAll } from '../lib/acct/derive'
import { buildManualEntry } from '../lib/acct/manual'
import { validateEntry, entryNo, entrySums } from '../lib/acct/journal'
import { trialBalance, incomeStatement, ledger, sums, balanceOf } from '../lib/acct/reports'
import { accountMap, KIND_LABEL } from '../lib/acct/chart'
import { toDateStr } from '../lib/format'
import { toS, toB } from '../lib/acct/money'
import { vatSummary, vatDue, vatStatus, prevMonth, nextMonth } from '../lib/acct/vat'
import { bahtText } from '../lib/acct/thaiBaht'
import { addressChoices } from '../lib/thaiAddress'
import { orderTotals } from '../lib/pricing'
import { deprSchedule, deprAccum, taxDeprByYear, taxDeprByMonth, amortSchedule, loanSchedule, recurringDue, recurringState, addDays, ASSET_CATEGORIES } from '../lib/acct/plan'
import { thisMonth, addMonths, monthRange } from '../lib/acct/period'
import { balanceSheet, cashFlow, equityStatement, comparePeriods, compareStatements } from '../lib/acct/statements'
import { DEFAULT_TAX_TABLE, cloneTable, juristicAnnual, individualAnnual, compareMethods, pnd51, pnd94Estimate, entertainmentCap, smeEligible } from '../lib/acct/tax'

const A = () => db.acct
let seq = 0
const aid = (p) => `${p}${Date.now().toString(36)}${++seq}`
const today = () => toDateStr(new Date())

// ตัวสร้างรายการอัตโนมัติเพิ่มเติม (ค่าเสื่อม ตัดจำหน่าย ผ่อนชำระ ฯลฯ ลงทะเบียนในรอบถัด ๆ ไป)
export const extraGenerators = []

// ออร์เดอร์สั่งล่วงหน้าทั้งหมดสำหรับบัญชี (โหลดตอนเปิดหน้าบัญชีผ่าน preorder-admin · accounting) · error = โหลดไม่ได้ ทำให้ยอดบัญชีขาดส่วนนี้
export const preorderAcct = reactive({ orders: [], error: '' })

const ctx = () => ({
  customerOf: (o) => { const c = findCustomer(o.customerId); return c ? { name: c.tax?.name || c.name, taxId: c.tax?.taxId || '' } : null },
  todayStr: today(),
  orders: db.orders, groups: db.optionGroups, retail: db.retailItems, ingredients: db.ingredients,
  coupons: db.coupons, rewards: db.rewards, pointValue: db.loyalty.pointValue, acct: db.acct, shop: db.shop,
  preorders: preorderAcct.orders,
})

// รายการอัตโนมัติ (ทั้งหมด ไม่สนปิดงวด)
export const derivedEntries = () => deriveAll(ctx(), extraGenerators)

// รายการทั้งหมดที่ใช้ในรายงาน = บันทึกเอง + ที่แช่แข็งตอนปิดงวด + ดึงอัตโนมัติหลังวันที่ปิดงวด (เรียงตามวัน พร้อมเลขที่)
// ---------- โหลดรายละเอียดเฉพาะช่วงล่าสุด (ตั้งโดย lib/acctSync.js ผ่าน onFetchers) ----------
// A().loadedCut = รายการบันทึกเอง/แช่แข็งที่ลงวันที่ถึงวันนี้ อยู่ในรูปยอดยกมา A().opening · '' = มีรายละเอียดครบ
// extend(newCut) → Promise · orderInvoices(id) · invoiceYear(y) · ไม่ตั้ง = โหมดตัวอย่าง (ข้อมูลครบในเครื่อง)
export const acctFetch = { extend: null, orderInvoices: null, invoiceYear: null }
const prevDayOf = (ymd) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10) }
// รายงานที่ต้องการรายละเอียดถึงวันที่ maxCut ('' = ทั้งหมด) → ดึงเพิ่มเบื้องหลัง แล้วหน้าจอคำนวณใหม่เอง
export function needCut(maxCut = '') {
  const cut = A().loadedCut
  if (!cut || !acctFetch.extend) return Promise.resolve(true)
  if (maxCut && maxCut >= cut) return Promise.resolve(true)
  return acctFetch.extend(maxCut)
}
export const needFrom = (from) => needCut(from ? prevDayOf(from) : '')
// มีรายละเอียดครบตั้งแต่วันที่ from หรือยัง (ใช้ตัดสินก่อนทำรายการที่ต้องเห็นรายการเก่า เช่น เปิดงวดย้อน)
export const loadedFrom = (from) => !A().loadedCut || (!!from && prevDayOf(from) >= A().loadedCut)
export const ensureOrderInvoices = (orderId) => (acctFetch.orderInvoices ? acctFetch.orderInvoices(orderId) : Promise.resolve(true))
export const ensureInvoiceYear = (year) => (acctFetch.invoiceYear ? acctFetch.invoiceYear(year) : Promise.resolve(true))

export function allEntries() {
  const closed = A().closedThrough
  const auto = derivedEntries().filter((e) => !closed || e.date > closed)
  const rows = [...(A().opening ? [A().opening] : []), ...A().entries.map((e) => ({ ...e, no: e.no })), ...A().frozen, ...auto]
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.createdAt || a.id) < (b.createdAt || b.id) ? -1 : 1))
  return rows
}
export const activeAccounts = () => A().accounts.filter((a) => a.active !== false)
export const accountOf = (id) => accountMap(A().accounts).get(id)
export const locked = (date) => !!A().closedThrough && date <= A().closedThrough
export const sourceLabel = (e) => ({ 'asset-depr': 'ค่าเสื่อมราคา', 'asset-dispose': 'จำหน่ายสินทรัพย์', deferral: 'ตัดจำหน่ายล่วงหน้า', manual: 'บันทึกเอง', 'order-pay': 'รับชำระออร์เดอร์', 'order-payx': 'ยกเลิกยอดชำระ', 'order-deliver': 'ส่งมอบ/รับรู้รายได้', 'order-cancel': 'ยกเลิก/คืนเงิน', 'order-cancel-rev': 'ยกเลิก/กลับรายการ', reward: 'ของรางวัล', opening: 'ยอดยกมา' }[e.source?.type] || e.source?.type || '')

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
  // รายการแช่แข็งหลังวันใหม่ต้องอยู่ในเครื่องครบก่อน (ไม่งั้นลบไม่ครบ) → ดึงก่อน แล้วให้ทำซ้ำ
  if (!loadedFrom(toDate ? addDays(toDate, 1) : '')) { needCut(toDate); return { error: 'กำลังโหลดรายการบัญชีช่วงนั้น ลองอีกครั้งในอีกสักครู่' } }
  A().frozen = A().frozen.filter((e) => !!toDate && e.date <= toDate)
  A().closedThrough = toDate
  return { ok: true }
}

// ---------- รายงาน (ห่อฟังก์ชันล้วนด้วยข้อมูลปัจจุบัน) ----------
export const reportTrialBalance = (asOf = '') => { if (asOf) needCut(asOf); return trialBalance(allEntries(), A().accounts, asOf) }
export const reportIncome = (from, to) => { if (from) needFrom(from); return incomeStatement(allEntries(), A().accounts, from, to) }
export const reportLedger = (accountId, from = '', to = '') => { needFrom(from); return ledger(allEntries(), A().accounts, accountId, from, to) } // ไม่ระบุวันเริ่ม = แสดงทุกรายการ → ต้องมีรายละเอียดครบ
export function cashPosition(asOf = '') {
  if (asOf) needCut(asOf)
  const m = sums(allEntries(), '', asOf)
  const bal = (id) => balanceOf(accountOf(id), m.get(id))
  return { cash: bal('1010'), bank: bal('1020'), total: toB(toS(bal('1010')) + toS(bal('1020'))) }
}

// ---------- ภาษีมูลค่าเพิ่ม (ภ.พ.30) ----------
const filings = () => (A().vatFilings ||= {})
export const vatFiled = (ym) => !!filings()[ym]?.filedAt
export const vatFilingOf = (ym) => filings()[ym] || null
// VAT: ต้องมีรายละเอียดของเดือนนั้น และย้อนได้ถึง 25 เดือน (ยอดเกินยกมาคำนวณย้อนสูงสุด 24 เดือน)
const needVat = (ym) => needFrom(`${addMonths(ym, -25)}-01`)
export const vatReport = (ym) => {
  needVat(ym)
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
  if (!loadedFrom(`${addMonths(ym, -25)}-01`)) { needVat(ym); return { error: 'กำลังโหลดรายการบัญชีช่วงก่อนหน้า ลองอีกครั้งในอีกสักครู่' } } // ภาพบันทึกตอนยื่นต้องมาจากข้อมูลครบ
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
const sellerOk = () => sellerCheck(db.shop.vat)
// ตรวจก่อนออกใบ: คืนข้อความผิดพลาด หรือ ''
export function invoiceBlock(order, buyer = null) {
  if (!order?.vat || !(Number(order.vat.rate) > 0)) return 'ออร์เดอร์นี้ไม่ได้คิด VAT'
  if (order.status === 'cancelled' || order.status === 'draft') return 'ออร์เดอร์นี้ออกใบกำกับภาษีไม่ได้'
  if (invoiceOfOrder(order.id)) return 'ออกใบกำกับภาษีของออร์เดอร์นี้แล้ว (แก้ไขใบเดิมได้จากหน้าใบกำกับภาษี)'
  const t = orderTotals(order)
  if (t.balance > 0.004) return 'ชำระยังไม่ครบ (ออกใบกำกับภาษีเมื่อรับชำระครบ)'
  if (!(t.vat > 0)) return 'ไม่มี VAT ในออร์เดอร์นี้'
  const s = sellerOk()
  if (s) return s
  return buyerError(buyer || buyerOf(order))
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
  return issueCore(order, buyer ? cleanBuyer(buyer) : buyerOf(order), session.userId)
}
// remaining = { total, vat } เมื่อมีการคืนเงินบางส่วนแล้ว → ใบใหม่ออกด้วยยอดคงเหลือ
function issueCore(order, b, by, rev = 0, remaining = null) {
  const err = invoiceBlock(order, b)
  if (err) return { error: err }
  const date = today()
  const inv = {
    ...buildInvoice({ order, seller: db.shop.vat, buyer: b, id: aid('ti'), by, rev, date, createdAt: new Date().toISOString(), remaining }),
    no: nextDocNo('INV', date),
    ...(supabaseEnabled ? { pending: true } : {}), // รอเลขที่จากฐานข้อมูล (ห้ามพิมพ์จนกว่าจะได้เลข)
  }
  invs().push(inv)
  return { ok: true, invoice: inv }
}
// ยกเลิก = ออกใบลดหนี้เต็มจำนวนอ้างใบเดิม (ใบเดิมไม่ถูกลบ) · ต้องมีเหตุผล
export function voidTaxInvoice(id, reason) {
  const g = guard('taxInvoice')
  if (g) return g
  return voidCore(id, reason, session.userId)
}
function voidCore(id, reason, by) {
  const inv = invs().find((i) => i.id === id)
  if (!inv || inv.type !== 'invoice') return { error: 'ไม่พบใบกำกับภาษี' }
  if (inv.voidedBy) return { error: 'ยกเลิกแล้ว' }
  if (!String(reason || '').trim()) return { error: 'ระบุเหตุผล' }
  const date = today()
  const rem = remainingOf(inv, invs())
  // คืนเงินบางส่วนจนหมดยอดแล้ว → ไม่ออกใบลดหนี้ว่าง ๆ แค่ปิดใบเดิม
  if (rem.total <= 0.004) { inv.voidedBy = rem.lastCreditId; return { ok: true, creditNote: null } }
  // มีการคืนบางส่วนแล้ว → ใบลดหนี้เต็มใบนี้ออกเฉพาะยอดคงเหลือ (กันภาษีถูกคืนซ้ำ)
  const cn = { ...buildCreditNote({ inv, id: aid('ti'), date, reason: String(reason), by, createdAt: new Date().toISOString(), remaining: rem.partial ? rem : null }), no: nextDocNo('CN', date) }
  if (supabaseEnabled) cn.pending = true
  invs().push(cn)
  inv.voidedBy = cn.id
  return { ok: true, creditNote: cn }
}
// แก้ไขข้อมูลผู้ซื้อของใบกำกับที่ออกแล้ว (พนักงาน) → ขั้นเดียว: ออกใบลดหนี้ใบเดิม + ออกใบกำกับใบใหม่ (ใบเดิมยังเก็บไว้)
// ถ้าออกใบใหม่ไม่สำเร็จ ย้อนการยกเลิกทั้งหมด เพื่อไม่ให้ออร์เดอร์เหลือสถานะไม่มีใบ
export function reviseTaxInvoice(invoiceId, buyer) {
  const g = guard('taxInvoice')
  if (g) return g
  const inv = invs().find((i) => i.id === invoiceId && i.type === 'invoice')
  if (!inv) return { error: 'ไม่พบใบกำกับภาษี' }
  if (inv.voidedBy) return { error: 'ใบนี้ถูกยกเลิกแล้ว' }
  const order = db.orders.find((o) => o.id === inv.orderId)
  if (!order) return { error: 'ไม่พบออร์เดอร์' }
  const b = cleanBuyer(buyer || {})
  const err = buyerError(b)
  if (err) return { error: err }
  const old = inv.buyer || {}
  if (['name', 'taxId', 'branch', 'address'].every((k) => String(old[k] ?? '') === String(b[k] ?? ''))) return { error: 'ข้อมูลผู้ซื้อไม่มีการเปลี่ยนแปลง' }
  const rem = remainingOf(inv, invs())
  if (rem.total <= 0.004) return { error: 'ยอดคงเหลือเป็นศูนย์ ไม่ต้องออกใบใหม่' }
  const v = voidCore(inv.id, 'แก้ไขข้อมูลผู้ซื้อ', session.userId)
  if (v.error) return v
  const n = issueCore(order, b, session.userId, inv.rev || 0, rem.partial ? rem : null)
  if (n.error) {
    invs().splice(invs().indexOf(v.creditNote), 1)
    delete inv.voidedBy
    return n
  }
  return { ok: true, creditNote: v.creditNote, invoice: n.invoice }
}
// ยกเลิกออร์เดอร์/บิลที่ออกใบกำกับภาษีไว้แล้ว → ออกใบลดหนี้อัตโนมัติ (ระบบเป็นผู้ออก ไม่ตรวจสิทธิ์) · ลงทะเบียนเป็น hook ของ cancelOrder ใน store
cancelHooks.push((order) => {
  const inv = invoiceOfOrder(order.id)
  if (inv) voidCore(inv.id, `ยกเลิกออร์เดอร์ ${order.code}`, 'system')
})

// ยอดคืนต้องไม่เกินยอดคงเหลือของใบกำกับที่ใช้งานอยู่ (กันลดหนี้เกิน) · ลงทะเบียนเป็น guard ของ refundOrder ใน store
refundGuards.push((order, amount) => {
  const inv = invoiceOfOrder(order.id)
  if (!inv) return ''
  return partialCreditBlock(remainingOf(inv, invs()).total, amount)
})

// คืนเงินบางส่วนของออร์เดอร์ที่มีใบกำกับใช้งานอยู่ → ออกใบลดหนี้บางส่วนอ้างใบเดิม (ใบเดิมไม่ถูกแก้)
// ไม่สร้างรายการบัญชีใหม่: การคืนลงบัญชีอยู่แล้วจาก order.returns
refundHooks.push((order, entry) => {
  const inv = invoiceOfOrder(order.id)
  if (!inv || !(entry.amount > 0)) return
  const itemLines = (entry.items || []).map((x) => ({ name: x.name, qty: x.qty, unitPrice: round2(x.amount / x.qty), amount: x.amount }))
  const itemsSum = round2(itemLines.reduce((n, x) => n + x.amount, 0))
  const lines = itemLines.length && Math.abs(itemsSum - entry.amount) < 0.005 ? itemLines : null
  const date = today()
  const cn = { ...buildPartialCreditNote({ inv, amount: entry.amount, lines, id: aid('ti'), date, reason: entry.reason, by: session.userId, createdAt: new Date().toISOString() }), no: nextDocNo('CN', date) }
  if (supabaseEnabled) cn.pending = true
  invs().push(cn)
  entry.creditNoteId = cn.id
})

// ---------- ลูกค้าขอ/แก้ใบกำกับภาษีเอง (ต้องล็อกอิน · เห็น/ทำได้เฉพาะออร์เดอร์ของตัวเอง) ----------
// โหมดฐานข้อมูล: สถานะ การขอ และการแก้ทำที่ Edge Function tax-invoice (ข้อมูลผู้ขาย ยอด และเลขที่อยู่ที่เซิร์ฟเวอร์) · แอปเก็บเฉพาะสำเนาสถานะล่าสุดใน taxCache
// โหมดจำลอง: คำนวณในเครื่องด้วยกติกาชุดเดียวกัน (src/lib/taxInvoice.js)
export { MAX_CUSTOMER_REVISIONS }
export const taxCache = reactive({}) // orderId → { state } หรือ { error } · 'link:'+token → { state: { history } }
const NET_TAX = 'เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่'
const blankTax = () => ({ name: '', taxId: '', branch: '00000', address: '' })
export const myTaxProfile = () => { const c = myCustomer(); return c ? { ...blankTax(), ...(c.tax || {}) } : null }
// ข้อมูลสำหรับออกใบกำกับ จดจำได้ชุดเดียวต่อลูกค้า (บันทึกซ้ำ = ทับของเดิม)
export function saveMyTaxProfile(t) {
  const c = myCustomer()
  if (!c) return { error: 'ต้องเข้าสู่ระบบ' }
  const b = cleanBuyer(t || {})
  const err = buyerError(b)
  if (err) return { error: err }
  c.tax = b
  return { ok: true }
}
const myOrderOf = (orderId) => {
  const c = myCustomer()
  const o = db.orders.find((x) => x.id === orderId)
  return c && o && o.customerId === c.id ? o : null
}
const cacheKeyOf = (ctx) => (ctx?.token ? `link:${ctx.token}` : ctx?.orderId)
// เอกสารใบกำกับ/ใบลดหนี้ของออร์เดอร์ ตามสิทธิ์ลูกค้า: { orderId } (ล็อกอินเจ้าของ) หรือ { token } (ลิงก์ ดูอย่างเดียว) · ไม่มีสิทธิ์/ไม่เจอ = []
export function customerInvoiceDocs(ctx) {
  if (supabaseEnabled) return taxCache[cacheKeyOf(ctx)]?.state?.history || []
  const o = ctxOrder(ctx)
  if (!o) return []
  return invs().filter((i) => i.orderId === o.id).slice().sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')))
}
// ชิปคัดลอกที่อยู่ให้ลูกค้าที่ล็อกอิน: ที่อยู่ออร์เดอร์ (ถ้าเป็นเจ้าของ) + สถานที่จัดส่งที่จำไว้
export function myAddressChoices(orderId = '') {
  const c = myCustomer()
  if (!c) return []
  const o = orderId ? myOrderOf(orderId) : null
  return addressChoices(c.places || [], o?.fulfillment === 'delivery' ? o.address : '')
}
// สถานะการขอใบของลูกค้า: { eligible, reason, deadline, invoice, history, canEdit, revisionsLeft } · โหมดฐานข้อมูลต้องโหลดก่อนด้วย loadMyTaxState
export function myInvoiceState(orderId) {
  if (supabaseEnabled) return taxCache[orderId]?.state || null
  const o = myOrderOf(orderId)
  if (!o) return null
  return customerInvoiceState(o, invs().filter((i) => i.orderId === o.id), today())
}
// เรียก Edge Function tax-invoice · คืนคำตอบ (มี ok) หรือ { error }
async function callTax(action, body = {}) {
  const c = await getSupabase()
  if (!c) return { error: NET_TAX }
  const payload = action === 'view' ? { action, ...body } : { action, session: readSessionToken(), ...body }
  let r
  try { r = await c.functions.invoke('tax-invoice', { body: payload }) } catch { return { error: NET_TAX } }
  if (r.error) {
    let d = null
    try { d = await r.error.context?.json() } catch { d = null }
    return { error: d?.error || NET_TAX }
  }
  return r.data?.ok ? r.data : { error: r.data?.error || NET_TAX }
}
// โหลดสถานะการขอใบของออร์เดอร์ (ต้องล็อกอินเป็นเจ้าของ)
export async function loadMyTaxState(orderId) {
  if (!supabaseEnabled || !orderId) return
  const r = await callTax('state', { orderId })
  taxCache[orderId] = r.error ? { error: r.error } : { state: r.state }
}
// โหลดเอกสารจากลิงก์ออร์เดอร์ (ดูอย่างเดียว ไม่ต้องล็อกอิน)
export async function loadLinkTaxDocs(token) {
  if (!supabaseEnabled || !token) return
  const r = await callTax('view', { token })
  taxCache[`link:${token}`] = r.error ? { error: r.error } : { state: { history: r.history } }
}
// ขอ/แก้ใบในโหมดฐานข้อมูล: ส่งไปเซิร์ฟเวอร์ แล้วใช้สถานะที่เซิร์ฟเวอร์ตอบกลับ
async function serverTax(action, orderId, buyer, remember) {
  const r = await callTax(action, { orderId, buyer: cleanBuyer(buyer), remember })
  if (r.error) return { error: r.error }
  taxCache[orderId] = { state: r.state }
  if (remember && myCustomer()) myCustomer().tax = cleanBuyer(buyer)
  return { ok: true, invoice: r.invoice }
}
// ขอใบกำกับภาษีเต็มรูป · โหมดฐานข้อมูลคืน Promise (ผลลัพธ์เทียบเท่าโหมดจำลอง)
export function requestMyTaxInvoice(orderId, buyer, remember = true) {
  if (supabaseEnabled) return serverTax('request', orderId, buyer, remember)
  const o = myOrderOf(orderId)
  const st = myInvoiceState(orderId)
  if (!o || !st) return { error: 'ไม่พบออร์เดอร์' }
  if (!st.eligible) return { error: st.reason }
  const b = cleanBuyer(buyer || myTaxProfile() || {})
  const r = issueCore(o, b, `customer:${customerSession.customerId}`)
  if (r.ok && remember) myCustomer().tax = b
  return r
}
// แก้ใบ = ออกใบลดหนี้ใบเดิม แล้วออกใบใหม่ด้วยข้อมูลใหม่ (ภายในกรอบเวลาเดียวกัน จำกัดจำนวนครั้ง)
export function editMyTaxInvoice(orderId, buyer, remember = true) {
  if (supabaseEnabled) return serverTax('edit', orderId, buyer, remember)
  const o = myOrderOf(orderId)
  const st = myInvoiceState(orderId)
  if (!o || !st) return { error: 'ไม่พบออร์เดอร์' }
  if (!st.eligible) return { error: st.reason }
  if (!st.invoice) return { error: 'ยังไม่มีใบกำกับภาษี' }
  if (!st.canEdit) return { error: `แก้ไขได้ไม่เกิน ${MAX_CUSTOMER_REVISIONS} ครั้ง กรุณาติดต่อร้าน` }
  const b = cleanBuyer(buyer || {})
  const err = buyerError(b)
  if (err) return { error: err }
  const rev = (st.invoice.rev || 0) + 1
  const rem = remainingOf(st.invoice, invs())
  if (rem.total <= 0.004) return { error: 'ยอดคงเหลือเป็นศูนย์ ไม่ต้องแก้ไขใบ' }
  const v = voidCore(st.invoice.id, 'ลูกค้าแก้ไขข้อมูลผู้ซื้อ', `customer:${customerSession.customerId}`)
  if (v.error) return v
  const r = issueCore(o, b, `customer:${customerSession.customerId}`, rev, rem.partial ? rem : null)
  if (r.ok && remember) myCustomer().tax = b
  return r
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
  // มีรายละเอียดไม่ครบ (รายการเก่าอยู่ในยอดยกมา) → ปิดใช้งานแทนการลบเสมอ (กันลบรายการที่เคยบันทึกแล้ว)
  if (A().loadedCut || A().entries.some((e) => e.source?.recurringId === id)) { t.active = false; return { ok: true, deactivated: true } }
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

// ---------- รอบ P: รายงาน · งบการเงิน · ภาษีประจำปี ----------
const pad2 = (n) => String(n).padStart(2, '0')
// ปีบัญชีที่ "เริ่มในปี year" ตามเดือนเริ่มปีบัญชี
export function fiscalRange(year) {
  const sm = Number(A().settings.fiscalYearStartMonth) || 1
  const from = `${year}-${pad2(sm)}-01`
  const endYm = addMonths(`${year}-${pad2(sm)}`, 11)
  return { year, from, to: monthRange(endYm).to, label: sm === 1 ? `ปี ${year}` : `ปีบัญชี ${year}/${Number(String(year).slice(2)) + 1}` }
}
// วันแรกของปีบัญชีที่ asOf อยู่
export function fiscalStartOf(asOf) {
  const sm = Number(A().settings.fiscalYearStartMonth) || 1
  const y = Number(asOf.slice(0, 4)), m = Number(asOf.slice(5, 7))
  return `${m >= sm ? y : y - 1}-${pad2(sm)}-01`
}
export function saveAcctSettings(d) {
  const g = guard('acctSettings')
  if (g) return g
  const s = A().settings
  if (d.entityType !== undefined) { if (!['juristic', 'individual'].includes(d.entityType)) return { error: 'ประเภทไม่ถูกต้อง' }; s.entityType = d.entityType }
  if (d.fiscalYearStartMonth !== undefined) {
    const m = Math.round(Number(d.fiscalYearStartMonth))
    if (!(m >= 1 && m <= 12)) return { error: 'เดือนเริ่มปีบัญชีต้อง 1–12' }
    if (m !== s.fiscalYearStartMonth && (A().closedThrough || Object.values(A().taxFilings || {}).some((f) => f.filedAt))) return { error: 'ปิดงวด/ยื่นภาษีแล้ว เปลี่ยนเดือนเริ่มปีบัญชีไม่ได้' }
    s.fiscalYearStartMonth = m
  }
  if (d.paidInCapital !== undefined) { const v = Number(d.paidInCapital); if (!(v >= 0)) return { error: 'ทุนชำระแล้วต้องไม่ติดลบ' }; s.paidInCapital = toB(toS(v)) }
  if (d.assetMinCost !== undefined) { const v = Number(d.assetMinCost); if (!(v >= 0)) return { error: 'เกณฑ์สินทรัพย์ต้องไม่ติดลบ' }; s.assetMinCost = v }
  return { ok: true }
}

export const reportBalanceSheet = (asOf) => { const fy = fiscalStartOf(asOf); needCut(prevDayOf(fy) < asOf ? prevDayOf(fy) : asOf); return balanceSheet(allEntries(), A().accounts, asOf, fy) }
export const reportCashFlow = (from, to) => { needFrom(from); return cashFlow(allEntries(), A().accounts, from, to) }
export const reportEquity = (from, to) => { needFrom(from); return equityStatement(allEntries(), A().accounts, from, to) }
export const reportCompare = (kind, ref) => { const ps = comparePeriods(kind, ref); const froms = ps.map((p) => p.from).filter(Boolean).sort(); needFrom(froms[0] || ''); return compareStatements(allEntries(), A().accounts, ps) }
// สรุปรายงานประจำเดือน/ปี
export function periodSummary(from, to) {
  needFrom(from)
  const entries = allEntries()
  const pl = reportIncome(from, to)
  const m = sums(entries, from, to)
  const dr = (id) => toB(m.get(id)?.dr || 0)
  const asOf = sums(entries, '', to)
  const bal = (id) => { const a = accountOf(id); return a ? balanceOf(a, asOf.get(id)) : 0 }
  let outV = 0, inV = 0
  for (const e of entries) {
    if (!e.tax || e.date < from || e.date > to) continue
    for (const t of e.tax) { if (t.kind === 'output') outV += toS(t.vat); else inV += toS(t.vat) }
  }
  return { from, to, pl, receipts: { cash: dr('1010'), bank: dr('1020') }, vat: { output: toB(outV), input: toB(inV) }, ar: bal('1100'), ap: bal('2100'), depreciation: pl.opex.find((r) => r.account.id === '5800')?.amount || 0, pointsCost: pl.opex.find((r) => r.account.id === '5410')?.amount || 0, couponCost: pl.opex.find((r) => r.account.id === '5420')?.amount || 0 }
}

// --- ภาษีเงินได้ประจำปี ---
export const taxTableOf = (year) => A().taxTables?.[year] || cloneTable()
const okBrackets = (b) => Array.isArray(b) && b.length >= 1 && b.every((x, i) => Number(x.rate) >= 0 && Number(x.rate) <= 100 && (i === b.length - 1 ? x.upTo == null || Number(x.upTo) > 0 : Number(x.upTo) > 0 && (i === 0 || Number(x.upTo) > Number(b[i - 1].upTo)))) && b.at(-1).upTo == null
export function saveTaxTable(year, t) {
  const g = guard('acctSettings')
  if (g) return g
  if (A().taxFilings?.[year]?.filedAt) return { error: 'ปีภาษีนี้ยื่นแล้ว แก้ตารางไม่ได้' }
  const n = cloneTable({ ...DEFAULT_TAX_TABLE, ...t })
  const clean = (b) => b.map((x) => ({ upTo: x.upTo == null || x.upTo === '' ? null : Number(x.upTo), rate: Number(x.rate) }))
  n.progressive = clean(n.progressive); n.sme = clean(n.sme)
  if (!okBrackets(n.progressive) || !okBrackets(n.sme)) return { error: 'ตารางอัตราไม่ถูกต้อง (ขั้นต้องเรียงเพิ่ม อัตรา 0–100 และขั้นสุดท้ายไม่จำกัด)' }
  for (const k of ['corporateRate', 'smeMaxCapital', 'smeMaxRevenue', 'minTaxPct', 'minTaxThreshold', 'lumpPct', 'entertainmentPct', 'entertainmentMax', 'lossYears']) { n[k] = Number(n[k]); if (!(n[k] >= 0)) return { error: 'ค่าในตารางต้องไม่ติดลบ' } }
  ;(A().taxTables ||= {})[year] = n
  return { ok: true }
}
const blankYear = () => ({ adjustments: [], lossForward: 0, prepaid: 0, wht: 0, estimatedAnnual: '', allowances: { personal: 60000, spouse: 0, children: 0, insurance: 0, fund: 0, other: 0 }, method: 'best' })
export const taxYearOf = (year) => ({ ...blankYear(), ...(A().taxYears?.[year] || {}), allowances: { ...blankYear().allowances, ...(A().taxYears?.[year]?.allowances || {}) } })
export function saveTaxYear(year, d) {
  const g = guard('acctTax')
  if (g) return g
  if (A().taxFilings?.[year]?.filedAt) return { error: 'ปีภาษีนี้ยื่นแล้ว แก้ไม่ได้ (ยกเลิกการยื่นก่อน)' }
  const cur = taxYearOf(year)
  const num = (v, k) => { const x = Number(v ?? 0); if (!(x >= 0) || !Number.isFinite(x)) throw new Error(k); return toB(toS(x)) }
  try {
    const out = { ...cur }
    for (const k of ['lossForward', 'prepaid', 'wht']) if (d[k] !== undefined) out[k] = num(d[k], k)
    if (d.estimatedAnnual !== undefined) out.estimatedAnnual = d.estimatedAnnual === '' || d.estimatedAnnual == null ? '' : Number(d.estimatedAnnual)
    if (d.method !== undefined) out.method = ['best', 'actual', 'lump'].includes(d.method) ? d.method : 'best'
    if (d.allowances) for (const k of Object.keys(cur.allowances)) if (d.allowances[k] !== undefined) out.allowances = { ...out.allowances, [k]: num(d.allowances[k], k) }
    if (d.adjustments) out.adjustments = d.adjustments.map((x) => ({ label: String(x.label || '').trim().slice(0, 100), amount: Number(x.amount) })).filter((x) => x.label && Number.isFinite(x.amount) && x.amount !== 0).slice(0, 30)
    ;(A().taxYears ||= {})[year] = out
  } catch (e) { return { error: `ค่าไม่ถูกต้อง (${e.message}) ต้องเป็นตัวเลขไม่ติดลบ` } }
  return { ok: true }
}
const sumRange = (obj, from, to) => toB(Object.entries(obj).filter(([ym]) => ym >= from.slice(0, 7) && ym <= to.slice(0, 7)).reduce((s, [, v]) => s + toS(v), 0))
// รายงานภาษีประจำปีของปีบัญชี year (ตามประเภทร้านในตั้งค่า)
export function annualTaxReport(year) {
  const fy = fiscalRange(year)
  const table = taxTableOf(year)
  const ty = taxYearOf(year)
  const st = A().settings
  const pl = reportIncome(fy.from, fy.to)
  const half = reportIncome(fy.from, monthRange(addMonths(fy.from.slice(0, 7), 5)).to)
  const base = { year, fy, table, input: ty, entityType: st.entityType, filing: A().taxFilings?.[year] || null, revenue: pl.revenueTotal, netProfit: pl.netProfit }
  if (st.entityType === 'individual') {
    const allow = Object.values(ty.allowances).reduce((s, v) => s + toS(v), 0)
    const actualExpense = toB(toS(pl.cogsTotal) + toS(pl.opexTotal))
    const p = { income: pl.revenueTotal, actualExpense, allowances: toB(allow), prepaid: ty.prepaid, wht: ty.wht, table }
    const cmp = compareMethods(p)
    const method = ty.method === 'best' ? cmp.better : ty.method
    const calc = individualAnnual({ ...p, method })
    const halfExpense = toB(toS(half.cogsTotal) + toS(half.opexTotal))
    return { ...base, kind: 'individual', actualExpense, allowancesTotal: toB(allow), compare: cmp, method, calc, pnd94: pnd94Estimate({ halfIncome: half.revenueTotal, halfExpense, method, allowances: toB(allow), wht: ty.wht, table }) }
  }
  // นิติบุคคล: รายการปรับปรุงอัตโนมัติ + กรอกเอง
  const auto = []
  const nonDed = pl.opex.concat(pl.cogs).filter((r) => r.account.taxDeductible === false && r.amount > 0)
  for (const r of nonDed) auto.push({ label: `บวกกลับ: ${r.account.name} (ไม่ให้หักเป็นรายจ่าย)`, amount: r.amount, auto: true })
  const ent = pl.opex.find((r) => r.account.id === '5910')?.amount || 0
  const cap = entertainmentCap(pl.revenueTotal, st.paidInCapital || 0, table)
  if (ent > cap) auto.push({ label: `บวกกลับ: ค่ารับรองส่วนที่เกินเพดาน (${cap.toLocaleString()} บาท)`, amount: toB(toS(ent) - toS(cap)), auto: true })
  let taxDepr = 0
  for (const a of assets()) taxDepr += toS(sumRange(taxDeprByMonth({ ...a, disposalDate: a.disposal?.date || '' }, taxRateOf(a.category)), fy.from, fy.to))
  const bookDepr = toS(pl.opex.find((r) => r.account.id === '5800')?.amount || 0)
  if (bookDepr !== taxDepr) auto.push({ label: bookDepr > taxDepr ? 'บวกกลับ: ค่าเสื่อมทางบัญชีส่วนที่เกินอัตราภาษี' : 'หัก: ค่าเสื่อมทางภาษีส่วนที่เกินทางบัญชี', amount: toB(bookDepr - taxDepr), auto: true })
  const adjustments = [...auto, ...ty.adjustments.map((x) => ({ ...x, auto: false }))]
  const capital = st.paidInCapital || 0
  const calc = juristicAnnual({ accountingProfit: pl.netProfit, adjustments, lossForward: ty.lossForward, capital, revenue: pl.revenueTotal, prepaid: ty.prepaid, wht: ty.wht, table })
  const p51 = pnd51({ halfProfit: half.netProfit, estimatedAnnual: ty.estimatedAnnual, capital, revenue: pl.revenueTotal, wht: ty.wht, table })
  return { ...base, kind: 'juristic', adjustments, capital, entertainment: { spent: ent, cap }, bookDepr: toB(bookDepr), taxDepr: toB(taxDepr), calc, pnd51: p51, halfProfit: half.netProfit }
}
// บันทึกยื่นแล้ว: ต้องปิดงวดถึงสิ้นปีบัญชีก่อน (กันตัวเลขเปลี่ยนหลังยื่น) · เก็บ snapshot
export function markTaxFiled(year, { filedAt = today(), ref = '', paid = 0 } = {}) {
  const g = guard('acctTax')
  if (g) return g
  const fy = fiscalRange(year)
  const f = (A().taxFilings ||= {})
  if (f[year]?.filedAt) return { error: 'ยื่นแล้ว' }
  if (!A().closedThrough || A().closedThrough < fy.to) return { error: `ต้องปิดงวดถึง ${fy.to} ก่อนบันทึกยื่นภาษีประจำปี (แท็บ ปิดงวด/ตั้งค่า)` }
  const r = annualTaxReport(year)
  const { fy: _f, table, input, filing, ...snap } = r
  f[year] = { ...(f[year] || {}), filedAt, ref: String(ref).trim().slice(0, 60), paid: Math.max(0, Number(paid) || 0), by: session.userId, snapshot: JSON.parse(JSON.stringify(snap)), table: JSON.parse(JSON.stringify(table)) }
  return { ok: true }
}
export function reopenTaxFiling(year, reason) {
  const g = guard('acctTax')
  if (g) return g
  const x = A().taxFilings?.[year]
  if (!x?.filedAt) return { error: 'ยังไม่ได้ยื่น' }
  if (!String(reason || '').trim()) return { error: 'ระบุเหตุผล' }
  ;(x.history ||= []).push({ at: new Date().toISOString(), by: session.userId, reason: String(reason).trim().slice(0, 200), filedAt: x.filedAt, ref: x.ref })
  delete x.filedAt
  return { ok: true }
}

// ---------- ตรวจตามเวลา (เรียกจาก runScheduledChecks ของ store) ----------
export function runAcctChecks(once, todayStr = today()) {
  let n = 0
  // โหมดเซิร์ฟเวอร์ (config/scheduled.server): เซิร์ฟเวอร์เตือนค่าใช้จ่ายที่ยังไม่บันทึกและงวดผ่อนชำระแทน จึงไม่เตือนซ้ำที่นี่
  const serverRuns = db.scheduled?.server === true
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
      if (r.state === 'missing' && !serverRuns) once(`expmiss|${r.t.id}|${m}`, () => (n += notify('team_expense_missing', { vars: { รายการ: r.t.name, เดือนภาษี: m, วันที่: r.due } }), 0))
    }
  }
  for (const a of serverRuns ? [] : installmentAlerts(todayStr, Number(db.shop.installmentAlertDays ?? 1))) once(`instdue|${a.x.id}|${a.row.no}`, () => (n += notify('team_installment_due', { vars: { รายการ: a.x.name, งวด: String(a.row.no), วันที่: a.row.due, ยอดรวม: String(a.row.payment) } }), 0))
  return n
}

scheduledHooks.push(runAcctChecks)
