// ทดสอบรอบรับสินค้าสั่งล่วงหน้า (ฟังก์ชันล้วน) · รัน: node src/lib/preorderRounds.test.mjs
import assert from 'node:assert/strict'
import { cleanRounds, pickupMode, roundOf, MAX_ROUNDS } from './preorderRounds.js'

let fail = 0
const t = (name, fn) => { try { fn(); console.log(`PASS ${name}`) } catch (e) { fail++; console.log(`FAIL ${name}: ${e.message}`) } }

t('รอบถูกต้องเรียงตามเวลาและคงค่า cap', () => {
  const r = cleanRounds([{ time: '16:00', cap: 5 }, { time: '10:00', cap: 3 }])
  assert.equal(r.ok, true)
  assert.deepEqual(r.rounds, [{ time: '10:00', cap: 3 }, { time: '16:00', cap: 5 }])
})

t('เวลาซ้ำถูกปฏิเสธ', () => {
  const r = cleanRounds([{ time: '10:00', cap: 1 }, { time: '10:00', cap: 2 }])
  assert.equal(r.ok, false)
  assert.match(r.error, /ซ้ำ/)
})

t('รูปแบบเวลาผิดถูกปฏิเสธ (ชั่วโมงเกิน 23, นาทีเกิน 59, ไม่มีเลขศูนย์นำ)', () => {
  for (const time of ['24:00', '10:60', '9:00', '10', 'abc', '']) {
    assert.equal(cleanRounds([{ time, cap: 1 }]).ok, false, time)
  }
})

t('cap ต้องเป็นจำนวนเต็มอย่างน้อย 1', () => {
  for (const cap of [0, -1, 1.5, '2', null, undefined]) {
    assert.equal(cleanRounds([{ time: '10:00', cap }]).ok, false, String(cap))
  }
  assert.equal(cleanRounds([{ time: '10:00', cap: 1 }]).ok, true)
})

t('จำนวนรอบ: ว่างไม่ผ่าน และเกิน 12 ไม่ผ่าน, 12 รอบผ่าน', () => {
  assert.equal(cleanRounds([]).ok, false)
  assert.equal(cleanRounds(null).ok, false)
  const many = Array.from({ length: MAX_ROUNDS + 1 }, (_, i) => ({ time: `${String(i).padStart(2, '0')}:00`, cap: 1 }))
  assert.equal(cleanRounds(many).ok, false)
  assert.equal(cleanRounds(many.slice(0, MAX_ROUNDS)).ok, true)
})

t('โหมดของแคมเปญ: ไม่ตั้งหรือค่าไม่รู้จักเป็นโหมดวัน', () => {
  assert.equal(pickupMode({}), 'day')
  assert.equal(pickupMode({ data: { pickupMode: 'xyz' } }), 'day')
  assert.equal(pickupMode({ data: { pickupMode: 'slot' } }), 'slot')
})

t('โหมดวันไม่มีรอบ แม้มีรายการรอบอยู่ในข้อมูล', () => {
  const c = { data: { pickupMode: 'day', rounds: [{ time: '10:00', cap: 1 }] } }
  assert.equal(roundOf(c, '10:00'), null)
})

t('โหมดรอบคืนรอบที่ตรงเวลา และ null เมื่อไม่มี', () => {
  const c = { data: { pickupMode: 'slot', rounds: [{ time: '10:00', cap: 2 }, { time: '13:00', cap: 4 }] } }
  assert.deepEqual(roundOf(c, '13:00'), { time: '13:00', cap: 4 })
  assert.equal(roundOf(c, '11:00'), null)
})

if (fail) { console.log(`\n${fail} ล้มเหลว`); process.exit(1) }
console.log('\nผ่านทั้งหมด')
