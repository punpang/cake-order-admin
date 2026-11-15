// ทดสอบสถานะพิมพ์และอ่านแล้ว · รัน: node src/lib/chatPresence.test.mjs
import assert from 'node:assert/strict'
import { TYPING_WINDOW_MS, isTypingNow, pingDue, lastFrom, readReceiptId, msOf } from './chatPresence.js'

let fail = 0
const t = (name, fn) => { try { fn(); console.log(`PASS ${name}`) } catch (e) { fail++; console.log(`FAIL ${name}: ${e.message}`) } }

const NOW = Date.parse('2026-11-15T10:00:00.000Z')
const MSGS = [
  { id: 'a', from: 'staff', at: '2026-11-15T10:00:00.000Z' },
  { id: 'b', from: 'customer', at: '2026-11-15T10:01:00.000Z' },
  { id: 'c', from: 'staff', at: '2026-11-15T10:02:00.000Z' },
]

t('กำลังพิมพ์: ภายใน 6 วินาทีหลังการพิมพ์ครั้งล่าสุดแสดง', () => {
  assert.equal(isTypingNow(NOW - 1000, NOW), true)
  assert.equal(isTypingNow(NOW - (TYPING_WINDOW_MS - 1), NOW), true)
})
t('กำลังพิมพ์: หมดช่วงแล้ว หรือไม่เคยพิมพ์ = ไม่แสดง', () => {
  assert.equal(isTypingNow(NOW - TYPING_WINDOW_MS, NOW), false)
  assert.equal(isTypingNow(NaN, NOW), false)
})
t('กำลังพิมพ์: เวลาเครื่องคลาดได้ไม่เกิน 2 วินาที', () => {
  assert.equal(isTypingNow(NOW + 1500, NOW), true)
  assert.equal(isTypingNow(NOW + 3000, NOW), false)
})
t('ส่งสถานะซ้ำ: ไม่ถี่กว่า 3 วินาที และยังไม่เคยส่ง = ส่งได้', () => {
  assert.equal(pingDue(NOW, NOW + 2999), false)
  assert.equal(pingDue(NOW, NOW + 3000), true)
  assert.equal(pingDue(0, NOW), true)
})
t('ข้อความล่าสุดของผู้ส่งที่ระบุ', () => {
  assert.equal(lastFrom(MSGS, 'staff').id, 'c')
  assert.equal(lastFrom(MSGS, 'customer').id, 'b')
  assert.equal(lastFrom([], 'staff'), null)
  assert.equal(lastFrom(null, 'staff'), null)
})
t('อ่านแล้ว: เวลาอ่านไม่ก่อนข้อความล่าสุดของผู้ส่งนั้น → คืน id', () => {
  assert.equal(readReceiptId(MSGS, 'staff', '2026-11-15T10:02:00.000Z'), 'c')
  assert.equal(readReceiptId(MSGS, 'customer', '2026-11-15T10:01:30.000Z'), 'b')
})
t('อ่านแล้ว: อ่านก่อนข้อความล่าสุด / ไม่มีเวลาอ่าน / เวลาผิดรูปแบบ = null', () => {
  assert.equal(readReceiptId(MSGS, 'staff', '2026-11-15T10:01:59.000Z'), null)
  assert.equal(readReceiptId(MSGS, 'staff', null), null)
  assert.equal(readReceiptId(MSGS, 'staff', 'ไม่ใช่เวลา'), null)
  assert.equal(readReceiptId([], 'staff', '2026-11-15T10:02:00.000Z'), null)
})
t('เวลาแบบไมโครวินาทีจาก Postgres อ่านเท่ากับมิลลิวินาที', () => {
  assert.equal(msOf('2026-11-15T10:00:00.123456+00:00'), Date.parse('2026-11-15T10:00:00.123+00:00'))
  assert.ok(Number.isNaN(msOf(null)))
})

if (fail) { console.log(`\nFAIL ${fail} รายการ`); process.exit(1) }
