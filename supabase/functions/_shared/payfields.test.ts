// ทดสอบกติกาฟิลด์การโอน (ฝั่งเซิร์ฟเวอร์) และให้ค่ากับฝั่งแอปตรงกัน
import { assertEquals } from 'jsr:@std/assert@1'
import {
  BANKS, bankByCode, checkCustomerTxn, normalizeRef, REF_RE, txnMinute, thaiMinute, thaiMinuteOfMs,
  notBeforeOrder, notFuture, refTaken, paidAtFromMessage, PAY_MSG,
} from './payfields.ts'
import { BANKS as CLIENT_BANKS, PAY_MSG as CLIENT_MSG } from '../../../src/lib/payFields.js'

// 2026-11-11 03:00 UTC = 10:00 เวลาไทย · สร้างออร์เดอร์ 09:00 เวลาไทย
const NOW = Date.UTC(2026, 10, 11, 3, 0, 0)
const CREATED = '2026-11-11T02:00:00.000Z'

Deno.test('ธนาคารและข้อความแจ้งเตือนตรงกับฝั่งแอปทุกรายการ', () => {
  assertEquals(BANKS, CLIENT_BANKS)
  assertEquals(PAY_MSG, CLIENT_MSG)
})

Deno.test('ธนาคาร: รหัสไม่ซ้ำและค้นตามรหัสได้', () => {
  const codes = BANKS.map((b) => b.code)
  assertEquals(new Set(codes).size, codes.length)
  assertEquals(bankByCode('004')?.name, 'ธนาคารกสิกรไทย')
  assertEquals(bankByCode('999'), null)
})

Deno.test('เลขอ้างอิง: ทำให้เป็นมาตรฐาน และรูปแบบ 6–40 ตัว', () => {
  assertEquals(normalizeRef(' a1b2-c3 d4 '), 'A1B2C3D4')
  assertEquals(REF_RE.test('ABC123'), true)
  assertEquals(REF_RE.test('ABC12'), false)
  assertEquals(REF_RE.test('A'.repeat(41)), false)
})

Deno.test('วัน-เวลา: ไม่รับวันที่ที่ไม่มีจริง และรองรับปีอธิกสุรทิน', () => {
  assertEquals(txnMinute('2026-02-28', '23:59'), '2026-02-28T23:59')
  assertEquals(txnMinute('2026-02-30', '10:00'), '')
  assertEquals(txnMinute('2026-13-01', '10:00'), '')
  assertEquals(txnMinute('2026-11-11', '24:00'), '')
  assertEquals(txnMinute('2024-02-29', '00:00'), '2024-02-29T00:00')
})

Deno.test('เวลาไทย: แปลงค่า ISO และตัดค่าท้องถิ่นเหลือนาที', () => {
  assertEquals(thaiMinute('2026-11-11T03:00:00.000Z'), '2026-11-11T10:00')
  assertEquals(thaiMinute('2026-11-11T10:00:45'), '2026-11-11T10:00')
  assertEquals(thaiMinute('ไม่ใช่วันที่'), '')
  assertEquals(thaiMinuteOfMs(NOW), '2026-11-11T10:00')
})

Deno.test('กติกา: ไม่ก่อนวันสร้างออร์เดอร์ และไม่เกินเวลาปัจจุบัน (คลาดเคลื่อน 5 นาที)', () => {
  assertEquals(notBeforeOrder('2026-11-11T08:59', CREATED), false)
  assertEquals(notBeforeOrder('2026-11-11T09:00', CREATED), true)
  assertEquals(notBeforeOrder('2026-11-11T09:00', undefined), true)
  assertEquals(notFuture('2026-11-11T10:05', NOW), true)
  assertEquals(notFuture('2026-11-11T10:06', NOW), false)
})

Deno.test('เลขอ้างอิงซ้ำ: นับเฉพาะรายการที่ไม่ได้ยกเลิก และไม่สนตัวพิมพ์', () => {
  const pays = [{ ref: 'ABC-123456', status: 'confirmed' }, { ref: 'ZZZ999999', status: 'cancelled' }]
  assertEquals(refTaken(pays, 'abc123456'), true)
  assertEquals(refTaken(pays, 'ZZZ999999'), false)
  assertEquals(refTaken(undefined, 'ABC123456'), false)
})

Deno.test('ตรวจฟิลด์: ผ่านแล้วได้ค่าที่ทำให้เป็นมาตรฐาน และผิดได้ข้อความที่ตรงกับ PAY_MSG', () => {
  const base = { txnDate: '2026-11-11', txnTime: '10:00', bankCode: '004', ref: 'a1b2c3d4e5', createdAt: CREATED, nowMs: NOW }
  assertEquals(checkCustomerTxn(base), { value: { paidAt: '2026-11-11T10:00', bankCode: '004', ref: 'A1B2C3D4E5' } })
  assertEquals(checkCustomerTxn({ ...base, txnTime: '' }), { error: PAY_MSG.txn })
  assertEquals(checkCustomerTxn({ ...base, txnTime: '08:59' }), { error: PAY_MSG.beforeOrder })
  assertEquals(checkCustomerTxn({ ...base, txnTime: '10:30' }), { error: PAY_MSG.future })
  assertEquals(checkCustomerTxn({ ...base, bankCode: '4' }), { error: PAY_MSG.bank })
  assertEquals(checkCustomerTxn({ ...base, ref: 'ABC' }), { error: PAY_MSG.ref })
})

Deno.test('เวลาชำระของสลิปในแชท: ใช้เวลาที่ส่งข้อความ · ก่อนวันสร้างออร์เดอร์หรือไม่รู้ → เวลาปัจจุบัน', () => {
  assertEquals(paidAtFromMessage('2026-11-11T02:30:00.000Z', CREATED, NOW), '2026-11-11T09:30')
  assertEquals(paidAtFromMessage('2026-11-11T01:30:00.000Z', CREATED, NOW), '2026-11-11T10:00')
  assertEquals(paidAtFromMessage(undefined, CREATED, NOW), '2026-11-11T10:00')
})
