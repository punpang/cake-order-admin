// ทดสอบด่านตรวจออร์เดอร์เสี่ยง (src/lib/orderGate.js) · รัน: node src/lib/orderGate.test.mjs
import assert from 'node:assert/strict'
import { gateOf, gateBlocks, GATED_STATUSES } from './orderGate.js'

let fail = 0
const check = (name, fn) => {
  try { fn(); console.log(`PASS ${name}`) } catch (e) { fail++; console.log(`FAIL ${name}: ${e.message.split('\n')[0]}`) }
}
const HOLD = { hold: true, checkedAt: '2026-11-15T03:00:00Z', flags: [{ code: 'shipping_mismatch', severity: 'high', detail: 'ค่าส่งไม่ตรง' }] }
const direct = { channel: null, status: 'awaiting_payment' }

check('ไม่มีผลตรวจ → ไม่บล็อก', () => {
  assert.equal(gateOf(null).blocked, false)
  assert.equal(gateOf(null).hold, false)
})
check('ผลตรวจมีรายการเสี่ยงและยังไม่มีผู้จัดการตรวจ → บล็อก', () => {
  const g = gateOf(HOLD)
  assert.equal(g.blocked, true)
  assert.equal(g.flags.length, 1)
})
check('ผู้จัดการตรวจหลังผลตรวจล่าสุดแล้ว → ไม่บล็อก', () => {
  const g = gateOf({ ...HOLD, reviewedAt: '2026-11-15T03:05:00Z' })
  assert.equal(g.blocked, false)
  assert.equal(g.reviewed, true)
})
check('ผลตรวจไม่มีรายการเสี่ยง → ไม่บล็อก', () => {
  assert.equal(gateOf({ hold: false, checkedAt: '2026-11-15T03:00:00Z', flags: [] }).blocked, false)
})
check('รายการระดับ info ไม่แสดงในด่าน', () => {
  const g = gateOf({ hold: true, flags: [{ code: 'skipped_quote', severity: 'info', detail: 'x' }, { code: 'vat_mismatch', severity: 'check', detail: 'y' }] })
  assert.deepEqual(g.flags.map((f) => f.code), ['vat_mismatch'])
})
check('บล็อกการยืนยันชำระและการส่งมอบของออร์เดอร์ตรงที่ยังไม่ผ่านด่าน', () => {
  const g = gateOf(HOLD)
  assert.equal(gateBlocks(direct, 'payment_confirmed', g), true)
  assert.equal(gateBlocks({ channel: null, status: 'payment_confirmed' }, 'delivered', g), true)
})
check('บิลหน้าร้าน (pos) ไม่เข้าด่าน', () => {
  assert.equal(gateBlocks({ channel: 'pos', status: 'awaiting_payment' }, 'payment_confirmed', gateOf(HOLD)), false)
})
check('สถานะอื่นไม่ถูกบล็อก (เช่น กำลังเตรียม/รอชำระ)', () => {
  const g = gateOf(HOLD)
  assert.equal(gateBlocks(direct, 'preparing', g), false)
  assert.equal(gateBlocks(direct, 'awaiting_payment', g), false)
})
check('สถานะเดิมเท่ากับสถานะใหม่ → ไม่ถือเป็นการเปลี่ยน', () => {
  assert.equal(gateBlocks({ channel: null, status: 'delivered' }, 'delivered', gateOf(HOLD)), false)
})
check('ไม่มีด่าน → ผ่านทั้งหมด', () => {
  assert.equal(gateBlocks(direct, 'payment_confirmed', gateOf(null)), false)
})
check('สถานะที่มีด่านคือยืนยันชำระและส่งมอบ', () => {
  assert.deepEqual(GATED_STATUSES, ['payment_confirmed', 'delivered'])
})

console.log(fail ? `\n✗ ไม่ผ่าน ${fail} ข้อ` : '\n✓ orderGate: ผ่านทั้งหมด')
process.exit(fail ? 1 : 0)
