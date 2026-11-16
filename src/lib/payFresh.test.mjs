// ทดสอบความสดของข้อมูลก่อนยืนยันรับชำระอัตโนมัติ · รัน: node src/lib/payFresh.test.mjs
import assert from 'node:assert/strict'
import { LABEL_MAX_AGE_MS, labelsFresh } from './payFresh.js'

let pass = 0
const t = (name, fn) => { fn(); pass++; console.log('PASS', name) }

t('ยังไม่เคยโหลด (0) ไม่ถือว่าสด', () => {
  assert.equal(labelsFresh(0, 1000), false)
})
t('โหลดไว้ไม่เกิน 5 วินาที ใช้ได้ทันที', () => {
  assert.equal(LABEL_MAX_AGE_MS, 5000)
  assert.equal(labelsFresh(1000, 1000), true)
  assert.equal(labelsFresh(1000, 3000), true)
  assert.equal(labelsFresh(1000, 6000), true) // อายุพอดี 5 วินาที ยังใช้ได้
})
t('โหลดไว้เกิน 5 วินาที ต้องโหลดใหม่ก่อน', () => {
  assert.equal(labelsFresh(1000, 6001), false)
  assert.equal(labelsFresh(1000, 60000), false)
})
t('เวลาที่โหลดอยู่หลังเวลาปัจจุบัน (นาฬิกาไม่ตรง) ไม่ถือว่าสด', () => {
  assert.equal(labelsFresh(5000, 4000), false)
})

console.log(`ผ่าน ${pass} กรณี`)
