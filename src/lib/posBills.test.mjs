// ทดสอบบิล POS ที่ปิดแล้วย้อนหลัง (src/lib/posBills.js) · รัน: node src/lib/posBills.test.mjs
import assert from 'node:assert/strict'
import { isClosedPosBill, posBillDay, closedPosBillsInRange, payMethodsOf, posMethodTotals, filterPosBills } from './posBills.js'

let fail = 0
const t = (name, fn) => { try { fn(); console.log(`PASS ${name}`) } catch (e) { fail++; console.log(`FAIL ${name}: ${e.message}`) } }
const bill = (id, o = {}) => ({ id, channel: 'pos', status: 'payment_confirmed', pickupAt: '2026-11-10T10:00', createdAt: '2026-11-10T03:00:00.000Z', ...o })

const a = bill('a')
const b = bill('b', { pickupAt: '2026-11-11T09:00', createdAt: '2026-11-11T02:00:00.000Z' })
const pending = bill('pending', { status: 'pos_pending', pickupAt: '2026-11-11T11:00', createdAt: '2026-11-11T04:00:00.000Z' })
const online = { id: 'online', channel: null, status: 'delivered', pickupAt: '2026-11-11T10:00', createdAt: '2026-11-11T03:30:00.000Z' }
const cancelled = bill('cancelled', { status: 'cancelled', pickupAt: '2026-11-12T10:00', createdAt: '2026-11-12T03:00:00.000Z' })
const old = bill('old', { pickupAt: '2026-11-09T18:00', createdAt: '2026-11-09T11:00:00.000Z' })
const all = [a, b, pending, online, cancelled, old]
const ids = (list) => list.map((o) => o.id)

t('isClosedPosBill: บิลหน้าร้านที่ปิดแล้วเท่านั้น', () => {
  assert.equal(isClosedPosBill(a), true)
  assert.equal(isClosedPosBill(cancelled), true)
  assert.equal(isClosedPosBill(pending), false)
  assert.equal(isClosedPosBill(online), false)
  assert.equal(isClosedPosBill(null), false)
})
t('posBillDay: ใช้วันจาก pickupAt (เวลาท้องถิ่น) ก่อน createdAt', () => {
  assert.equal(posBillDay(b), '2026-11-11')
  assert.equal(posBillDay({ createdAt: '2026-11-05T01:00:00.000Z' }), '2026-11-05')
  assert.equal(posBillDay({}), '')
})
t('ไม่ระบุช่วง → ได้บิลปิดแล้วทั้งหมด ไม่รวมค้างชำระและออนไลน์ เรียงใหม่ก่อน', () => {
  assert.deepEqual(ids(closedPosBillsInRange(all)), ['cancelled', 'b', 'a', 'old'])
})
t('ช่วงวันที่รวมทั้งสองวัน', () => {
  assert.deepEqual(ids(closedPosBillsInRange(all, '2026-11-10', '2026-11-11')), ['b', 'a'])
  assert.deepEqual(ids(closedPosBillsInRange(all, '2026-11-10', '2026-11-10')), ['a'])
})
t('ระบุแค่วันเริ่มหรือวันสิ้นสุด', () => {
  assert.deepEqual(ids(closedPosBillsInRange(all, '2026-11-11')), ['cancelled', 'b'])
  assert.deepEqual(ids(closedPosBillsInRange(all, '', '2026-11-09')), ['old'])
})
t('ไม่มีข้อมูล หรือช่วงไม่มีบิล → รายการว่าง', () => {
  assert.deepEqual(closedPosBillsInRange(undefined), [])
  assert.deepEqual(closedPosBillsInRange(all, '2026-12-01', '2026-12-31'), [])
})

// ---- วิธีชำระ / สรุปยอด / ค้นหาและกรอง ----
const pay = (posMethod, amount, status = 'confirmed') => ({ status, posMethod, amount })
const cashBill = bill('cash1', { payments: [pay('cash', 100)], items: [{ name: 'Latte', qty: 1 }] })
const splitBill = bill('split', { payments: [pay('cash', 50), pay('card', 150), pay('card', 999, 'void')], items: [{ name: 'Croissant', qty: 2 }] })
const refundCash = bill('rc', { payments: [pay('cash', 100)], returns: [{ refunds: [{ method: 'cash', amount: 30 }] }] })
const refundCard = bill('rk', { payments: [pay('card', 200)], returns: [{ refunds: [{ method: 'transfer', amount: 40 }] }, { cancelled: { at: 'x' }, refunds: [{ method: 'cash', amount: 500 }] }] })
const voidedBill = bill('vb', { status: 'cancelled', payments: [pay('cash', 777)] })
const payList = [cashBill, splitBill, refundCash, refundCard, voidedBill]
const itemText = (o) => (o.items || []).map((i) => i.name).join(' ')

t('payMethodsOf: แบ่งจ่ายได้หลายวิธี · ไม่นับรายการที่ไม่ยืนยัน', () => {
  assert.deepEqual(payMethodsOf(splitBill), ['cash', 'card'])
  assert.deepEqual(payMethodsOf({}), [])
  assert.deepEqual(payMethodsOf(bill('x', { payments: [pay('transfer', 10, 'void')] })), [])
})
t('posMethodTotals: รวมตามวิธี · ไม่นับบิลยกเลิก · หักคืนเงินสดจากเงินสด และคืนโอนจากวิธีที่ไม่ใช่เงินสด', () => {
  assert.deepEqual(posMethodTotals(payList), { cash: 220, transfer: 0, card: 310 })
  assert.deepEqual(posMethodTotals(undefined), { cash: 0, transfer: 0, card: 0 })
})
t('filterPosBills: กรองสถานะ', () => {
  assert.deepEqual(ids(filterPosBills(payList, { status: 'cancelled' })), ['vb'])
  assert.deepEqual(ids(filterPosBills(payList, { status: 'closed' })), ['cash1', 'split', 'rc', 'rk'])
  assert.deepEqual(ids(filterPosBills(payList, { status: 'all' })), ['cash1', 'split', 'rc', 'rk', 'vb'])
})
t('filterPosBills: กรองวิธีชำระ', () => {
  assert.deepEqual(ids(filterPosBills(payList, { method: 'card' })), ['split', 'rk'])
  assert.deepEqual(ids(filterPosBills(payList, { method: 'cash' })), ['cash1', 'split', 'rc', 'vb'])
  assert.deepEqual(ids(filterPosBills(payList, { method: 'transfer' })), [])
})
t('filterPosBills: ค้นหาจากข้อความ ไม่สนตัวพิมพ์ · ว่าง = ทั้งหมด · รวมกับตัวกรองอื่นได้', () => {
  assert.deepEqual(ids(filterPosBills(payList, { q: 'latte', textOf: itemText })), ['cash1'])
  assert.deepEqual(ids(filterPosBills(payList, { q: 'CROISSANT', textOf: itemText })), ['split'])
  assert.deepEqual(ids(filterPosBills(payList, { q: '  ', textOf: itemText })), ['cash1', 'split', 'rc', 'rk', 'vb'])
  assert.deepEqual(ids(filterPosBills(payList, { q: 'zzz', textOf: itemText })), [])
  assert.deepEqual(ids(filterPosBills(payList, { q: 'croissant', textOf: itemText, method: 'card', status: 'closed' })), ['split'])
})

process.exitCode = fail ? 1 : 0
