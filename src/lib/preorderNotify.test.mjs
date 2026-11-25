// ทดสอบข้อความแจ้งลูกค้าสั่งล่วงหน้า (ฟังก์ชันล้วน) · รัน: node src/lib/preorderNotify.test.mjs
import assert from 'node:assert/strict'
import { EVENTS, notifyText, smsOk } from './preorderNotify.js'

let fail = 0
const t = (name, fn) => { try { fn(); console.log(`PASS ${name}`) } catch (e) { fail++; console.log(`FAIL ${name}: ${e.message}`) } }

const ctx = { code: 'PRE-241125-000001', due: 50, paid: 100, refund: 30, payDueAt: '2099-12-01T10:00:00Z', carrier: 'Kerry', tracking: 'TH123', campaign: 'เค้กคริสต์มาส' }

t('มีครบ 12 เหตุการณ์ตามแผน', () => assert.equal(EVENTS.length, 12))

t('ทุกเหตุการณ์สร้างข้อความได้ ไม่มี undefined/NaN และผ่านการตรวจความยาว SMS', () => {
  for (const e of EVENTS) {
    const text = notifyText(e, ctx)
    assert.ok(text.length > 0, e)
    assert.ok(smsOk(text.replace('{LINK}', 'https://x.test/o')), `${e}: ${text}`)
  }
})

t('เหตุการณ์ที่ต้องการลิงก์มีตัวแปร {LINK} ให้ระบบแทนที่', () => {
  for (const e of ['placed', 'reminder1h', 'extend_requested', 'extended', 'balance_due']) assert.match(notifyText(e, ctx), /\{LINK\}/, e)
})

t('ข้อความไม่มีลิงก์ที่มีรหัสในตัว (ไม่มีเลขออร์เดอร์ใน URL)', () => {
  for (const e of EVENTS) assert.doesNotMatch(notifyText(e, ctx), /\/o\/|token|\?code=/, e)
})

t('ยอดเงินแสดงเป็นบาทตามข้อมูล', () => {
  assert.match(notifyText('balance_due', ctx), /50 บาท/)
  assert.match(notifyText('refunded', ctx), /30 บาท/)
})

t('พัสดุแสดงขนส่งและเลขพัสดุ', () => {
  assert.match(notifyText('shipped', ctx), /Kerry.*TH123/)
})

t('เหตุการณ์ที่ไม่รู้จักถูกปฏิเสธ', () => {
  assert.throws(() => notifyText('nope', ctx), /unknown_event/)
})

t('smsOk ปฏิเสธข้อความยาวเกิน 300 ตัวอักษร', () => {
  assert.equal(smsOk('ก'.repeat(301)), false)
  assert.equal(smsOk('ก'.repeat(300)), true)
})

if (fail) { console.log(`\n${fail} ล้มเหลว`); process.exit(1) }
console.log('\nผ่านทั้งหมด')
