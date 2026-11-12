// ทดสอบกติกาฟิลด์การโอน (ฝั่งแอป) · รัน: node src/lib/payFields.test.mjs
import assert from 'node:assert/strict'
import { BANKS, bankByCode, checkCustomerTxn, normalizeRef, REF_RE, txnMinute, thaiMinute, thaiMinuteOfMs, notBeforeOrder, notFuture, refTaken, PAY_MSG } from './payFields.js'

let pass = 0
const t = (name, fn) => { fn(); pass++; console.log('PASS', name) }

// 2026-11-11 03:00 UTC = 10:00 เวลาไทย
const NOW = Date.UTC(2026, 10, 11, 3, 0, 0)
const CREATED = '2026-11-11T02:00:00.000Z' // 09:00 เวลาไทย

t('ธนาคาร: รหัสไม่ซ้ำ เป็นตัวเลข 3 หลัก และมีชื่อ', () => {
  const codes = BANKS.map((b) => b.code)
  assert.equal(new Set(codes).size, codes.length)
  for (const b of BANKS) {
    assert.match(b.code, /^\d{3}$/)
    assert.ok(b.name.length > 0)
    assert.equal(typeof b.checked, 'boolean')
  }
  assert.equal(bankByCode('004').name, 'ธนาคารกสิกรไทย')
  assert.equal(bankByCode('999'), null)
})

t('เลขอ้างอิง: ตัดช่องว่างและขีด แปลงเป็นตัวพิมพ์ใหญ่ และรูปแบบ 6–40 ตัว', () => {
  assert.equal(normalizeRef(' a1b2-c3 d4 '), 'A1B2C3D4')
  assert.equal(normalizeRef(null), '')
  assert.ok(REF_RE.test('ABC123'))
  assert.ok(!REF_RE.test('ABC12'))
  assert.ok(!REF_RE.test('A'.repeat(41)))
  assert.ok(!REF_RE.test('ABC-123'))
})

t('วัน-เวลา: ประกอบจากวันที่และเวลา และไม่รับวันที่ที่ไม่มีจริง', () => {
  assert.equal(txnMinute('2026-02-28', '23:59'), '2026-02-28T23:59')
  assert.equal(txnMinute('2026-02-30', '10:00'), '')
  assert.equal(txnMinute('2026-13-01', '10:00'), '')
  assert.equal(txnMinute('2026-11-11', '24:00'), '')
  assert.equal(txnMinute('11/11/2026', '10:00'), '')
  assert.equal(txnMinute('2024-02-29', '00:00'), '2024-02-29T00:00')
})

t('เวลาไทย: ค่า ISO แปลงเป็นเวลาไทย และค่าท้องถิ่นไทยตัดเหลือนาที', () => {
  assert.equal(thaiMinute('2026-11-11T03:00:00.000Z'), '2026-11-11T10:00')
  assert.equal(thaiMinute('2026-11-11T10:00'), '2026-11-11T10:00')
  assert.equal(thaiMinute('2026-11-11T10:00:45'), '2026-11-11T10:00')
  assert.equal(thaiMinute(''), '')
  assert.equal(thaiMinute('ไม่ใช่วันที่'), '')
  assert.equal(thaiMinuteOfMs(NOW), '2026-11-11T10:00')
})

t('กติกา: วัน-เวลาชำระต้องไม่น้อยกว่าวัน-เวลาสร้างออร์เดอร์', () => {
  assert.equal(notBeforeOrder('2026-11-11T08:59', CREATED), false) // ก่อนสร้างออร์เดอร์ 1 นาที (สร้าง 09:00)
  assert.equal(notBeforeOrder('2026-11-11T09:00', CREATED), true) // เท่ากันถือว่าผ่าน
  assert.equal(notBeforeOrder('2026-11-11T10:00', CREATED), true)
  assert.equal(notBeforeOrder('2026-11-10T23:59', CREATED), false)
  assert.equal(notBeforeOrder('2026-11-11T09:00', undefined), true) // ไม่รู้วันสร้าง → ไม่ตรวจ
})

t('กติกา: ไม่เกินเวลาปัจจุบัน (ยอมคลาดเคลื่อน 5 นาที)', () => {
  assert.equal(notFuture('2026-11-11T10:05', NOW), true)
  assert.equal(notFuture('2026-11-11T10:06', NOW), false)
  assert.equal(notFuture('', NOW), true)
})

t('เลขอ้างอิงซ้ำ: นับเฉพาะรายการที่ไม่ได้ยกเลิก และเทียบโดยไม่สนตัวพิมพ์', () => {
  const pays = [{ ref: 'ABC-123456', status: 'confirmed' }, { ref: 'ZZZ999999', status: 'cancelled' }]
  assert.equal(refTaken(pays, 'abc123456'), true)
  assert.equal(refTaken(pays, 'ZZZ999999'), false)
  assert.equal(refTaken([], 'ABC123456'), false)
  assert.equal(refTaken(undefined, 'ABC123456'), false)
})

t('ตรวจฟิลด์: ครบและผ่าน → ค่าที่ทำให้เป็นมาตรฐาน', () => {
  const r = checkCustomerTxn({ txnDate: '2026-11-11', txnTime: '10:00', bankCode: '004', ref: 'a1b2c3d4e5', createdAt: CREATED, nowMs: NOW })
  assert.deepEqual(r, { value: { paidAt: '2026-11-11T10:00', bankCode: '004', ref: 'A1B2C3D4E5' } })
})

t('ตรวจฟิลด์: แต่ละข้อผิดได้ข้อความที่ตรงกับ PAY_MSG', () => {
  const base = { txnDate: '2026-11-11', txnTime: '10:00', bankCode: '004', ref: 'ABC123456', createdAt: CREATED, nowMs: NOW }
  assert.equal(checkCustomerTxn({ ...base, txnTime: '' }).error, PAY_MSG.txn)
  assert.equal(checkCustomerTxn({ ...base, txnDate: '2026-11-11', txnTime: '08:59' }).error, PAY_MSG.beforeOrder)
  assert.equal(checkCustomerTxn({ ...base, txnTime: '10:30' }).error, PAY_MSG.future)
  assert.equal(checkCustomerTxn({ ...base, bankCode: '' }).error, undefined) // ธนาคารไม่บังคับ
  assert.deepEqual(checkCustomerTxn({ ...base, bankCode: '', ref: '' }).value, { paidAt: '2026-11-11T10:00', bankCode: '', ref: '' })
  assert.equal(checkCustomerTxn({ ...base, bankCode: '4' }).error, PAY_MSG.bank)
  assert.equal(checkCustomerTxn({ ...base, ref: 'ABC' }).error, PAY_MSG.ref)
})

console.log(`ALL PASS (${pass})`)
