// ทดสอบแถวตัวเลือกช่องทางแจ้งเตือน (รายออร์เดอร์/รายลูกค้า) · รัน: node src/lib/notifyPicker.test.mjs
import assert from 'node:assert/strict'
import { pickerRows } from './notifyPicker.js'

let fail = 0
const t = (name, fn) => { try { fn(); console.log(`PASS ${name}`) } catch (e) { fail++; console.log(`FAIL ${name}: ${e.message}`) } }
const FULL = { fbPsid: 'P1', phone: '0812345678' }

t('ไม่มีลูกค้า → ไม่มีแถว', () => {
  assert.deepEqual(pickerRows({}, null), [])
})
t('มีลูกค้า → แถวเว็บ/แอปแสดงเสมอ และป้ายชื่อถูกต้อง', () => {
  assert.deepEqual(pickerRows({}, { id: 'c1' }).map((r) => [r.k, r.label]), [['web', 'เว็บ/แอป']])
})
t('Facebook และ SMS แสดงเฉพาะเมื่อลูกค้ามีข้อมูลติดต่อช่องนั้น', () => {
  assert.deepEqual(pickerRows({}, FULL).map((r) => r.k), ['web', 'facebook', 'sms'])
  assert.deepEqual(pickerRows({}, { id: 'c2', phone: '0812345678' }).map((r) => r.k), ['web', 'sms'])
  assert.deepEqual(pickerRows({}, { id: 'c3', fbPsid: 'P9' }).map((r) => r.k), ['web', 'facebook'])
})
t('ค่าของแต่ละช่อง: true/false = เปิด/ปิด · ไม่ได้ตั้ง = null (ตามเดิม)', () => {
  assert.deepEqual(pickerRows({ web: false, sms: true }, FULL).map((r) => [r.k, r.v]), [['web', false], ['facebook', null], ['sms', true]])
})
t('เว็บ/แอปมีคำอธิบายบอกเงื่อนไขการส่ง', () => {
  assert.equal(pickerRows({}, { id: 'c1' })[0].hint, 'ใช้เมื่อลูกค้ามีบัญชีเว็บ/แอป')
})

if (fail) { console.log(`${fail} failed`); process.exit(1) }
console.log('notifyPicker: all passed')
