// ทดสอบการเก็บโหมดรูปแบบตกแต่ง: รูปแบบที่ใช้ส่วนลดด้านบนต้องยังเป็นส่วนลดด้านบนหลังบันทึก · รัน: node src/lib/styleMode.test.mjs
import assert from 'node:assert/strict'
import { styleModeToSave, isOwnStyle } from './pricing.js'

let fail = 0
const t = (name, fn) => { try { fn(); console.log(`PASS ${name}`) } catch (e) { fail++; console.log(`FAIL ${name}: ${e.message}`) } }

t('เก็บทั้ง own และ central', () => {
  assert.deepEqual(styleModeToSave({ a: 'own', b: 'central' }), { a: 'own', b: 'central' })
})
t('รูปแบบที่ใช้ส่วนลดด้านบนยังไม่ถูกนับเป็นราคาประจำตัว หลังบันทึก', () => {
  const saved = { styleMode: styleModeToSave({ m: 'central', i: 'own' }), styleDiscount: { m: { s1: 5 }, i: { s1: 0 } } }
  assert.equal(isOwnStyle(saved, 'm'), false)
  assert.equal(isOwnStyle(saved, 'i'), true)
})
t('ค่าว่างหรือไม่มีโหมดไม่ถูกเก็บ', () => {
  assert.deepEqual(styleModeToSave(undefined), {})
  assert.deepEqual(styleModeToSave({ x: '' }), {})
})

console.log(fail ? `${fail} FAILED` : 'ALL PASS')
process.exit(fail ? 1 : 0)
