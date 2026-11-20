// ทดสอบกติกาคูปองจากคะแนน: ขั้นต่ำ/ทวีคูณ 10 · คะแนนลงตัว · คะแนนไม่พอ
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pointsCouponQuote, POINTS_COUPON } from './pointsCoupon.js'

test('มูลค่าขั้นต่ำ 10 และทวีคูณของ 10 เท่านั้น', () => {
  assert.equal(POINTS_COUPON.days, 15)
  assert.equal(pointsCouponQuote(10, 1, 100).ok, true)
  assert.equal(pointsCouponQuote(20, 1, 100).ok, true)
  assert.equal(pointsCouponQuote(5, 1, 100).reason, 'invalid')
  assert.equal(pointsCouponQuote(15, 1, 100).reason, 'invalid')
  assert.equal(pointsCouponQuote(0, 1, 100).reason, 'invalid')
  assert.equal(pointsCouponQuote(-10, 1, 100).reason, 'invalid')
  assert.equal(pointsCouponQuote('', 1, 100).reason, 'invalid')
  assert.equal(pointsCouponQuote(NaN, 1, 100).reason, 'invalid')
  assert.equal(pointsCouponQuote(10.5, 1, 100).reason, 'invalid')
})

test('ค่าเริ่มต้น 1 คะแนน = 1 บาท: 50 บาทใช้ 50 คะแนน', () => {
  assert.deepEqual(pointsCouponQuote(50, 1, 100), { ok: true, points: 50, reason: '' })
})

test('มูลค่าต่อคะแนนไม่ลงตัว → ไม่ให้แลก (3 บาท: 10 บาทไม่ลงตัว, 30 บาทได้ 10 คะแนน)', () => {
  assert.equal(pointsCouponQuote(10, 3, 100).reason, 'not_divisible')
  assert.deepEqual(pointsCouponQuote(30, 3, 100), { ok: true, points: 10, reason: '' })
})

test('มูลค่าต่อคะแนนเป็นทศนิยมที่ลงตัว (0.5 บาท: 10 บาท = 20 คะแนน)', () => {
  assert.deepEqual(pointsCouponQuote(10, 0.5, 100), { ok: true, points: 20, reason: '' })
})

test('คะแนนไม่พอ → insufficient พร้อมจำนวนที่ต้องใช้', () => {
  assert.deepEqual(pointsCouponQuote(50, 1, 49), { ok: false, points: 50, reason: 'insufficient' })
  assert.equal(pointsCouponQuote(50, 1, 50).ok, true)
})

test('ค่ามูลค่าต่อคะแนนไม่ถูกต้อง (0/ว่าง) ใช้ค่าเริ่มต้น 1', () => {
  assert.equal(pointsCouponQuote(20, 0, 100).points, 20)
  assert.equal(pointsCouponQuote(20, undefined, 100).points, 20)
})
