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
  const es = preorderEntries({ ...base, status: 'returned', returns: [{ id: 'r1', at: '2026-12-01T00:00:00.000Z', decision: 'refund', shippingForfeited: 0, refunds: [{ amount: 40, method: 'cash' }, { amount: 10, method: 'points' }] }] })
  const ret = es.find((e) => e.id === 'pre-ret:po1:r1')
  assert.ok(ret)
  assert.equal(ret.lines.find((l) => l.account === '2300').dr, 50)
  assert.equal(ret.lines.find((l) => l.account === '2310').cr, 10)
  balanced(ret)
})

t('พัสดุตีกลับที่ยังไม่คืนเงิน: ไม่มีรายการบัญชี', () => {
  const es = preorderEntries({ ...base, status: 'returned', returns: [{ id: 'r2', at: '2026-12-01T00:00:00.000Z', decision: null, refunds: [] }] })
  assert.equal(es.some((e) => e.id.startsWith('pre-ret')), false)
})

t('คืนเงินโดยริบค่าส่ง 20: 2300 ลดเท่ากับคืน+ค่าส่ง และค่าส่งเข้า 4900', () => {
  const es = preorderEntries({ ...base, status: 'returned', returns: [{ id: 'r3', at: '2026-12-01T00:00:00.000Z', decision: 'refund', shippingForfeited: 20, refunds: [{ amount: 80, method: 'bank' }] }] })
  const ret = es.find((e) => e.id === 'pre-ret:po1:r3')
  assert.equal(ret.lines.find((l) => l.account === '2300').dr, 100)
  assert.equal(ret.lines.find((l) => l.account === '1020').cr, 80)
  assert.equal(ret.lines.find((l) => l.account === '4900').cr, 20)
  balanced(ret)
})

t('จัดส่งใหม่: ริบค่าส่งเดิมเข้า 4900 โดยไม่มีการคืนเงิน', () => {
  const es = preorderEntries({ ...base, status: 'payment_confirmed', returns: [{ id: 'r4', at: '2026-12-01T00:00:00.000Z', decision: 'reship', shippingForfeited: 20 }] })
  const ret = es.find((e) => e.id === 'pre-ret:po1:r4')
  assert.equal(ret.lines.find((l) => l.account === '4900').cr, 20)
  assert.equal(es.some((e) => e.id === 'pre-ret:po1:r4' && e.lines.some((l) => l.account === '1010' || l.account === '1020')), false)
  balanced(ret)
})


// ออร์เดอร์มี VAT 7% รวมในราคา: ยอดรวม 107 (สินค้า 100 + ค่าส่ง 7 ผ่าน items/shippingFee) ตามสูตร orderTotals
const vatOrder = (over = {}) => ({ id: 'pv', code: 'PRE-VAT-1', status: 'payment_confirmed', vat: { rate: 7, mode: 'inclusive' }, items: [{ kind: 'retail', retailId: 'r1', unitPrice: 107, qty: 1 }], payments: [], ...over })
t('VAT มัดจำ: รับ 53.5 ลงภาษีขายตามสัดส่วนของยอดรวม 107 (ไม่เกินยอด VAT ทั้งออเดอร์)', () => {
  const es = preorderEntries({ ...vatOrder(), payments: [{ id: 'p1', amount: 53.5, method: 'cash', status: 'confirmed', at: '2026-11-24T03:00:00.000Z' }] })
  const dep = es.find((e) => e.id === 'pre-dep:pv:p1')
  assert.ok(dep)
  assert.equal(dep.lines.find((l) => l.account === '2200').cr, 3.5)
  assert.equal(dep.lines.find((l) => l.account === '2300').cr, 50)
  assert.ok(dep.tax && dep.tax[0].kind === 'output')
  balanced(dep)
})
t('ส่งมอบแล้ว: รับรู้รายได้ (ยอดก่อน VAT) หักมัดจำ 2300 ที่รับไว้ และภาษีขายรวมครบ 7 บาท', () => {
  const o = { ...vatOrder(), status: 'delivered', deliveredAt: '2026-11-26T03:00:00.000Z', payments: [{ id: 'p1', amount: 107, method: 'bank', status: 'confirmed', at: '2026-11-24T03:00:00.000Z' }] }
  const es = preorderEntries(o)
  const dlv = es.find((e) => e.id === 'pre-dlv:pv')
  assert.ok(dlv, 'ต้องมีรายการส่งมอบ')
  balanced(dlv)
  const pay = es.find((e) => e.id === 'pre-dep:pv:p1')
  const vat = (pay.lines.find((l) => l.account === '2200')?.cr || 0) + (dlv.lines.find((l) => l.account === '2200')?.cr || 0)
  assert.equal(Math.round(vat * 100), 700)
  assert.equal(Math.round(dlv.lines.find((l) => l.account === '2300').dr * 100), Math.round((107 - 7) * 100))
})
t('ส่งมอบแล้วไม่มีรายได้ซ้ำเมื่อส่งใหม่หลังจัดส่งใหม่ (ไม่มีรายการ pre-dlv)', () => {
  const o = { ...vatOrder(), status: 'delivered', deliveredAt: '2026-11-26T03:00:00.000Z', returns: [{ id: 'rt1', decision: 'reship', shippingForfeited: 0, at: '2026-11-25T00:00:00.000Z' }], payments: [{ id: 'p1', amount: 107, method: 'bank', status: 'confirmed', at: '2026-11-24T03:00:00.000Z' }] }
  assert.equal(preorderEntries(o).some((e) => e.id === 'pre-dlv:pv'), false)
})
t('รับคืนหลังส่งมอบ: กลับรายได้ 4950 และภาษีขาย ไม่ลดมัดจำ 2300 ที่หมดไปแล้ว', () => {
  const o = { ...vatOrder(), status: 'delivered', deliveredAt: '2026-11-26T03:00:00.000Z', payments: [{ id: 'p1', amount: 107, method: 'bank', status: 'confirmed', at: '2026-11-24T03:00:00.000Z' }], returns: [{ id: 'rt2', decision: 'refund', at: '2026-11-27T03:00:00.000Z', decidedAt: '2026-11-27T03:00:00.000Z', shippingForfeited: 0, refunds: [{ amount: 107, method: 'bank' }] }] }
  const r = preorderEntries(o).find((e) => e.id === 'pre-ret:pv:rt2')
  assert.ok(r)
  balanced(r)
  assert.equal(r.lines.find((l) => l.account === '4950').dr, 100)
  assert.equal(r.lines.find((l) => l.account === '2200').dr, 7)
  assert.equal(r.lines.find((l) => l.account === '2300'), undefined)
})

console.log(fail ? `${fail} FAILED` : 'ALL PASS')
process.exitCode = fail ? 1 : 0
