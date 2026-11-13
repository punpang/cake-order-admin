// ทดสอบแผนการส่งข้อความถึงลูกค้า · รัน: node src/lib/notifyPlan.test.mjs
import assert from 'node:assert/strict'
import { customerTargets } from './notifyPlan.js'

let fail = 0
const t = (name, fn) => { try { fn(); console.log(`PASS ${name}`) } catch (e) { fail++; console.log(`FAIL ${name}: ${e.message}`) } }

const ORDER = ['line', 'facebook', 'sms']
const ON = { line: { enabled: true }, facebook: { enabled: true }, sms: { enabled: true } }
const ALL = { line: true, facebook: true, sms: true }
const addr = (a) => (k) => a[k] || ''
const FULL = { line: 'U1', facebook: 'P1', sms: '0811111111' }

t('มี LINE + Facebook + เบอร์ → ส่งครบทุกช่อง (ไม่หยุดที่ช่องแรก)', () => {
  assert.deepEqual(customerTargets({ order: ORDER, allowed: ALL, integrations: ON, addressOf: addr(FULL) }), ['line', 'facebook', 'sms'])
})
t('ช่องที่ปิดใช้งานหรือไม่มีข้อมูลติดต่อ → ไม่ส่ง', () => {
  assert.deepEqual(customerTargets({ order: ORDER, allowed: ALL, integrations: { ...ON, line: { enabled: false } }, addressOf: addr({ facebook: 'P1' }) }), ['facebook'])
})
t('กฎไม่อนุญาตช่องไหน → ไม่ส่งช่องนั้น', () => {
  assert.deepEqual(customerTargets({ order: ORDER, allowed: { line: true, facebook: false, sms: true }, integrations: ON, addressOf: addr(FULL) }), ['line', 'sms'])
})
t('พนักงานเลือกไม่ส่ง SMS → ตัด SMS ออก ช่องอื่นยังส่ง', () => {
  assert.deepEqual(customerTargets({ order: ORDER, allowed: ALL, integrations: ON, addressOf: addr(FULL), noSms: true }), ['line', 'facebook'])
})
t('มีแค่ SMS และพนักงานไม่ส่ง SMS → ไม่มีช่องทาง', () => {
  assert.deepEqual(customerTargets({ order: ORDER, allowed: ALL, integrations: ON, addressOf: addr({ sms: '0811111111' }), noSms: true }), [])
})
t('ไม่มีข้อมูลติดต่อเลย → ไม่มีช่องทาง', () => {
  assert.deepEqual(customerTargets({ order: ORDER, allowed: ALL, integrations: ON, addressOf: addr({}) }), [])
})
t('ข้อความการตลาด → ส่งช่องแรกช่องเดียว (เหมือนเดิม)', () => {
  assert.deepEqual(customerTargets({ order: ORDER, allowed: ALL, integrations: ON, addressOf: addr(FULL), marketing: true }), ['line'])
})
t('ไม่มีรายการช่องทาง/ค่าว่าง → ไม่ error', () => {
  assert.deepEqual(customerTargets(), [])
})

if (fail) { console.log(`${fail} failed`); process.exit(1) }
console.log('notifyPlan: all passed')
