// ทดสอบสถิติโอกาสการสั่ง · รัน: node src/lib/occasion.test.mjs
import assert from 'node:assert/strict'
import { computeOccasionStats, occasionIds, occasionLabel, OCCASION_MIN } from './occasion.js'

let pass = 0
const t = (name, fn) => { fn(); pass++; console.log('PASS', name) }

const now = new Date('2026-11-11T05:00:00Z')
const day = (n) => new Date(now.getTime() - n * 86400e3).toISOString()
const line = (id, qty = 1) => ({ kind: 'retail', retailId: id, qty })
const yes = (kind) => ({ kind, consent: true })
const make = (id, occasion, items, createdAt = day(1), status = 'delivered') => ({ id, customerId: 'cust-' + id, status, createdAt, occasion, items })

const orders = [
  make('1', yes('birthday'), [line('A', 2), line('B')]),
  make('2', yes('birthday'), [line('A')]),
  make('3', yes('birthday'), [line('A'), line('C')]),
  make('4', yes('birthday'), [line('B')]),
  make('5', { kind: 'birthday', consent: false }, [line('D', 9), line('A', 9)]), // ไม่ยินยอม ไม่นับ
  make('6', null, [line('D', 9)]), // ไม่ได้เลือกโอกาส ไม่นับ
  make('7', yes('party'), [line('B')], day(1), 'cancelled'), // ยกเลิก ไม่นับ
  make('8', yes('party'), [line('B')], day(40)), // เกิน 30 วัน ไม่นับ
  make('9', yes('party'), [line('B')]), make('10', yes('party'), [line('B')]), make('11', yes('party'), [line('B')]),
]

t('เฉพาะออร์เดอร์ที่ยินยอม ใช้ได้ และอยู่ในช่วง', () => {
  const s = computeOccasionStats(orders, { now })
  assert.equal(OCCASION_MIN, 3)
  assert.equal(s.birthday.A, 4) // 2 + 1 + 1 (ออร์เดอร์ 5 ไม่ยินยอม ไม่นับ)
  assert.equal(s.birthday.D, undefined)
})
t('กลุ่มที่มีออร์เดอร์น้อยกว่าขั้นต่ำไม่เผยแพร่', () => {
  const s = computeOccasionStats(orders, { now })
  // C พบแค่ 1 ออร์เดอร์ → ไม่เผยแพร่ · B ใน birthday พบ 2 ออร์เดอร์ → ไม่เผยแพร่
  assert.equal(s.birthday.C, undefined)
  assert.equal(s.birthday.B, undefined)
  assert.equal(s.party.B, 3) // พบ 3 ออร์เดอร์ ปาร์ตี้ (9,10,11) → เผยแพร่
})
t('ผลลัพธ์ไม่มีรหัสลูกค้า', () => {
  const s = computeOccasionStats(orders, { now })
  assert.equal(JSON.stringify(s).includes('cust-'), false)
})
t('occasionIds: เรียงตามยอดของโอกาสนั้น', () => {
  const s = { party: { X: 2, Y: 9, Z: 0 } }
  assert.deepEqual(occasionIds(s, 'party'), ['Y', 'X'])
  assert.deepEqual(occasionIds(s, 'none'), [])
})
t('occasionLabel: ชื่อภาษาไทย หรือว่างถ้าไม่รู้จัก', () => {
  assert.equal(occasionLabel('birthday'), 'วันเกิด')
  assert.equal(occasionLabel('unknown'), '')
})
t('ไม่มีออร์เดอร์: ว่าง', () => {
  assert.deepEqual(computeOccasionStats([], { now }), {})
})

console.log(`ALL PASS (${pass})`)
