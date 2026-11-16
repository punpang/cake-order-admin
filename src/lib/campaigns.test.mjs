// ทดสอบประชาสัมพันธ์/โปรโมชั่น: ตรวจข้อมูล สิทธิ์ผู้รับ และรูปแบบข้อความ · รัน: node src/lib/campaigns.test.mjs
import assert from 'node:assert/strict'
import { validateCampaign, campaignMessageText, campaignCard, isCampaignEligible, CAMPAIGN_FOOTER } from './campaigns.js'

let fail = 0
const t = (name, fn) => { try { fn(); console.log(`PASS ${name}`) } catch (e) { fail++; console.log(`FAIL ${name}: ${e.message}`) } }
const OK = { type: 'promo', title: 'ลด 10%', body: 'ทุกเค้กวันศุกร์นี้', image: '', url: '', scheduledAt: '' }

t('ข้อมูลครบและถูกต้อง → ผ่าน (ค่าว่างรูป/ลิงก์/เวลาเป็นค่าว่าง/null)', () => {
  const r = validateCampaign(OK)
  assert.equal(r.ok, true)
  assert.deepEqual(r.value, { type: 'promo', title: 'ลด 10%', body: 'ทุกเค้กวันศุกร์นี้', image: '', url: '', scheduledAt: null })
})
t('ประเภทต้องอยู่ในรายการ', () => {
  assert.equal(validateCampaign({ ...OK, type: 'sms' }).ok, false)
  assert.equal(validateCampaign({ ...OK, type: 'announce' }).ok, true)
  assert.equal(validateCampaign({ ...OK, type: 'ad' }).ok, true)
})
t('หัวข้อและข้อความต้องไม่ว่าง และไม่เกินความยาว', () => {
  assert.equal(validateCampaign({ ...OK, title: '   ' }).ok, false)
  assert.equal(validateCampaign({ ...OK, body: '' }).ok, false)
  assert.equal(validateCampaign({ ...OK, title: 'ก'.repeat(81) }).ok, false)
  assert.equal(validateCampaign({ ...OK, title: 'ก'.repeat(80) }).ok, true)
  assert.equal(validateCampaign({ ...OK, body: 'ก'.repeat(501) }).ok, false)
})
t('ลิงก์รูปและลิงก์ปุ่มต้องเป็น https เท่านั้น', () => {
  assert.equal(validateCampaign({ ...OK, url: 'http://x.test' }).ok, false)
  assert.equal(validateCampaign({ ...OK, image: 'javascript:alert(1)' }).ok, false)
  assert.equal(validateCampaign({ ...OK, url: 'https://punpang.test/menu' }).ok, true)
})
t('เวลาส่งต้องอ่านเป็นวันที่ได้', () => {
  assert.equal(validateCampaign({ ...OK, scheduledAt: 'ไม่ใช่วันที่' }).ok, false)
  assert.equal(validateCampaign({ ...OK, scheduledAt: '2026-11-20T09:00:00.000Z' }).ok, true)
})

t('ข้อความที่ลูกค้าเห็นต่อท้ายบรรทัดวิธีปิดรับข่าวสารเสมอ', () => {
  assert.equal(campaignMessageText({ body: 'สวัสดี' }), `สวัสดี\n\n${CAMPAIGN_FOOTER}`)
})
t('การ์ดใช้ประเภทเป็นชนิดการ์ด และรูป/ลิงก์ว่างเป็นสตริงว่าง', () => {
  assert.deepEqual(campaignCard({ type: 'ad', title: 'เปิดสาขาใหม่' }), { kind: 'ad', title: 'เปิดสาขาใหม่', subtitle: '', image: '', url: '' })
})

const OPTED = { promoOptIn: true, promoConsentAt: '2026-11-01T00:00:00.000Z' }
t('ผู้รับต้องมีบัญชีเว็บ เปิดรับเอง (มีเวลายินยอม) และไม่ถูกปิด/ลบ', () => {
  assert.equal(isCampaignEligible(OPTED, true), true)
  assert.equal(isCampaignEligible(OPTED, false), false) // ไม่มีบัญชีเว็บ
  assert.equal(isCampaignEligible({ promoOptIn: true }, true), false) // ร้านตั้งให้เอง/ข้อมูลเดิม ไม่มีเวลายินยอม
  assert.equal(isCampaignEligible({ ...OPTED, promoOptIn: false }, true), false)
  assert.equal(isCampaignEligible({ ...OPTED, promoConsentAt: '' }, true), false)
  assert.equal(isCampaignEligible({ ...OPTED, deleted: true }, true), false)
  assert.equal(isCampaignEligible({ ...OPTED, active: false }, true), false)
  assert.equal(isCampaignEligible(null, true), false)
})

if (fail) { console.log(`${fail} failed`); process.exit(1) }
console.log('campaigns: all passed')
