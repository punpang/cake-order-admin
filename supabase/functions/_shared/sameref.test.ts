// ทดสอบรายการเดียวต่อรหัสสุ่ม (Ref 2): หารายการ และเก็บสลิปไว้ที่รายการที่ยืนยันแล้ว
import { assertEquals } from 'jsr:@std/assert@1'
import { mergeSlipIntoConfirmed, sameRefPayment } from './sameref.ts'

const REF = 'ORD111126000010ABCDE'
const req = (over: Record<string, unknown> = {}) => ({ id: 'pr1', code: 'PAY-111126-00001', status: 'reported', amount: 540, qrRef: REF, customerSubmitted: false, ...over })
const NOW = '2026-11-11T03:00:00.000Z'

Deno.test('หารายการของรหัสสุ่ม: รายการรอตรวจก่อนรายการที่ยืนยันแล้ว', () => {
  const list = [req({ id: 'a', status: 'confirmed' }), req({ id: 'b', status: 'reported' })]
  assertEquals(sameRefPayment(list, REF)?.id, 'b')
  assertEquals(sameRefPayment([req({ id: 'a', status: 'confirmed' })], REF)?.id, 'a')
})

Deno.test('หารายการของรหัสสุ่ม: ไม่นับที่ยกเลิก รหัสอื่น หรือรหัสว่าง → null', () => {
  assertEquals(sameRefPayment([req({ status: 'cancelled' })], REF), null)
  assertEquals(sameRefPayment([req()], 'ORD111126000010ZZZZZ'), null)
  assertEquals(sameRefPayment([req()], ''), null)
  assertEquals(sameRefPayment(undefined, REF), null)
})

Deno.test('เก็บสลิปไว้ที่รายการที่ยืนยันแล้ว: เฉพาะรายการนั้น ไม่เปลี่ยนสถานะหรือยอด', () => {
  const list = [req({ id: 'a', status: 'confirmed', amount: 540 }), req({ id: 'b', status: 'reported', amount: 100, qrRef: 'X' })]
  const out = mergeSlipIntoConfirmed(list, 'a', { slip: 'r2://private/o1/x.png', slipKey: '004:REF1', bankCode: '004', ref: 'REF1', refSource: 'qr' }, NOW)
  assertEquals(out?.[0].status, 'confirmed')
  assertEquals(out?.[0].amount, 540)
  assertEquals([out?.[0].slip, out?.[0].slipKey, out?.[0].ref, out?.[0].refSource, out?.[0].slipMergedAt], ['r2://private/o1/x.png', '004:REF1', 'REF1', 'qr', NOW])
  assertEquals(out?.[1], list[1])
})

Deno.test('เก็บสลิปไม่ได้ เมื่อรายการยังรอตรวจ มีสลิปแล้ว หรือไม่พบ → null', () => {
  assertEquals(mergeSlipIntoConfirmed([req({ id: 'a' })], 'a', { slip: 's' }, NOW), null)
  assertEquals(mergeSlipIntoConfirmed([req({ id: 'a', status: 'confirmed', slip: 'old' })], 'a', { slip: 's' }, NOW), null)
  assertEquals(mergeSlipIntoConfirmed([req({ id: 'a', status: 'confirmed' })], 'zz', { slip: 's' }, NOW), null)
})

Deno.test('วัน-เวลาชำระเดิมไม่ถูกทับ และค่าที่เป็น undefined ไม่เขียนทับ', () => {
  const list = [req({ id: 'a', status: 'confirmed', paidAt: '2026-11-11T09:00' })]
  const out = mergeSlipIntoConfirmed(list, 'a', { slip: 's', paidAt: '2026-11-11T10:00', ocrAmount: undefined, bankName: null }, NOW)
  assertEquals([out?.[0].paidAt, 'ocrAmount' in (out?.[0] ?? {}), out?.[0].bankName], ['2026-11-11T09:00', false, null])
})
