// ทดสอบการคำนวณค่าของแป้นตัวเลข · รัน: node src/lib/numpad.test.mjs
import assert from 'node:assert/strict'
import { applyNumpadKey } from './numpad.js'

let fail = 0
const t = (name, fn) => {
  try { fn(); console.log(`PASS ${name}`) } catch (e) { fail++; console.log(`FAIL ${name}: ${e.message}`) }
}

t('กดตัวเลขต่อท้าย', () => assert.equal(applyNumpadKey('', '1'), '1'))
t('จำนวนเต็มไม่มีจุด', () => assert.equal(applyNumpadKey('12', '.', 'int'), '12'))
t('ทศนิยมกดจุดได้ครั้งเดียว', () => {
  assert.equal(applyNumpadKey('12', '.', 'dec'), '12.')
  assert.equal(applyNumpadKey('12.5', '.', 'dec'), '12.5')
})
t('กดจุดขึ้นต้นได้ 0.', () => assert.equal(applyNumpadKey('', '.', 'dec'), '0.'))
t('ลบตัวท้ายและลบจนว่าง', () => {
  assert.equal(applyNumpadKey('123', 'back'), '12')
  assert.equal(applyNumpadKey('', 'back'), '')
})
t('ไม่เกินความยาวสูงสุด (เช่น OTP 6 หลัก)', () => assert.equal(applyNumpadKey('123456', '7', 'int', 6), '123456'))
t('ช่องที่มีลูกน้ำขณะพิมพ์ยังต่อท้ายได้', () => assert.equal(applyNumpadKey('48,058', '5', 'dec'), '48,0585'))
t('ปุ่มอื่นที่ไม่ใช่ตัวเลขไม่เปลี่ยนค่า', () => assert.equal(applyNumpadKey('48,058', 'x'), '48,058'))

console.log(fail ? `${fail} FAILED` : 'ALL PASS')
process.exit(fail ? 1 : 0)
