// ทดสอบสถานะจอลูกค้า: QR ถุงเงินจากหน้าออร์เดอร์ · ลำดับความสำคัญ · สถานะรายการชำระ
// รัน: node src/lib/customerDisplayState.test.mjs
import assert from 'node:assert/strict'
import { idleDisplay, orderQrDisplay, orderPaidDisplay, pickDisplay, holdStatusOf } from './customerDisplayState.js'

let fail = 0
const t = (name, fn) => { try { fn(); console.log('ok -', name) } catch (e) { fail++; console.log('FAIL -', name, e.message) } }

t('จอว่างแสดงต้อนรับ/โฆษณา (ไม่มีโฆษณาเป็น null)', () => {
  assert.deepEqual(idleDisplay('ร้าน', null), { status: 'idle', shopName: 'ร้าน', ads: null })
  assert.equal(idleDisplay(undefined).status, 'idle')
})
t('QR จากออร์เดอร์: สถานะ paying พร้อมยอดและ payload', () => {
  const s = orderQrDisplay({ amount: 45, payload: 'PAYLOAD' }, 'ร้าน')
  assert.equal(s.status, 'paying')
  assert.equal(s.total, 45)
  assert.deepEqual(s.qr, { amount: 45, payload: 'PAYLOAD' })
  assert.equal(s.payLines[0].amount, 45)
})
t('ชำระแล้ว: สถานะ paid พร้อมยอด', () => {
  const s = orderPaidDisplay(45, 'ร้าน')
  assert.equal(s.status, 'paid')
  assert.equal(s.amount, 45)
})
t('QR ค้างชนะสถานะจาก POS เสมอ · ไม่มี QR ใช้ของ POS', () => {
  const pos = { status: 'shopping' }
  const hold = orderQrDisplay({ amount: 10, payload: 'x' }, 'ร้าน')
  assert.equal(pickDisplay(hold, pos), hold)
  assert.equal(pickDisplay(null, pos), pos)
})
t('สถานะรายการชำระ: รอ / ชำระแล้ว / ยกเลิก / หมดเวลา / หายไป', () => {
  const now = 1000
  assert.equal(holdStatusOf({ status: 'reported' }, now, 2000), 'waiting')
  assert.equal(holdStatusOf({ status: 'confirmed' }, now, 2000), 'paid')
  assert.equal(holdStatusOf({ status: 'cancelled' }, now, 2000), 'gone')
  assert.equal(holdStatusOf({ status: 'reported' }, 3000, 2000), 'gone')
  assert.equal(holdStatusOf(null, now, 2000), 'gone')
  assert.equal(holdStatusOf({ status: 'reported' }, now, NaN), 'waiting')
})

if (fail) { console.log(`ล้ม ${fail} รายการ`); process.exit(1) }
console.log('ผ่านทั้งหมด')
