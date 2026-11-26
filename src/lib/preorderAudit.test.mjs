// ทดสอบการตรวจค่าส่งและแต้มของออร์เดอร์สั่งล่วงหน้า (src/lib/preorderAudit.js) · รัน: node src/lib/preorderAudit.test.mjs
import assert from 'node:assert/strict'
import { auditPreorderOrder, preorderBasePoints, expectedPoints } from './preorderAudit.js'

let fail = 0
const t = (name, fn) => { try { fn(); console.log(`PASS ${name}`) } catch (e) { fail++; console.log(`FAIL ${name}: ${e.message}`) } }
const codes = (r) => r.flags.map((f) => f.code)

// กล่อง S 20×20×20 น้ำหนักกล่อง 100 ราคา 15 · ค่าธรรมเนียม 10 · ขั้น 1000/2000 ราคา 60/90
const parcel = { fee: 10, boxes: [{ name: 'S', dims: { w: 20, l: 20, h: 20 }, boxG: 100, price: 15 }], steps: [1000, 2000], prices: { S: [60, 90] } }
const catalog = { shop: { parcel }, retailItems: [{ id: 'P', name: 'P', price: 500, active: true, weightG: 800, dimsCm: { w: 10, l: 10, h: 10 } }] }
// น้ำหนักรวม 800 + กล่อง 100 = 900 → ขั้น 1000 → ค่าส่ง 60 · รวม 10 + 15 + 60 = 85
const PARCEL_TOTAL = 85

const order = (over = {}) => ({
  status: 'delivered',
  fulfillment: 'delivery',
  lines: [{ retailId: 'P', qty: 1 }],
  items: [{ retailId: 'P', unitPrice: 500, qty: 1 }],
  shippingFee: PARCEL_TOTAL,
  loyalty: { points: 5, base: 500, mult: 1, bonus: 0, spins: 0, lotId: 'pt1' },
  ...over,
})

t('ออร์เดอร์ที่ค่าส่งและแต้มถูกต้อง → ผ่าน ไม่มีรายการ', () => {
  const r = auditPreorderOrder(order(), { catalog })
  assert.equal(r.ok, true)
  assert.deepEqual(r.flags, [])
})

t('ค่าส่งที่บันทึกไม่ตรงกับตาราง → shipping_mismatch (high)', () => {
  const r = auditPreorderOrder(order({ shippingFee: 80 }), { catalog })
  assert.equal(r.ok, false)
  assert.deepEqual(codes(r), ['shipping_mismatch'])
  assert.equal(r.flags[0].severity, 'high')
})

t('ค่าต่างไม่เกิน 0.01 บาทยังถือว่าถูก', () => {
  const r = auditPreorderOrder(order({ shippingFee: 85.005 }), { catalog })
  assert.deepEqual(codes(r), [])
})

t('ส่วนลดค่าส่งตามขั้นถูกหักก่อนเทียบ: ยอดสินค้า 500 ≥ 300 ลด 20 → ควรเป็น 65', () => {
  const shipOff = [{ min: 300, value: 20 }]
  assert.deepEqual(codes(auditPreorderOrder(order({ shippingFee: 65 }), { catalog, shipOff })), [])
  assert.deepEqual(codes(auditPreorderOrder(order({ shippingFee: 85 }), { catalog, shipOff })), ['shipping_mismatch'])
})

t('ฐานแต้มหักส่วนลดทั้งออร์เดอร์ ตัด VAT ในตัว และไม่รวม noPoints', () => {
  const o = order({
    items: [{ retailId: 'P', unitPrice: 1070, qty: 1 }, { retailId: 'N', unitPrice: 300, qty: 1, noPoints: true }],
    vat: { rate: 7, mode: 'inclusive' },
    adjustment: { amount: -100 },
  })
  // ยอดรวม 1370 หักส่วนลด 100 → สัดส่วน 1270/1370 · สินค้า P 1070 → 991.99 → ตัด VAT 7% → 927.01 → 9 แต้ม
  assert.equal(preorderBasePoints(o), 927.01)
  assert.deepEqual(codes(auditPreorderOrder({ ...o, loyalty: { ...o.loyalty, points: 9 } }, { catalog })), [])
  const bad = auditPreorderOrder({ ...o, loyalty: { ...o.loyalty, points: 10 } }, { catalog })
  assert.deepEqual(codes(bad), ['points_mismatch'])
})

t('แต้มไม่ตรงกับ ฐาน × ตัวคูณ ÷ แต้มต่อบาท → points_mismatch', () => {
  const r = auditPreorderOrder(order({ loyalty: { points: 4, mult: 1, base: 500 } }), { catalog })
  assert.deepEqual(codes(r), ['points_mismatch'])
  assert.match(r.flags[0].detail, /ควรเป็น 5/)
})

t('ตัวคูณสมาชิกที่เก็บไว้ถูกใช้คิดแต้มใหม่ (500 × 1.5 ÷ 100 = 7)', () => {
  assert.deepEqual(codes(auditPreorderOrder(order({ loyalty: { points: 7, mult: 1.5, base: 500 } }), { catalog })), [])
})

t('ไม่มี mult (ออร์เดอร์เก่า) → ไม่เทียบแต้ม แจ้ง mult_unrecorded (check)', () => {
  const r = auditPreorderOrder(order({ loyalty: { points: 999, base: 500 } }), { catalog })
  assert.deepEqual(codes(r), ['mult_unrecorded'])
  assert.equal(r.flags[0].severity, 'check')
  assert.equal(r.ok, false)
})

t('ออร์เดอร์ที่ไม่มี loyalty หรือยังไม่ส่งมอบ/ยกเลิก → ข้าม', () => {
  for (const o of [order({ loyalty: null }), order({ status: 'awaiting_payment' }), order({ status: 'paid', loyalty: null })]) {
    const r = auditPreorderOrder(o, { catalog })
    assert.equal(r.skipped, 'not_applicable')
    assert.deepEqual(r.flags, [])
  }
})

t('รับที่ร้าน (pickup) ไม่เทียบค่าส่ง แต้มถูกก็ผ่าน', () => {
  const r = auditPreorderOrder(order({ fulfillment: 'pickup', shippingFee: 0 }), { catalog })
  assert.deepEqual(codes(r), [])
})

t('ราคาพัสดุคิดใหม่ไม่ได้ (ไม่มีสินค้าในแคตาล็อก) → cannot_price_shipping (check)', () => {
  const r = auditPreorderOrder(order({ lines: [{ retailId: 'X', qty: 1 }] }), { catalog })
  assert.deepEqual(codes(r), ['cannot_price_shipping'])
  assert.equal(r.flags[0].severity, 'check')
})

t('ออร์เดอร์ที่ยกเลิกแล้วยังถูกตรวจ (ผลการให้แต้มยังต้องตรง)', () => {
  const r = auditPreorderOrder(order({ status: 'cancelled', loyalty: { points: 4, mult: 1, base: 500 } }), { catalog })
  assert.deepEqual(codes(r), ['points_mismatch'])
})

t('ไม่แก้ออร์เดอร์ที่รับเข้า', () => {
  const o = order({ shippingFee: 80 })
  const before = JSON.stringify(o)
  auditPreorderOrder(o, { catalog })
  assert.equal(JSON.stringify(o), before)
})

t('expectedPoints: ไม่ตั้งแต้มต่อบาท = 100 · ต่ำสุด 0.01 เหมือนฐานข้อมูล', () => {
  assert.equal(expectedPoints(500, 1, null), 5)
  assert.equal(expectedPoints(500, 1, 0), 50000)
  assert.equal(expectedPoints(300, 1, 100), 3)
})

if (fail) { console.log(`\n${fail} รายการล้มเหลว`); process.exit(1) }
console.log('\nผ่านทั้งหมด')
