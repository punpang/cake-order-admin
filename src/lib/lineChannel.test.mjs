// ทดสอบการเลือกช่อง LINE (ช่องทางเสริม) · รัน: node src/lib/lineChannel.test.mjs
import assert from 'node:assert/strict'
import { customerTargets } from './notifyPlan.js'
import { CUSTOMER_CHANNEL_ORDER, CHANNELS } from './constants.js'

let fail = 0
const t = (name, fn) => { try { fn(); console.log(`PASS ${name}`) } catch (e) { fail++; console.log(`FAIL ${name}: ${e.message}`) } }

const addr = (k) => ({ web: 'C1', sms: '0812345678', facebook: '', line: 'C1' })[k] || ''

t('LINE อยู่ท้ายลำดับ ไม่แทน SMS (การส่งข้อความการตลาดยังเลือกช่องแรกเดิม)', () => {
  assert.deepEqual(CUSTOMER_CHANNEL_ORDER, ['web', 'facebook', 'sms', 'line'])
  assert.equal(CHANNELS.line.audience, 'customer')
})
t('LINE เปิดในกฎ + เปิดช่องทาง → ส่งพร้อม SMS (SMS ยังอยู่)', () => {
  const got = customerTargets({
    order: CUSTOMER_CHANNEL_ORDER,
    allowed: { web: false, sms: true, line: true },
    integrations: { web: { enabled: true }, sms: { enabled: true }, line: { enabled: true } },
    addressOf: addr,
  })
  assert.deepEqual(got, ['sms', 'line'])
})
t('ปิดช่อง LINE ในระบบ → ไม่ส่ง LINE', () => {
  const got = customerTargets({
    order: CUSTOMER_CHANNEL_ORDER,
    allowed: { sms: true, line: true },
    integrations: { sms: { enabled: true }, line: { enabled: false } },
    addressOf: addr,
  })
  assert.deepEqual(got, ['sms'])
})
t('กฎไม่ได้เปิด LINE → ไม่ส่ง LINE (ค่าเริ่มต้นปิด)', () => {
  const got = customerTargets({
    order: CUSTOMER_CHANNEL_ORDER,
    allowed: { sms: true },
    integrations: { sms: { enabled: true }, line: { enabled: true } },
    addressOf: addr,
  })
  assert.deepEqual(got, ['sms'])
})
t('ข้อความการตลาด: ส่งช่องแรกที่ใช้ได้ช่องเดียวเท่านั้น (LINE ไม่มาก่อน SMS)', () => {
  const got = customerTargets({
    order: CUSTOMER_CHANNEL_ORDER,
    allowed: { sms: true, line: true },
    integrations: { sms: { enabled: true }, line: { enabled: true } },
    addressOf: addr,
    marketing: true,
  })
  assert.deepEqual(got, ['sms'])
})

if (fail) { console.log(`\n${fail} ข้อล้มเหลว`); process.exit(1) }
console.log('\nผ่านทั้งหมด')
