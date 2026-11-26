// ทดสอบการแปลงอัตราแลกคูปอง: บาทต่อแต้ม ⇄ แต้มต่อ 1 บาท (แสดงผลเท่านั้น ค่าที่เก็บเป็นบาทต่อแต้ม)
// รัน: node src/lib/loyaltyRate.test.mjs
import assert from 'node:assert/strict'
import { pointsPerBaht, pointValueOfPointsPerBaht } from './loyalty.js'

let fail = 0
const t = (name, fn) => { try { fn(); console.log('ok -', name) } catch (e) { fail++; console.log('FAIL -', name, e.message) } }

t('มูลค่า 0.10 บาท/แต้ม = 10 แต้มต่อ 1 บาท', () => assert.equal(pointsPerBaht(0.1), 10))
t('มูลค่า 1 บาท/แต้ม = 1 แต้มต่อ 1 บาท', () => assert.equal(pointsPerBaht(1), 1))
t('10 แต้มต่อบาท → เก็บเป็น 0.1 บาท/แต้ม', () => assert.equal(pointValueOfPointsPerBaht(10), 0.1))
t('ไป-กลับ: 0.1 → 10 → 0.1', () => assert.equal(pointValueOfPointsPerBaht(pointsPerBaht(0.1)), 0.1))
t('ค่าไม่ถูกต้อง (0, ติดลบ, ว่าง) ไม่ให้ค่า', () => {
  assert.equal(pointsPerBaht(0), 0)
  assert.equal(pointsPerBaht(-1), 0)
  assert.equal(pointsPerBaht(''), 0)
  assert.equal(pointValueOfPointsPerBaht(0), null)
  assert.equal(pointValueOfPointsPerBaht(''), null)
})
t('ค่าที่ไม่ลงตัว (3 แต้มต่อบาท) เก็บเป็นทศนิยมที่ใกล้เคียง', () => assert.equal(pointValueOfPointsPerBaht(3), 0.333333))

if (fail) { console.log(`ล้ม ${fail} รายการ`); process.exit(1) }
console.log('ผ่านทั้งหมด')
