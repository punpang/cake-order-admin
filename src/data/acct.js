// ระบบบัญชี (จำลองในหน่วยความจำ · จุดที่จะเปลี่ยนเป็น Supabase) · ตรรกะคำนวณอยู่ใน src/lib/acct (ฟังก์ชันล้วน)
// หมายเหตุ: store.js ไม่ import ไฟล์นี้ (กัน import วน) — หน้าที่ต้องใช้ import จากไฟล์นี้โดยตรง
import { db, session, can } from './store'
import { deriveAll } from '../lib/acct/derive'
import { buildManualEntry } from '../lib/acct/manual'
import { validateEntry, entryNo, entrySums } from '../lib/acct/journal'
import { trialBalance, incomeStatement, ledger, sums, balanceOf } from '../lib/acct/reports'
import { accountMap, KIND_LABEL } from '../lib/acct/chart'
import { toDateStr } from '../lib/format'
import { toS, toB } from '../lib/acct/money'

const A = () => db.acct
let seq = 0
const aid = (p) => `${p}${Date.now().toString(36)}${++seq}`
const today = () => toDateStr(new Date())

// ตัวสร้างรายการอัตโนมัติเพิ่มเติม (ค่าเสื่อม ตัดจำหน่าย ผ่อนชำระ ฯลฯ ลงทะเบียนในรอบถัด ๆ ไป)
export const extraGenerators = []

const ctx = () => ({
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
  if (locked(entry.date)) return { error: `งวดถึง ${A().closedThrough} ปิดแล้ว ลงรายการในวันนั้นไม่ได้ (ใช้วันที่หลังปิดงวด หรือกลับรายการ)` }
  if (id) {
    const cur = A().entries.find((e) => e.id === id)
    if (!cur) return { error: 'ไม่พบรายการ' }
    if (locked(cur.date)) return { error: 'รายการอยู่ในงวดที่ปิดแล้ว แก้ไม่ได้ (กลับรายการแทน)' }
    if (cur.reversedBy || cur.source?.reverses) return { error: 'รายการที่กลับรายการแล้ว/เป็นรายการกลับ แก้ไม่ได้' }
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
  const r = commit({ date, memo: memo.trim() || `กลับรายการ ${cur.no}`, lines, source: { type: 'manual', kind: 'journal', reverses: cur.id } }, null, 'JV')
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
