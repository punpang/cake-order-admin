// ทดสอบกติกาแจ้งเตือนถุงเงิน: จับคู่ Ref2 + ยอด · ยืนยันอัตโนมัติเมื่อนัดห่างครบจำนวนวัน (3 วันพอดีนับว่าผ่าน)
import { assertEquals } from 'jsr:@std/assert@1'
import { notifyDecision } from './notifyconfirm.ts'

// รับเงิน 11-11-2569 10:00 เวลาไทย (03:00 UTC) · นัดรับ 14-11-2569 (ห่าง 3 วัน)
const RECEIVED = Date.UTC(2026, 10, 11, 3, 0)
const PICKUP = '2026-11-14T10:00'
const PAY = { id: 'p1', qrRef: 'ORD12340272826288288', amount: 1, status: 'reported', customerSubmitted: false }
const base = { payment: PAY, amount: 1, receivedMs: RECEIVED, pickupAt: PICKUP, autoOn: true, days: 3 }

Deno.test('นัดห่างพอดี 3 วัน และยอดตรง → ยืนยันอัตโนมัติ', () => {
  const d = notifyDecision(base)
  assertEquals([d.match, d.auto, d.daysLeft], [true, true, 3])
})

Deno.test('นัดห่างน้อยกว่า 3 วัน → ผ่านการตรวจสอบแล้ว รอพนักงาน (ไม่อัตโนมัติ)', () => {
  const d = notifyDecision({ ...base, pickupAt: '2026-11-13T10:00' })
  assertEquals([d.match, d.auto, d.daysLeft], [true, false, 2])
})

Deno.test('ปิดการยืนยันอัตโนมัติ → ไม่ยืนยันเอง แต่ยังจับคู่ได้', () => {
  const d = notifyDecision({ ...base, autoOn: false })
  assertEquals([d.match, d.auto], [true, false])
})

Deno.test('ยอดไม่ตรง / ไม่มียอด → ไม่จับคู่', () => {
  assertEquals(notifyDecision({ ...base, amount: 2 }).match, false)
  assertEquals(notifyDecision({ ...base, amount: null }).match, false)
})

Deno.test('ไม่มีรายการรอตรวจ หรือรายการยืนยัน/ยกเลิกไปแล้ว → ไม่จับคู่', () => {
  assertEquals(notifyDecision({ ...base, payment: null }).match, false)
  assertEquals(notifyDecision({ ...base, payment: { ...PAY, status: 'confirmed' } }).match, false)
  assertEquals(notifyDecision({ ...base, payment: { ...PAY, status: 'cancelled' } }).match, false)
})

Deno.test('ลูกค้าแนบสลิปแล้ว (รอร้านตรวจ) ยังจับคู่กับแจ้งเตือนถุงเงินเข้ารายการเดิม', () => {
  const d = notifyDecision({ ...base, payment: { ...PAY, customerSubmitted: true } })
  assertEquals([d.match, d.auto, d.daysLeft], [true, true, 3])
})

Deno.test('QR จากหน้าออร์เดอร์ (orderQr) ยืนยันอัตโนมัติแม้นัดรับใกล้กว่า 3 วัน', () => {
  const d = notifyDecision({ ...base, payment: { ...PAY, orderQr: true }, pickupAt: '2026-11-12T10:00' })
  assertEquals([d.match, d.auto], [true, true])
})

Deno.test('QR จากหน้าออร์เดอร์ที่ปิดยืนยันอัตโนมัติไว้ → ไม่ยืนยัน', () => {
  const d = notifyDecision({ ...base, payment: { ...PAY, orderQr: true }, autoOn: false })
  assertEquals([d.match, d.auto], [true, false])
})

Deno.test('QR ปกติที่นัดใกล้กว่า 3 วัน → ยังไม่ยืนยันอัตโนมัติ (กติกาเดิม)', () => {
  const d = notifyDecision({ ...base, pickupAt: '2026-11-12T10:00' })
  assertEquals([d.match, d.auto], [true, false])
})

Deno.test('ไม่มีวันนัดรับ → ไม่ยืนยันอัตโนมัติ', () => {
  const d = notifyDecision({ ...base, pickupAt: undefined })
  assertEquals([d.match, d.auto], [true, false])
})
