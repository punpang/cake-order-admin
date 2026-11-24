// ทดสอบการกรอกการส่งสั่งล่วงหน้าทั้งชุด (ฟังก์ชันล้วน) · รัน: node src/lib/preorderShipBatch.test.mjs
import assert from 'node:assert/strict'
import { shippableOrders, splitPaste, applyPaste, postageValue, validateBatch } from './preorderShipBatch.js'

let fail = 0
const t = (name, fn) => { try { fn(); console.log(`PASS ${name}`) } catch (e) { fail++; console.log(`FAIL ${name}: ${e.message}`) } }

const ready = { id: 'a', status: 'payment_confirmed', fulfillment: 'delivery', total: 100, paid: 100 }

t('เลือกเฉพาะออร์เดอร์จัดส่ง ชำระครบ และรอส่ง', () => {
  const list = [
    ready,
    { ...ready, id: 'b', paid: 50 },
    { ...ready, id: 'c', fulfillment: 'pickup' },
    { ...ready, id: 'd', status: 'shipped' },
    { ...ready, id: 'e', status: 'awaiting_payment' },
  ]
  assert.deepEqual(shippableOrders(list).map((o) => o.id), ['a'])
})

t('แยกข้อความที่วางเป็นรายการ ข้ามบรรทัดว่างและเว้นวรรคหัวท้าย', () => {
  assert.deepEqual(splitPaste(' TH1\r\n\n  TH2 \nTH3\n'), ['TH1', 'TH2', 'TH3'])
  assert.deepEqual(splitPaste(undefined), [])
})

t('จับคู่เลขตามลำดับแถว และรายงานเลขที่เกินแถว', () => {
  const rows = [{ orderId: 'a', tracking: '' }, { orderId: 'b', tracking: 'OLD' }]
  const r = applyPaste(rows, ['TH1', 'TH2', 'TH3'])
  assert.deepEqual(r.rows.map((x) => x.tracking), ['TH1', 'TH2'])
  assert.equal(r.leftover, 1)
})

t('ค่าไปรษณีย์: ว่างเป็น 0 · ทศนิยม 2 ตำแหน่งผ่าน · เกินหรือติดลบไม่ผ่าน', () => {
  assert.equal(postageValue(''), 0)
  assert.equal(postageValue('45.5'), 45.5)
  assert.equal(postageValue('1.234'), null)
  assert.equal(postageValue('-1'), null)
  assert.equal(postageValue('100001'), null)
  assert.equal(postageValue('abc'), null)
})

t('ตรวจชุดงาน: ขนส่งว่างไม่ผ่าน', () => {
  assert.equal(validateBatch([{ orderId: 'a', tracking: 'TH1', postage: '' }], '').carrierError, 'ต้องเลือกขนส่ง')
})

t('ตรวจชุดงาน: รูปแบบเลขผิด, ว่าง และเลขซ้ำในชุดเดียวกัน (ไม่สนตัวพิมพ์)', () => {
  const r = validateBatch([
    { orderId: 'a', tracking: 'th-001', postage: '' },
    { orderId: 'b', tracking: 'TH-001', postage: '' },
    { orderId: 'c', tracking: 'a b', postage: '' },
    { orderId: 'd', tracking: '', postage: '' },
  ], 'Kerry')
  assert.equal(r.carrierError, '')
  assert.equal(r.rowErrors.a, undefined)
  assert.match(r.rowErrors.b, /ซ้ำ/)
  assert.match(r.rowErrors.c, /A–Z/)
  assert.match(r.rowErrors.d, /ยังไม่กรอก/)
})

t('ตรวจชุดงาน: ค่าไปรษณีย์ผิดถูกระบุเฉพาะแถวนั้น', () => {
  const r = validateBatch([{ orderId: 'a', tracking: 'TH001', postage: '-5' }], 'Kerry')
  assert.match(r.rowErrors.a, /ค่าไปรษณีย์/)
})

if (fail) { console.log(`\n${fail} ล้มเหลว`); process.exit(1) }
console.log('\nผ่านทั้งหมด')
