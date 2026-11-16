// ทดสอบความยินยอมรับข่าวสาร · รัน: node src/lib/promoConsent.test.mjs
import assert from 'node:assert/strict'
import { promoConsentPatch } from './promoConsent.js'

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

if (fail) { console.log(`${fail} failed`); process.exit(1) }
console.log('promoConsent: all passed')
