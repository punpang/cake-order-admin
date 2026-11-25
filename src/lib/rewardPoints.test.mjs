// ทดสอบการแปลงราคาของแลกเป็นคะแนน
import assert from 'node:assert/strict'
import { pointsForPrice } from './rewardPoints.js'

const cases = [
  ['120 ÷ 1 = 120', () => assert.equal(pointsForPrice(120, 1), 120)],
  ['130 ÷ 25 ปัดขึ้นเป็น 6', () => assert.equal(pointsForPrice(130, 25), 6)],
  ['100 ÷ 25 ลงตัวพอดี = 4', () => assert.equal(pointsForPrice(100, 25), 4)],
  ['ทศนิยมไม่คลาดเคลื่อน: 0.3 ÷ 0.1 = 3', () => assert.equal(pointsForPrice(0.3, 0.1), 3)],
  ['ราคาเป็นสตริงได้', () => assert.equal(pointsForPrice('120', '1'), 120)],
  ['ราคา 0 หรือติดลบ → 0', () => { assert.equal(pointsForPrice(0, 1), 0); assert.equal(pointsForPrice(-5, 1), 0) }],
  ['ราคาเป็นข้อความหรือว่าง → 0', () => { assert.equal(pointsForPrice('', 1), 0); assert.equal(pointsForPrice('abc', 1), 0); assert.equal(pointsForPrice(null, 1), 0) }],
  ['มูลค่าคะแนน 0 / ติดลบ / ไม่ใช่ตัวเลข → 0', () => { assert.equal(pointsForPrice(120, 0), 0); assert.equal(pointsForPrice(120, -1), 0); assert.equal(pointsForPrice(120, undefined), 0) }],
]
let fail = 0
for (const [name, fn] of cases) {
  try { fn(); console.log(`PASS ${name}`) } catch (e) { fail++; console.log(`FAIL ${name}: ${e.message}`) }
}
if (fail) { console.log(`ไม่ผ่าน ${fail} รายการ`); process.exit(1) }
console.log(`ผ่านทั้งหมด ${cases.length} รายการ`)
