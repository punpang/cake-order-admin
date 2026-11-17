// ทดสอบกติกาคิวบิลหน้าร้านที่รอตรวจ (src/lib/posHoldRules.js) · รัน: node src/lib/posHoldRules.test.mjs
import assert from 'node:assert/strict'
import { pendingPosHolds } from './posHoldRules.js'

let fail = 0
const check = (name, fn) => {
  try { fn(); console.log(`PASS ${name}`) } catch (e) { fail++; console.log(`FAIL ${name}: ${e.message.split('\n')[0]}`) }
}
const A = (order_id, checked_at) => ({ order_id, checked_at })
const R = (order_id, reviewed_at) => ({ order_id, reviewed_at })
const sorted = (s) => [...s].sort()

check('ยังไม่มีการตรวจ → ค้างตรวจ', () => {
  assert.deepEqual(sorted(pendingPosHolds([A('p1', '2026-11-17T10:00:00Z')], [])), ['p1'])
})
check('ผู้จัดการตรวจหลังผลตรวจ → ไม่ค้าง', () => {
  assert.deepEqual(sorted(pendingPosHolds([A('p1', '2026-11-17T10:00:00Z')], [R('p1', '2026-11-17T10:05:00Z')])), [])
})
check('การตรวจเก่ากว่าผลตรวจล่าสุด → ค้างตรวจอีกครั้ง', () => {
  assert.deepEqual(sorted(pendingPosHolds([A('p1', '2026-11-17T10:00:00Z')], [R('p1', '2026-11-17T09:00:00Z')])), ['p1'])
})
check('ใช้การตรวจล่าสุดเมื่อมีหลายครั้ง', () => {
  const reviews = [R('p1', '2026-11-17T09:00:00Z'), R('p1', '2026-11-17T10:30:00Z')]
  assert.deepEqual(sorted(pendingPosHolds([A('p1', '2026-11-17T10:00:00Z')], reviews)), [])
})
check('เวลาแบบฐานข้อมูล (ไมโครวินาที) เทียบได้ถูกต้อง', () => {
  const audits = [A('p1', '2026-11-17T10:00:00.123456+00:00')]
  assert.deepEqual(sorted(pendingPosHolds(audits, [R('p1', '2026-11-17T10:00:01.000001+00:00')])), [])
  assert.deepEqual(sorted(pendingPosHolds(audits, [R('p1', '2026-11-17T09:59:59.999999+00:00')])), ['p1'])
})
check('เวลาตรวจอ่านไม่ได้ → ถือว่ายังค้าง', () => {
  assert.deepEqual(sorted(pendingPosHolds([A('p1', 'ไม่ใช่วันที่')], [R('p1', '2026-11-17T10:05:00Z')])), ['p1'])
})
check('บิลหลายใบแยกสถานะกันได้', () => {
  const audits = [A('p1', '2026-11-17T10:00:00Z'), A('p2', '2026-11-17T10:00:00Z')]
  assert.deepEqual(sorted(pendingPosHolds(audits, [R('p2', '2026-11-17T10:01:00Z')])), ['p1'])
})

console.log(fail ? `\n✗ ไม่ผ่าน ${fail} ข้อ` : '\n✓ posHoldRules: ผ่านทั้งหมด')
process.exit(fail ? 1 : 0)
