// ทดสอบการเติมผู้รับทดสอบจากลูกค้าจริง · รัน: node src/lib/testRecipients.test.mjs
import assert from 'node:assert/strict'
import { recipientsOfCustomer, addRecipients } from './testRecipients.js'

let fail = 0
const t = (name, fn) => { try { fn(); console.log(`PASS ${name}`) } catch (e) { fail++; console.log(`FAIL ${name}: ${e.message}`) } }

t('ลูกค้ามีเบอร์และ PSID ตัวเลข → ได้ทั้ง SMS และ Facebook (เบอร์เก็บเป็นตัวเลขล้วน)', () => {
  assert.deepEqual(recipientsOfCustomer({ name: 'สมชาย', phone: '081-234-5678', fbPsid: '1234567890' }), [
    { channel: 'sms', to: '0812345678', name: 'สมชาย' },
    { channel: 'facebook', to: '1234567890', name: 'สมชาย' },
  ])
})
t('เบอร์ไม่ถูกต้อง/ไม่มี และ PSID ไม่ใช่ตัวเลข → ไม่คืนแถว', () => {
  assert.deepEqual(recipientsOfCustomer({ name: 'A', phone: '12', fbPsid: 'PSID-mali' }), [])
  assert.deepEqual(recipientsOfCustomer({ name: 'A' }), [])
  assert.deepEqual(recipientsOfCustomer(null), [])
})
t('เบอร์บ้าน 02 (9 หลัก) ใช้ได้ → SMS', () => {
  assert.deepEqual(recipientsOfCustomer({ name: 'B', phone: '02-123-4567' }).map((r) => [r.channel, r.to]), [['sms', '021234567']])
})
t('เพิ่มโดยไม่ซ้ำช่องทางเดียวกัน (SMS ตัดช่องว่างและขีดก่อนเทียบ)', () => {
  const base = [{ channel: 'sms', to: '0812345678', name: 'เดิม' }]
  const r = addRecipients(base, [
    { channel: 'sms', to: '081 234-5678', name: 'ซ้ำ' },
    { channel: 'facebook', to: '1234567890', name: 'สมชาย' },
  ])
  assert.equal(r.added, 1)
  assert.deepEqual(r.list.map((x) => x.channel), ['sms', 'facebook'])
})
t('ไม่แก้รายการเดิม (คืนรายการใหม่)', () => {
  const base = [{ channel: 'telegram', to: '-100123' }]
  const r = addRecipients(base, [{ channel: 'sms', to: '0812345678' }])
  assert.equal(base.length, 1)
  assert.equal(r.list.length, 2)
})
t('ช่องทางต่างกันแต่รหัสเหมือนกัน ไม่ถือว่าซ้ำ', () => {
  const r = addRecipients([{ channel: 'facebook', to: '12345' }], [{ channel: 'telegram', to: '12345' }])
  assert.equal(r.added, 1)
})

process.exitCode = fail ? 1 : 0
