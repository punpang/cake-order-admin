// ทดสอบข้อความแจ้งคะแนนหลังปิดบิล POS · รัน: node src/lib/pointsEarnedVars.test.mjs
import assert from 'node:assert/strict'
import { pointsEarnedVars } from './loyalty.js'

let fail = 0
const t = (name, fn) => { try { fn(); console.log(`PASS ${name}`) } catch (e) { fail++; console.log(`FAIL ${name}: ${e.message}`) } }

const TODAY = '2026-11-23'

t('มีคะแนนใกล้หมดอายุ: รวมคะแนนที่จะหมดอายุและแสดงวันที่ dd-mm-yyyy', () => {
  const ledger = [
    { id: 'a', delta: 100, remaining: 100, expiresAt: '2026-12-10' }, // ภายใน 30 วัน
    { id: 'b', delta: 50, remaining: 50, expiresAt: '2027-11-23' }, // ยังไม่ใกล้
    { id: 'c', delta: 30, remaining: 0, expiresAt: '2026-12-01' }, // ใช้หมดแล้ว
  ]
  assert.deepEqual(pointsEarnedVars(ledger, TODAY, 20, 30), { คะแนนใหม่: 20, คะแนนสะสม: 150, คะแนนหมดอายุ: ' และ 100 คะแนน จะหมดอายุ 10-12-2026' })
})

t('ไม่มีคะแนนใกล้หมดอายุ: ส่วนหมดอายุเว้นว่าง', () => {
  const ledger = [{ id: 'b', delta: 50, remaining: 50, expiresAt: '2027-11-23' }]
  assert.deepEqual(pointsEarnedVars(ledger, TODAY, 5, 30), { คะแนนใหม่: 5, คะแนนสะสม: 50, คะแนนหมดอายุ: '' })
})

t('ไม่มีสมุดคะแนน: คะแนนสะสม 0 และเว้นว่างส่วนหมดอายุ', () => {
  assert.deepEqual(pointsEarnedVars([], TODAY, 0, 30), { คะแนนใหม่: 0, คะแนนสะสม: 0, คะแนนหมดอายุ: '' })
})

if (fail) {
  console.log(`\n✗ ล้ม ${fail} ข้อ`)
  process.exit(1)
}
console.log('\n✓ ผ่านทั้งหมด')
