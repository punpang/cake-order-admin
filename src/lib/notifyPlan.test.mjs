// ทดสอบแผนการส่งข้อความถึงลูกค้า · รัน: node src/lib/notifyPlan.test.mjs
import assert from 'node:assert/strict'
import { customerTargets, withNewRules, NEW_CUSTOMER_RULES, NEW_TEAM_RULES, upgradeRules, prepareRules, CHANNEL_RULE_VERSION } from './notifyPlan.js'
import { CUSTOMER_CHANNEL_ORDER } from './constants.js'

let fail = 0
const t = (name, fn) => { try { fn(); console.log(`PASS ${name}`) } catch (e) { fail++; console.log(`FAIL ${name}: ${e.message}`) } }

const ORDER = ['facebook', 'sms']
const ON = { facebook: { enabled: true }, sms: { enabled: true } }
const ALL = { facebook: true, sms: true }
const addr = (a) => (k) => a[k] || ''
const FULL = { facebook: 'P1', sms: '0811111111' }

t('มี Facebook + เบอร์ → ส่งครบทุกช่อง (ไม่หยุดที่ช่องแรก)', () => {
  assert.deepEqual(customerTargets({ order: ORDER, allowed: ALL, integrations: ON, addressOf: addr(FULL) }), ['facebook', 'sms'])
})
t('ช่องที่ปิดใช้งานหรือไม่มีข้อมูลติดต่อ → ไม่ส่ง', () => {
  assert.deepEqual(customerTargets({ order: ORDER, allowed: ALL, integrations: { ...ON, sms: { enabled: false } }, addressOf: addr({ facebook: 'P1' }) }), ['facebook'])
})
t('กฎไม่อนุญาตช่องไหน → ไม่ส่งช่องนั้น', () => {
  assert.deepEqual(customerTargets({ order: ORDER, allowed: { facebook: false, sms: true }, integrations: ON, addressOf: addr(FULL) }), ['sms'])
})
t('พนักงานเลือกไม่ส่ง SMS → ตัด SMS ออก ช่องอื่นยังส่ง', () => {
  assert.deepEqual(customerTargets({ order: ORDER, allowed: ALL, integrations: ON, addressOf: addr(FULL), noSms: true }), ['facebook'])
})
t('มีแค่ SMS และพนักงานไม่ส่ง SMS → ไม่มีช่องทาง', () => {
  assert.deepEqual(customerTargets({ order: ORDER, allowed: ALL, integrations: ON, addressOf: addr({ sms: '0811111111' }), noSms: true }), [])
})
t('ไม่มีข้อมูลติดต่อเลย → ไม่มีช่องทาง', () => {
  assert.deepEqual(customerTargets({ order: ORDER, allowed: ALL, integrations: ON, addressOf: addr({}) }), [])
})
t('ข้อความการตลาด → ส่งช่องแรกช่องเดียว (เหมือนเดิม)', () => {
  assert.deepEqual(customerTargets({ order: ORDER, allowed: ALL, integrations: ON, addressOf: addr(FULL), marketing: true }), ['facebook'])
})
t('ไม่มีรายการช่องทาง/ค่าว่าง → ไม่ error', () => {
  assert.deepEqual(customerTargets(), [])
})

t('กฎที่ยังไม่มีในฐานข้อมูลถูกเติม และกฎที่ร้านแก้ไว้แล้วไม่ถูกทับ', () => {
  const saved = [{ event: 'pickup_changed', channels: [], template: 'ของร้าน', enabled: false }]
  const merged = withNewRules(saved)
  assert.equal(merged.length, NEW_CUSTOMER_RULES.length + NEW_TEAM_RULES.length - 0)
  const pickup = merged.find((r) => r.event === 'pickup_changed')
  assert.deepEqual(pickup, { event: 'pickup_changed', channels: [], template: 'ของร้าน', enabled: false })
  assert.ok(merged.some((r) => r.event === 'delivery_changed' && r.enabled === true))
  assert.ok(merged.some((r) => r.event === 'coupon_applied' && r.enabled === true))
})
t('withNewRules ไม่แก้รายการเดิม และไม่เพิ่มซ้ำเมื่อเรียกซ้ำ', () => {
  const once = withNewRules([])
  const twice = withNewRules(once)
  assert.equal(twice.length, once.length)
  assert.equal(withNewRules(undefined).length, NEW_CUSTOMER_RULES.length + NEW_TEAM_RULES.length)
})

t('ออร์เดอร์จากเว็บ/แอป: แจ้งผ่านเว็บและ SMS · ไม่มีที่อยู่หรือปิดช่องทางไหนก็ข้ามช่องนั้น', () => {
  const integrations = { web: { enabled: true }, sms: { enabled: true }, facebook: { enabled: true } }
  const addressOf = (k) => (k === 'web' ? 'c1' : k === 'sms' ? '0812345678' : '')
  const got = customerTargets({ order: ['web', 'sms'], allowed: { web: true, sms: true, facebook: false }, integrations, addressOf })
  assert.deepEqual(got, ['web', 'sms'])
  assert.deepEqual(customerTargets({ order: ['web', 'sms'], allowed: { web: true, sms: false }, integrations, addressOf }), ['web'])
  assert.deepEqual(customerTargets({ order: ['web', 'sms'], allowed: { web: true, sms: true }, integrations, addressOf, noSms: true }), ['web'])
  assert.deepEqual(customerTargets({ order: ['web', 'sms'], allowed: { web: true, sms: true }, integrations, addressOf: () => '' }), [])
})

t('ค่าเริ่มต้นลูกค้า: เว็บ/แอปเป็นช่องทางแรก · ไม่มี Facebook ยกเว้น slip_received (ตอบกลับสลิปใน Messenger)', () => {
  assert.equal(CUSTOMER_CHANNEL_ORDER[0], 'web')
  assert.deepEqual(NEW_CUSTOMER_RULES.filter((r) => r.channels.includes('facebook')).map((r) => r.event), ['slip_received'])
})
t('ทุกออเดอร์: เว็บ/แอป (มีบัญชี) + SMS · ไม่มีบัญชีเว็บ → SMS · Facebook ส่งเฉพาะที่ร้านเปิดไว้', () => {
  const integrations = { web: { enabled: true }, sms: { enabled: true }, facebook: { enabled: true } }
  const addressOf = (k) => (k === 'web' ? 'c1' : k === 'sms' ? '0812345678' : k === 'facebook' ? 'P1' : '')
  assert.deepEqual(customerTargets({ order: CUSTOMER_CHANNEL_ORDER, allowed: { web: true, sms: true, facebook: false }, integrations, addressOf }), ['web', 'sms'])
  assert.deepEqual(customerTargets({ order: CUSTOMER_CHANNEL_ORDER, allowed: { web: true, sms: true, facebook: true }, integrations, addressOf }), ['web', 'facebook', 'sms'])
  assert.deepEqual(customerTargets({ order: CUSTOMER_CHANNEL_ORDER, allowed: { web: true, sms: true }, integrations, addressOf: (k) => (k === 'sms' ? '0812345678' : '') }), ['sms'])
})
t('ข้อความการตลาดส่งช่องแรกที่ใช้ได้ช่องเดียว (เว็บก่อน)', () => {
  const integrations = { web: { enabled: true }, sms: { enabled: true } }
  assert.deepEqual(customerTargets({ order: CUSTOMER_CHANNEL_ORDER, allowed: { web: true, sms: true }, integrations, addressOf: (k) => (k === 'sms' ? '0812345678' : ''), marketing: true }), ['sms'])
  assert.deepEqual(customerTargets({ order: CUSTOMER_CHANNEL_ORDER, allowed: { web: true, sms: true }, integrations, addressOf: (k) => (k === 'web' ? 'c1' : '0812345678'), marketing: true }), ['web'])
})
t('อัปเกรดกติกา: Facebook → เว็บ/แอป · ช่องอื่นคงเดิม · ทำซ้ำได้ผลเท่าเดิม', () => {
  const up = upgradeRules([{ event: 'pickup_changed', channels: ['facebook', 'sms'], template: 'ของร้าน', enabled: true }])
  assert.deepEqual(up[0], { event: 'pickup_changed', channels: ['web', 'sms'], template: 'ของร้าน', enabled: true, chv: CHANNEL_RULE_VERSION })
  assert.deepEqual(upgradeRules(up), up)
  assert.deepEqual(upgradeRules([{ event: 'team_new_order', channels: ['telegram'], enabled: true }])[0].channels, ['telegram'])
})
t('อัปเกรดกติกา: slip_received คงเป็น Facebook · กฎรุ่นปัจจุบันที่ร้านเปิด Facebook เองไม่ถูกแก้', () => {
  assert.deepEqual(upgradeRules([{ event: 'slip_received', channels: ['facebook'], enabled: true }])[0].channels, ['facebook'])
  const chosen = { event: 'pickup_changed', channels: ['web', 'facebook', 'sms'], enabled: true, chv: CHANNEL_RULE_VERSION }
  assert.equal(upgradeRules([chosen])[0], chosen)
})
t('prepareRules: เติมกฎที่ขาดและเป็นรุ่นปัจจุบันทั้งหมด', () => {
  const merged = prepareRules([])
  assert.equal(merged.length, NEW_CUSTOMER_RULES.length + NEW_TEAM_RULES.length)
  assert.ok(merged.every((r) => r.chv === CHANNEL_RULE_VERSION))
})

if (fail) { console.log(`${fail} failed`); process.exit(1) }
console.log('notifyPlan: all passed')
