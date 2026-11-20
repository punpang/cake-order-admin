// ทดสอบความยินยอมรับข่าวสาร · รัน: node src/lib/promoConsent.test.mjs
import assert from 'node:assert/strict'
import { marketingAllowed, promoConsentPatch } from './promoConsent.js'

let fail = 0
const t = (name, fn) => { try { fn(); console.log(`PASS ${name}`) } catch (e) { fail++; console.log(`FAIL ${name}: ${e.message}`) } }
const NOW = '2026-11-16T10:00:00.000Z'

t('ปิดรับ → promoOptIn = false และล้างเวลายินยอม', () => {
  const r = promoConsentPatch({ promoOptIn: true, promoConsentAt: '2026-11-01T00:00:00.000Z', name: 'ก' }, false, NOW)
  assert.deepEqual(r, { promoOptIn: false, name: 'ก' })
})
t('เพิ่งเปิดรับเอง → บันทึกเวลายินยอมเป็นเวลานี้', () => {
  assert.deepEqual(promoConsentPatch({ promoOptIn: false }, true, NOW), { promoOptIn: true, promoConsentAt: NOW })
  assert.deepEqual(promoConsentPatch({}, true, NOW), { promoOptIn: true, promoConsentAt: NOW })
})
t('เปิดอยู่แล้วและมีเวลาเดิม → คงเวลาเดิม (ไม่ถูกเลื่อนเมื่อบันทึกฟอร์มอื่น)', () => {
  const old = '2026-11-01T00:00:00.000Z'
  assert.deepEqual(promoConsentPatch({ promoOptIn: true, promoConsentAt: old }, true, NOW), { promoOptIn: true, promoConsentAt: old })
})
t('เปิดอยู่แต่ไม่มีเวลายินยอม (ข้อมูลเดิม) → ยังไม่นับ ไม่เติมเวลาเอง', () => {
  assert.deepEqual(promoConsentPatch({ promoOptIn: true }, true, NOW), { promoOptIn: true })
})
t('ฟิลด์อื่นคงเดิม และไม่แก้ข้อมูลที่ส่งเข้ามา', () => {
  const prev = { promoOptIn: false, fbPsid: 'P1', ledger: [1] }
  const r = promoConsentPatch(prev, true, NOW)
  assert.equal(r.fbPsid, 'P1')
  assert.deepEqual(r.ledger, [1])
  assert.deepEqual(prev, { promoOptIn: false, fbPsid: 'P1', ledger: [1] })
})

t('ข้อความการตลาด: ไม่มีคีย์ความยินยอม → ไม่ส่ง', () => {
  assert.equal(marketingAllowed({ name: 'ก' }), false)
  assert.equal(marketingAllowed(undefined), false)
})

t('ข้อความการตลาด: เปิดรับแต่ไม่มีเวลายินยอม → ไม่ส่ง', () => {
  assert.equal(marketingAllowed({ promoOptIn: true }), false)
  assert.equal(marketingAllowed({ promoOptIn: true, promoConsentAt: '' }), false)
})

t('ข้อความการตลาด: ปิดรับ → ไม่ส่งแม้มีเวลาเก่า', () => {
  assert.equal(marketingAllowed({ promoOptIn: false, promoConsentAt: NOW }), false)
})

t('ข้อความการตลาด: เปิดรับและมีเวลายินยอม → ส่งได้', () => {
  assert.equal(marketingAllowed({ promoOptIn: true, promoConsentAt: NOW }), true)
})

t('ลูกค้าที่กดเปิดรับเองในหน้าบัญชี → ผ่านเกณฑ์การตลาด', () => {
  const r = promoConsentPatch({ name: 'ก' }, true, NOW)
  assert.equal(marketingAllowed(r), true)
})

if (fail) { console.log(`${fail} failed`); process.exit(1) }
console.log('promoConsent: all passed')
