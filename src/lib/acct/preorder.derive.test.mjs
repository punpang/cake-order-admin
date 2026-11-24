// ทดสอบรายการบัญชีของออร์เดอร์สั่งล่วงหน้า (เฟส 3G): มัดจำรับล่วงหน้า 2300 · ยกเลิกคืนเงิน/ริบ 4900 · สมดุลดุลเสมอ
// รัน: npm test (ตัวรันเทสต์ฝั่ง Node ใช้ vite โหลดโมดูล)
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { createServer } from 'vite'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const server = await createServer({ root: ROOT, server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' })
const { preorderEntries, deriveAll } = await server.ssrLoadModule('/src/lib/acct/derive.js')

let fail = 0
const t = (name, fn) => { try { fn(); console.log(`PASS ${name}`) } catch (e) { fail++; console.log(`FAIL ${name}: ${e.message}`) } }
const sumOf = (lines, side) => lines.reduce((a, l) => a + (Number(l[side]) || 0), 0)
const balanced = (e) => assert.equal(Math.round(sumOf(e.lines, 'dr') * 100), Math.round(sumOf(e.lines, 'cr') * 100), `ไม่สมดุล ${e.id}`)
const base = { id: 'po1', code: 'PRE-241124-000001', status: 'payment_confirmed', payments: [
  { id: 'p1', amount: 50, method: 'cash', status: 'confirmed', at: '2026-11-24T03:00:00.000Z' },
  { id: 'p2', amount: 20, method: 'qr', status: 'confirmed', at: '2026-11-25T03:00:00.000Z' },
  { id: 'p3', amount: 30, method: 'qr', status: 'reported', at: '2026-11-25T04:00:00.000Z' },
] }

t('มัดจำที่ยืนยันแล้วเข้า 2300 เฉพาะรายการ confirmed (ไม่รวม reported)', () => {
  const es = preorderEntries(base)
  assert.equal(es.length, 2)
  assert.equal(es[0].lines.find((l) => l.account === '2300').cr, 50)
  assert.equal(es[1].lines.find((l) => l.account === '1020').dr, 20)
  es.forEach(balanced)
})

t('ยกเลิกคืน 30 ริบ 40 จากยอดรับ 70: 2300 ถูกล้าง คืนเงินสด และรับรู้ 4900', () => {
  const es = preorderEntries({ ...base, status: 'cancelled', refunds: [{ amount: 30, method: 'cash' }], cancelledAt: '2026-11-26T00:00:00.000Z' })
  const cxl = es.find((e) => e.id === 'pre-cxl:po1')
  assert.ok(cxl)
  assert.equal(cxl.lines.find((l) => l.account === '2300').dr, 70)
  assert.equal(cxl.lines.find((l) => l.account === '1010').cr, 30)
  assert.equal(cxl.lines.find((l) => l.account === '4900').cr, 40)
  balanced(cxl)
})

t('คืนเป็นคะแนนลงหนี้สินคะแนน 2310 แทนเงินออก', () => {
  const es = preorderEntries({ ...base, status: 'cancelled', refunds: [{ amount: 30, method: 'points' }], cancelledAt: '2026-11-26T00:00:00.000Z' })
  const cxl = es.find((e) => e.id === 'pre-cxl:po1')
  assert.equal(cxl.lines.find((l) => l.account === '2310').cr, 30)
  assert.equal(cxl.lines.some((l) => l.account === '1010' || l.account === '1020'), false)
  balanced(cxl)
})

t('คืนสองวิธี (เงินสด 20 โอน 10) ลงคนละบัญชี และคืนเกินยอดที่รับไม่บันทึกรายการ', () => {
  const split = preorderEntries({ ...base, status: 'cancelled', refunds: [{ amount: 20, method: 'cash' }, { amount: 10, method: 'bank' }], cancelledAt: '2026-11-26T00:00:00.000Z' })
  const cxl = split.find((e) => e.id === 'pre-cxl:po1')
  assert.equal(cxl.lines.find((l) => l.account === '1020').cr, 10)
  assert.equal(cxl.lines.find((l) => l.account === '4900').cr, 40)
  balanced(cxl)
  const es = preorderEntries({ ...base, status: 'cancelled', refunds: [{ amount: 999, method: 'cash' }], cancelledAt: '2026-11-26T00:00:00.000Z' })
  assert.equal(es.some((e) => e.id === 'pre-cxl:po1'), false)
})

t('ออร์เดอร์ที่หมดเวลาแต่ยังไม่ยกเลิก: มีแค่รายการรับมัดจำ ไม่มีรายการคืน/ริบ', () => {
  const es = preorderEntries({ ...base, status: 'expired' })
  assert.equal(es.some((e) => e.id.startsWith('pre-cxl')), false)
  assert.equal(es.length, 2)
})

t('deriveAll รวมออร์เดอร์สั่งล่วงหน้าเมื่อมี ctx.preorders และไม่กระทบเมื่อไม่มี', () => {
  const ctx = { orders: [], groups: {}, retail: {}, ingredients: {}, pointValue: 1, preorders: [base] }
  const all = deriveAll(ctx)
  assert.ok(all.some((e) => e.id === 'pre-dep:po1:p1'))
  assert.deepEqual(deriveAll({ orders: [], groups: {}, retail: {}, ingredients: {}, pointValue: 1 }), [])
})

await server.close()
t('รับคืนหลังส่งมอบ: ลดมัดจำ 2300 และคืนตามวิธี (เงินสด/โอน/คะแนน)', () => {
  const es = preorderEntries({ ...base, status: 'returned', returns: [{ id: 'r1', at: '2026-12-01T00:00:00.000Z', refunds: [{ amount: 40, method: 'cash' }, { amount: 10, method: 'points' }] }] })
  const ret = es.find((e) => e.id === 'pre-ret:po1:r1')
  assert.ok(ret)
  assert.equal(ret.lines.find((l) => l.account === '2300').dr, 50)
  assert.equal(ret.lines.find((l) => l.account === '2310').cr, 10)
  balanced(ret)
})

t('พัสดุตีกลับที่ยังไม่คืนเงิน: ไม่มีรายการบัญชี', () => {
  const es = preorderEntries({ ...base, status: 'returned', returns: [{ id: 'r2', at: '2026-12-01T00:00:00.000Z', refunds: [] }] })
  assert.equal(es.some((e) => e.id.startsWith('pre-ret')), false)
})

console.log(fail ? `${fail} FAILED` : 'ALL PASS')
process.exitCode = fail ? 1 : 0
