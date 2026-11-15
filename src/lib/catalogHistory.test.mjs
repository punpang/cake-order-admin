// ทดสอบประวัติแคตาล็อก (ย้อนราคาไปยังเวลาที่สร้างออร์เดอร์) และการตรวจค่าส่ง/การชำระของออร์เดอร์ตรง
// รัน: node src/lib/catalogHistory.test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { catalogAt } from './catalogHistory.js'
import { auditDirectOrder } from './orderAudit.js'
import { orderTotals } from './pricing.js'

const golden = JSON.parse(readFileSync(new URL('./quotePrice.golden.json', import.meta.url), 'utf8'))
const clone = (x) => JSON.parse(JSON.stringify(x))
const catFor = (c) => (c.shopVat ? { ...golden.catalog, shop: { ...golden.catalog.shop, vat: c.shopVat } } : golden.catalog)
const orderOf = (c) => ({ ...clone(c.payload), status: 'awaiting_payment', channel: null, createdAt: new Date(golden.nowMs).toISOString(), payments: [], adjustment: { amount: 0, reason: '' } })
const codes = (r) => r.flags.map((f) => f.code)
const T1 = golden.nowMs // เวลาที่สร้างออร์เดอร์
const T2 = golden.nowMs + 3600000 // เวลาที่แคตาล็อกเปลี่ยนภายหลัง

let fail = 0
const check = (name, fn) => {
  try { fn(); console.log(`PASS ${name}`) } catch (e) { fail++; console.log(`FAIL ${name}: ${e.message.split('\n')[0]}`) }
}

// ---- 1) ย้อนแคตาล็อก ----
const base = { retailItems: [{ id: 'a', name: 'A', price: 100, active: true, sizeId: 's1' }, { id: 'b', name: 'B', price: 50, active: true }], priceLists: [{ id: 'p-new' }] }
const rowOf = (x, price) => { const { id, name, active, ...rest } = x; return { id, name, price, active, data: rest } }

check('ไม่มีการเปลี่ยนหลังเวลาที่สนใจ → ได้แคตาล็อกเดิม', () => {
  const r = catalogAt(base, [], T1)
  assert.deepStrictEqual(r.retailItems, base.retailItems)
})
check('ราคาสินค้าถูกแก้หลังเวลาที่สนใจ → คืนราคาเดิม', () => {
  const cur = clone(base)
  cur.retailItems[0].price = 120
  const r = catalogAt(cur, [{ source: 'item', key: 'a', old: rowOf(base.retailItems[0], 100), changedAt: new Date(T2).toISOString() }], T1)
  assert.equal(r.retailItems.find((x) => x.id === 'a').price, 100)
  assert.equal(r.retailItems.find((x) => x.id === 'a').sizeId, 's1')
})
check('สินค้าถูกสร้างหลังเวลาที่สนใจ → ตอนนั้นยังไม่มี', () => {
  const cur = clone(base)
  cur.retailItems.push({ id: 'c', name: 'C', price: 10, active: true })
  const r = catalogAt(cur, [{ source: 'item', key: 'c', old: null, changedAt: new Date(T2).toISOString() }], T1)
  assert.equal(r.retailItems.some((x) => x.id === 'c'), false)
})
check('สินค้าถูกลบหลังเวลาที่สนใจ → ตอนนั้นยังมี', () => {
  const cur = clone(base)
  cur.retailItems = cur.retailItems.filter((x) => x.id !== 'b')
  const r = catalogAt(cur, [{ source: 'item', key: 'b', old: rowOf(base.retailItems[1], 50), changedAt: new Date(T2).toISOString() }], T1)
  assert.equal(r.retailItems.find((x) => x.id === 'b').price, 50)
})
check('การตั้งค่าราคาชุดถูกแก้หลังเวลาที่สนใจ → คืนค่าเดิม', () => {
  const cur = { ...base, priceLists: [{ id: 'p-changed' }] }
  const r = catalogAt(cur, [{ source: 'config', key: 'priceLists', old: [{ id: 'p-old' }], changedAt: new Date(T2).toISOString() }], T1)
  assert.deepStrictEqual(r.priceLists, [{ id: 'p-old' }])
})
check('การเปลี่ยนแปลงก่อนเวลาที่สนใจไม่ถูกย้อน', () => {
  const cur = clone(base)
  cur.retailItems[0].price = 120
  const before = new Date(T1 - 3600000).toISOString()
  const r = catalogAt(cur, [{ source: 'item', key: 'a', old: rowOf(base.retailItems[0], 100), changedAt: before }], T1)
  assert.equal(r.retailItems.find((x) => x.id === 'a').price, 120)
})

// ---- 2) ตรวจออร์เดอร์ด้วยราคา ณ เวลาที่สร้าง ----
const retailCase = golden.cases.find((c) => c.name === 'retail-promos-and-gift')
const line = retailCase.payload.items.findIndex((i) => i.kind === 'retail' && !i.promoGift)
const rid = retailCase.payload.items[line].retailId
check('ราคาเปลี่ยนหลังสร้าง: ตรวจด้วยแคตาล็อกวันนี้ถูกรายงาน แต่ตรวจด้วยราคาเมื่อสร้างผ่าน', () => {
  const cat = catFor(retailCase)
  const cur = clone(cat)
  const item = cur.retailItems.find((x) => x.id === rid)
  const oldPrice = item.price
  item.price = oldPrice + 10
  const changes = [{ source: 'item', key: rid, old: rowOf(item, oldPrice), changedAt: new Date(T2).toISOString() }]
  const o = orderOf(retailCase)
  const today = auditDirectOrder(o, cur, { nowMs: T1 })
  assert.equal(today.ok, false, 'ควรถูกรายงานเมื่อใช้ราคาวันนี้')
  const atCreate = auditDirectOrder(o, catalogAt(cur, changes, T1), { nowMs: T1 })
  assert.equal(atCreate.ok, true, codes(atCreate).join(','))
})

// ---- 3) ค่าส่ง ----
const delivery = { enabled: true, freeKm: 0, perKm: 10, minFee: 0, roundTo: 5 }
const dCase = golden.cases.find((c) => c.name === 'delivery-computed-fee')
const withDelivery = (o) => ({ ...o, fulfillment: 'delivery', distanceKm: 4.5, feeManual: false, pickupAt: dCase.payload.pickupAt })
const catD = { ...golden.catalog, shop: { ...golden.catalog.shop, delivery } }
const auditShip = (o) => auditDirectOrder(o, catD, { nowMs: T1 })
check('ค่าส่งไม่ตรงระยะทางและการตั้งค่า → shipping_mismatch', () => {
  const o = withDelivery(orderOf(dCase)); o.shippingFee = 60
  assert.ok(codes(auditShip(o)).includes('shipping_mismatch'), codes(auditShip(o)).join(','))
})
check('ค่าส่งตรงสูตร → ผ่าน', () => {
  const o = withDelivery(orderOf(dCase)); o.shippingFee = 45
  assert.equal(auditShip(o).ok, true, codes(auditShip(o)).join(','))
})
check('รับที่ร้านแต่มีค่าส่ง → shipping_on_pickup', () => {
  const o = orderOf(dCase); o.fulfillment = 'pickup'; o.shippingFee = 20
  assert.ok(codes(auditShip(o)).includes('shipping_on_pickup'))
})
check('ตั้งค่าส่งเอง (feeManual) → ไม่เทียบกับสูตร', () => {
  const o = withDelivery(orderOf(dCase)); o.shippingFee = 60; o.feeManual = true
  assert.equal(auditShip(o).ok, true, codes(auditShip(o)).join(','))
})

// ---- 4) การรับชำระ (ตรวจภายใน) ----
const pCase = golden.cases.find((c) => c.name === 'cake-pickup')
const totalOf = (o) => orderTotals(o).total
check('โอนเงินยืนยันโดยไม่มีสลิป → transfer_without_slip', () => {
  const o = orderOf(pCase)
  o.payments = [{ amount: 10, status: 'confirmed', method: 'โอนเงิน' }]
  const r = auditDirectOrder(o, catFor(pCase), { nowMs: T1 })
  assert.ok(codes(r).includes('transfer_without_slip'), codes(r).join(','))
})
check('รับชำระเกินยอดบิล → overpaid', () => {
  const o = orderOf(pCase)
  o.payments = [{ amount: totalOf(o) + 50, status: 'confirmed', method: 'เงินสด', slip: '' }]
  const r = auditDirectOrder(o, catFor(pCase), { nowMs: T1 })
  assert.ok(codes(r).includes('overpaid'), codes(r).join(','))
})
check('ยอดชำระตรงยอดบิลด้วยเงินสด → ผ่าน', () => {
  const o = orderOf(pCase)
  o.payments = [{ amount: totalOf(o), status: 'confirmed', method: 'เงินสด', slip: '' }]
  assert.equal(auditDirectOrder(o, catFor(pCase), { nowMs: T1 }).ok, true)
})
check('ออร์เดอร์ที่ยกเลิกแล้วไม่ตรวจการชำระ', () => {
  const o = orderOf(pCase)
  o.status = 'cancelled'
  o.payments = [{ amount: totalOf(o) + 50, status: 'confirmed', method: 'โอนเงิน', slip: '' }]
  assert.equal(auditDirectOrder(o, catFor(pCase), { nowMs: T1 }).ok, true)
})

console.log(fail ? `\n✗ ไม่ผ่าน ${fail} ข้อ` : '\n✓ catalogHistory: ผ่านทั้งหมด')
process.exit(fail ? 1 : 0)
