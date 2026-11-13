// ทดสอบความสอดคล้องของเหตุการณ์แจ้งลูกค้า (กฎ ↔ ประเภทเหตุการณ์ ↔ กระดิ่ง) · รัน: node src/lib/notifyEvents.test.mjs
import assert from 'node:assert/strict'
import { NOTIFY_EVENTS, CUSTOMER_CHANNEL_ORDER } from './constants.js'
import { BELL_CUSTOMER } from './bell.js'
import { NEW_CUSTOMER_RULES } from './notifyPlan.js'

let fail = 0
const t = (name, fn) => { try { fn(); console.log(`PASS ${name}`) } catch (e) { fail++; console.log(`FAIL ${name}: ${e.message}`) } }

// slip_received ส่งจากเซิร์ฟเวอร์ (customer-order) เฉพาะ Facebook จึงไม่มีรายการกระดิ่งฝั่งแอป
const SERVER_SENT = ['slip_received']

t('ทุกกฎแจ้งลูกค้ามีประเภทเหตุการณ์ (ผู้รับเป็นลูกค้า) และมีหัวข้อในกระดิ่งลูกค้า', () => {
  for (const r of NEW_CUSTOMER_RULES) {
    assert.equal(NOTIFY_EVENTS[r.event]?.audience, 'customer', r.event)
    if (!SERVER_SENT.includes(r.event)) assert.ok(BELL_CUSTOMER[r.event]?.title, r.event)
  }
})

t('ช่องทางของทุกกฎอยู่ในลำดับช่องทางลูกค้า และมีเทมเพลต', () => {
  for (const r of NEW_CUSTOMER_RULES) {
    assert.ok(r.channels.every((c) => CUSTOMER_CHANNEL_ORDER.includes(c)), r.event)
    assert.ok(r.template && r.template.trim(), r.event)
  }
})

t('เหตุการณ์การเปลี่ยนแปลงออร์เดอร์ที่เพิ่มมีกฎครบ', () => {
  const have = new Set(NEW_CUSTOMER_RULES.map((r) => r.event))
  for (const e of ['payment_request_changed', 'payment_request_cancelled', 'payment_cancelled', 'pay_extension_granted', 'pay_extension_denied', 'items_changed', 'adjustment_changed']) {
    assert.ok(have.has(e), e)
  }
})

if (fail) { console.log(`${fail} failed`); process.exit(1) }
console.log('notifyEvents: all passed')
