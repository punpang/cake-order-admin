// ทดสอบการตรวจออร์เดอร์ที่บันทึกแล้ว (src/lib/orderAudit.js)
// • ออร์เดอร์ตรงที่ราคาถูกต้อง (ข้อมูลอ้างอิงจากใบเสนอ ซึ่งใช้โค้ดคิดราคาชุดเดียวกับการขาย) ต้องผ่าน
// • การแก้ราคา ส่วนลด VAT ของแถม รายการ และส่วนลดท้ายบิล ต้องถูกจับด้วยรหัสที่ถูกต้อง
// • บิลหน้าร้านถูกส่งไปตรวจด้วย posAudit · รัน: node src/lib/orderAudit.test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { auditOrder, auditDirectOrder } from './orderAudit.js'

const golden = JSON.parse(readFileSync(new URL('./quotePrice.golden.json', import.meta.url), 'utf8'))
const posGolden = JSON.parse(readFileSync(new URL('./posAudit.golden.json', import.meta.url), 'utf8'))
const clone = (x) => JSON.parse(JSON.stringify(x))
const catFor = (c) => (c.shopVat ? { ...golden.catalog, shop: { ...golden.catalog.shop, vat: c.shopVat } } : golden.catalog)
const orderOf = (c) => ({
  ...clone(c.payload), status: 'awaiting_payment', channel: null, createdAt: new Date(golden.nowMs).toISOString(), payments: [], adjustment: { amount: 0, reason: '' },
})
const audit = (order, cat, nowMs = golden.nowMs) => auditOrder(order, cat, { nowMs })
const codes = (r) => r.flags.map((f) => f.code)

let fail = 0
const check = (name, fn) => {
  try { fn(); console.log(`PASS ${name}`) } catch (e) { fail++; console.log(`FAIL ${name}: ${e.message.split('\n')[0]}`) }
}

// 1) ออร์เดอร์ตรงที่ราคาถูกต้องทุกเคส ผ่าน
for (const c of golden.cases.filter((x) => x.payload)) {
  check(`ออร์เดอร์ตรงถูกต้อง ${c.name} ผ่าน`, () => {
    const r = audit(orderOf(c), catFor(c))
    assert.equal(r.ok, true, JSON.stringify(r.flags))
  })
}

const cake = golden.cases.find((c) => c.name === 'cake-pickup')
const promo = golden.cases.find((c) => c.name === 'retail-promos-and-gift')
const noVat = golden.cases.find((c) => c.name === 'no-vat')

// 2) เวลาปิดรับนัดไม่ถูกตรวจซ้ำตอนตรวจย้อนหลัง (ตรวจตอนสร้างแล้ว)
check('เวลาปิดรับนัดไม่ทำให้ตรวจไม่ผ่าน', () => {
  const o = orderOf(cake)
  o.pickupAt = '2026-11-20T13:30'
  assert.equal(audit(o, catFor(cake)).ok, true)
})

// 3) ราคาต่อชิ้นถูกแก้ → unit_price_mismatch
check('ราคาต่อชิ้นถูกแก้ → unit_price_mismatch', () => {
  const o = orderOf(cake)
  o.items[0].unitPrice = o.items[0].unitPrice - 50
  assert.ok(codes(audit(o, catFor(cake))).includes('unit_price_mismatch'))
})

// 4) ราคาฐานของสินค้าหน้าร้านถูกแก้ → base_price_mismatch
check('ราคาฐานสินค้าถูกแก้ → base_price_mismatch', () => {
  const o = orderOf(promo)
  const k = o.items.findIndex((i) => i.kind === 'retail' && !i.promoGift)
  o.items[k].retailPrice = 1
  assert.ok(codes(audit(o, catFor(promo))).includes('base_price_mismatch'))
})

// 5) ประเภทส่วนลดที่ไม่รู้จัก → unknown_discount
check('ส่วนลดประเภทไม่รู้จัก → unknown_discount', () => {
  const o = orderOf(promo)
  const k = o.items.findIndex((i) => (i.discounts || []).length)
  o.items[k].discounts.push({ kind: 'manual', name: 'ลดเอง', amount: 5 })
  assert.ok(codes(audit(o, catFor(promo))).includes('unknown_discount'))
})

// 6) ยอดส่วนลดถูกแก้ → discount_mismatch
check('ยอดส่วนลดถูกแก้ → discount_mismatch', () => {
  const o = orderOf(promo)
  const k = o.items.findIndex((i) => (i.discounts || []).length)
  o.items[k].discounts[0].amount += 5
  assert.ok(codes(audit(o, catFor(promo))).includes('discount_mismatch'))
})

// 7) ของแถมถูกลบออก → gift_mismatch
check('ของแถมถูกลบ → gift_mismatch', () => {
  const o = orderOf(promo)
  o.items = o.items.filter((i) => !i.promoGift)
  assert.ok(codes(audit(o, catFor(promo))).includes('gift_mismatch'))
})

// 9) VAT ที่บันทึกไม่ตรงค่าร้าน → vat_mismatch (เตือน)
check('VAT ที่บันทึกไม่ตรงค่าร้าน → vat_mismatch', () => {
  const o = orderOf(cake)
  o.vat = null
  const r = audit(o, catFor(cake))
  const f = r.flags.find((x) => x.code === 'vat_mismatch')
  assert.ok(f, codes(r).join(','))
  assert.equal(f.severity, 'check')
})

// 10) ปรับราคาเกินยอดสินค้า → adjustment_too_large
check('ปรับราคาเกินยอดสินค้า → adjustment_too_large', () => {
  const o = orderOf(cake)
  o.adjustment = { amount: -1e9, reason: 'x' }
  assert.ok(codes(audit(o, catFor(cake))).includes('adjustment_too_large'))
})

// 11) ออร์เดอร์จากใบเสนอถูกข้าม (ราคาล็อกตอนบันทึกแล้ว)
check('ออร์เดอร์จากใบเสนอถูกข้าม', () => {
  const o = orderOf(cake)
  o.items[0].unitPrice = 1
  o.quoteId = 'qt-x'
  const r = audit(o, catFor(cake))
  assert.equal(r.ok, true)
  assert.equal(r.flags[0].code, 'skipped_quote')
})

// 12) บิลหน้าร้านถูกส่งไปตรวจด้วย posAudit (ช่องทาง pos)
check('บิลหน้าร้านถูกตรวจด้วย posAudit', () => {
  const bill = clone(posGolden.bills[0])
  assert.equal(auditOrder(bill, posGolden.catalog).ok, true)
  bill.items[0].unitPrice = 1
  assert.equal(auditOrder(bill, posGolden.catalog).ok, false)
})

// 13) ไม่มีรายการสินค้า → ไม่มีอะไรให้ตรวจ
check('ไม่มีรายการสินค้าให้ตรวจ', () => {
  assert.equal(auditDirectOrder({ items: [] }, golden.catalog, { nowMs: golden.nowMs }).ok, true)
})

console.log(fail ? `\n✗ ไม่ผ่าน ${fail} ข้อ` : '\n✓ orderAudit: ผ่านทั้งหมด')
process.exit(fail ? 1 : 0)
