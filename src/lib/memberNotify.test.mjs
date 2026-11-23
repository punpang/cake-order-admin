// ทดสอบแจ้งเตือนสิทธิ์สมาชิก · รัน: node src/lib/memberNotify.test.mjs
import assert from 'node:assert/strict'
import { LOYALTY_EVENTS, planLoyalty, smsAllowed, smsConsentPatch } from './memberNotify.js'

let fail = 0
const t = (name, fn) => { try { fn(); console.log(`PASS ${name}`) } catch (e) { fail++; console.log(`FAIL ${name}: ${e.message}`) } }
const NOW = Date.parse('2026-11-23T10:00:00.000Z')
const RECENT = '2026-11-23T09:00:00.000Z'
const OLD = '2026-11-20T09:00:00.000Z'

t('ความยินยอม SMS: เปิดเองจึงมีเวลายินยอม · ปิดแล้วล้างเวลา', () => {
  const on = smsConsentPatch({ name: 'ก' }, true, RECENT)
  assert.deepEqual(on, { name: 'ก', smsOptIn: true, smsConsentAt: RECENT })
  assert.deepEqual(smsConsentPatch(on, false, NOW), { name: 'ก', smsOptIn: false })
})

t('ข้อมูลเดิมที่เปิดอยู่แต่ไม่มีเวลา = ยังไม่นับ จนกว่าจะเปิดใหม่', () => {
  assert.equal(smsAllowed({ smsOptIn: true }), false)
  assert.equal(smsAllowed({ smsOptIn: true, smsConsentAt: RECENT }), true)
  assert.equal(smsAllowed({ smsOptIn: false, smsConsentAt: RECENT }), false)
})

t('คงเวลายินยอมเดิมเมื่อบันทึกซ้ำโดยยังเปิดอยู่', () => {
  const r = smsConsentPatch({ smsOptIn: true, smsConsentAt: OLD }, true, NOW)
  assert.equal(r.smsConsentAt, OLD)
})

t('เลื่อนระดับ: แยกระดับจากเหตุผลของ lot และใช้คีย์ต่อ lot', () => {
  const c = { id: 'c1', name: 'สมชาย', ledger: [{ id: 'l1', at: RECENT, delta: 50, reason: 'โบนัสเลื่อนเป็น LV2' }] }
  const [p] = planLoyalty({ nowMs: NOW, customers: [c] })
  assert.equal(p.event, 'tier_up')
  assert.equal(p.key, 'tier|c1|l1')
  assert.equal(p.vars.ระดับ, 'LV2')
  assert.equal(p.vars.โบนัส, '50')
  assert.equal(p.vars.ชื่อลูกค้า, 'สมชาย')
})

t('โบนัสต้อนรับ (ไม่ใช่การเลื่อนระดับ) เป็น member_bonus', () => {
  const c = { id: 'c2', name: 'ข', ledger: [{ id: 'l2', at: RECENT, delta: 100, reason: 'โบนัสต้อนรับสมาชิก' }] }
  const [p] = planLoyalty({ nowMs: NOW, customers: [c] })
  assert.equal(p.event, 'member_bonus')
  assert.equal(p.key, 'bonus|c2|l2')
})

t('รายการเก่าเกิน 24 ชม. หรือยังไม่ถึงเวลา ไม่แจ้ง', () => {
  const c = {
    id: 'c3', name: 'ค',
    ledger: [
      { id: 'o1', at: OLD, delta: 50, reason: 'โบนัสเลื่อนเป็น LV2' },
      { id: 'o2', at: '2026-11-23T11:00:00.000Z', delta: 50, reason: 'โบนัสเลื่อนเป็น LV2' },
      { id: 'o3', at: RECENT, delta: 10, reason: 'ซื้อสินค้า' },
    ],
  }
  assert.deepEqual(planLoyalty({ nowMs: NOW, customers: [c] }), [])
})

t('คูปองวันเกิดจากระบบ: ใช้คีย์ต่อคูปอง และไม่รวมคูปองอื่น', () => {
  const coupons = [
    { data: { id: 'bday-2026-c1', customerId: 'c1', source: 'member_birthday', name: 'คูปองวันเกิดสมาชิก LV4 ส่วนลด 30 บาท', amount: 30, expiresAt: '2026-11-30', createdAt: RECENT } },
    { data: { id: 'x1', customerId: 'c1', source: 'manual', createdAt: RECENT } },
  ]
  const plans = planLoyalty({ nowMs: NOW, customers: [{ id: 'c1', name: 'ง' }], coupons })
  assert.equal(plans.length, 1)
  assert.equal(plans[0].event, 'birthday_coupon')
  assert.equal(plans[0].key, 'bdaycoupon|bday-2026-c1')
  assert.equal(plans[0].vars.ยอดลด, '30')
})

t('ประเภทเหตุการณ์สมาชิกที่ระบบรู้จัก', () => {
  assert.deepEqual(LOYALTY_EVENTS, ['tier_up', 'member_bonus', 'birthday_coupon'])
})

if (fail) { console.log(`\n${fail} test(s) failed`); process.exit(1) }
console.log('\nall memberNotify tests passed')
