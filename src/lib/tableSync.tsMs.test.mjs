// ทดสอบเวลาเวอร์ชันของการซิงก์ (tsMs / maxVer) และการแยกข้อผิดพลาดชั่วคราวกับถาวร (isTransientError) · รัน: node src/lib/tableSync.tsMs.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { tsMs, isTransientError, maxVer, withVer } from './tableSync.js'

const BASE = Date.UTC(2026, 10, 21, 10, 0, 0) // 2026-11-21T10:00:00Z (เดือนที่ 10 = พฤศจิกายน)

test('tsMs อ่านทศนิยมทุกหลักที่ PostgREST ส่งได้เป็นมิลลิวินาทีที่ถูกต้อง (รวม Safari)', () => {
  assert.equal(tsMs('2026-11-21T10:00:00+00:00'), BASE)
  assert.equal(tsMs('2026-11-21T10:00:00.5+00:00'), BASE + 500)
  assert.equal(tsMs('2026-11-21T10:00:00.12+00:00'), BASE + 120)
  assert.equal(tsMs('2026-11-21T10:00:00.123+00:00'), BASE + 123)
  assert.equal(tsMs('2026-11-21T10:00:00.123456+00:00'), BASE + 123)
  assert.equal(tsMs('2026-11-21T10:00:00.123456Z'), BASE + 123)
  assert.equal(tsMs('2026-11-21T17:00:00.123456+07:00'), BASE + 123)
})

test('tsMs คืน NaN เมื่อรูปแบบผิด ไม่ให้ค่าเพี้ยนเงียบ ๆ', () => {
  assert.ok(Number.isNaN(tsMs('')))
  assert.ok(Number.isNaN(tsMs(undefined)))
  assert.ok(Number.isNaN(tsMs('ไม่ใช่วันที่')))
})

test('maxVer เลือกเวลาล่าสุดแม้จำนวนหลักทศนิยมต่างกัน', () => {
  const a = withVer({ id: 'a' }, '2026-11-21T10:00:00.9+00:00') // 900 มิลลิวินาที
  const b = withVer({ id: 'b' }, '2026-11-21T10:00:00.123456+00:00') // 123 มิลลิวินาที
  assert.equal(maxVer([a, b]), '2026-11-21T10:00:00.9+00:00')
  assert.equal(maxVer([b, a]), '2026-11-21T10:00:00.9+00:00')
})

test('isTransientError: เน็ตหลุด/เซิร์ฟเวอร์ล่ม/ชนกันชั่วคราว ลองใหม่ได้ · ถูกปฏิเสธจริงไม่ลองซ้ำ', () => {
  assert.equal(isTransientError({ message: 'Failed to fetch' }), true) // ไม่มีรหัส = เน็ตหลุด
  assert.equal(isTransientError({ status: 503 }), true)
  assert.equal(isTransientError({ status: 429 }), true)
  assert.equal(isTransientError({ code: '40001' }), true) // ซีเรียลไลซ์ชนกัน
  assert.equal(isTransientError({ status: 409, code: 'cap_full' }), false) // ออร์เดอร์เต็มวัน
  assert.equal(isTransientError({ status: 422, code: 'invalid' }), false)
  assert.equal(isTransientError({ code: 'P0001' }), false) // ด่านฐานข้อมูล (บิลเกิน/บัตร/ลูกค้าถูกลบ)
  assert.equal(isTransientError({ code: '42501' }), false) // สิทธิ์
})
