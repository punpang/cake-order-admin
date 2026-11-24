// ทดสอบราคาออร์เดอร์สั่งล่วงหน้า (src/lib/preorderPrice.js) · รัน: node src/lib/preorderPrice.test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { priceCampaignOrder } from './preorderPrice.js'

const golden = JSON.parse(readFileSync(new URL('./quotePrice.golden.json', import.meta.url), 'utf8'))
const base = () => JSON.parse(JSON.stringify(golden.catalog))
const nowMs = golden.nowMs
const campaign = (over = {}) => ({
  id: 'pc_t', parcel: { enabled: false }, deals: [],
  items: [{ retailId: 'rt1', dayCap: null }, { retailId: 'rt3', dayCap: null }, { retailId: 'rt8', dayCap: null }],
  ...over,
})
const parcelCat = () => {
  const c = base()
  c.shop.parcel = { fee: 10, boxes: [{ name: 'S', dims: { w: 20, l: 20, h: 20 }, boxG: 100, price: 15 }], steps: [1000, 2000], prices: { S: [60, 90] } }
  for (const r of c.retailItems) if (['rt1', 'rt3'].includes(r.id)) Object.assign(r, { weightG: 800, dimsCm: { w: 20, l: 20, h: 10 } })
  return c
}

let fail = 0
const check = (name, fn) => { try { fn(); console.log(`PASS ${name}`) } catch (e) { fail++; console.log(`FAIL ${name}: ${e.message.split('\n')[0]}`) } }

check('สินค้าไม่อยู่ในแคมเปญ → ปฏิเสธ', () => {
  const r = priceCampaignOrder({ campaign: campaign(), catalog: base(), lines: [{ retailId: 'rt2', qty: 1 }], pickupDate: '2099-12-24', fulfillment: 'pickup', nowMs })
  assert.equal(r.ok, false)
  assert.equal(r.itemId, 'rt2')
})
check('รับที่ร้าน: ราคารวมตรงกับ orderTotals และไม่มีค่าส่ง', () => {
  const r = priceCampaignOrder({ campaign: campaign(), catalog: base(), lines: [{ retailId: 'rt1', qty: 2 }], pickupDate: '2099-12-24', fulfillment: 'pickup', nowMs })
  assert.equal(r.ok, true, r.error)
  assert.equal(r.order.shippingFee, 0)
  assert.equal(r.totals.total, 150)
})
check('ส่งพัสดุ: ค่าส่งมาจากตารางพัสดุ ไม่ใช่ค่าที่ผู้ใช้ส่ง', () => {
  const c = campaign({ parcel: { enabled: true } })
  const r = priceCampaignOrder({ campaign: c, catalog: parcelCat(), lines: [{ retailId: 'rt1', qty: 1 }], pickupDate: '2099-12-24', fulfillment: 'delivery', nowMs })
  assert.equal(r.ok, true, r.error)
  assert.equal(r.order.shippingFee, 85) // ค่าธรรมเนียม 10 + กล่อง 15 + ขนส่ง 60
  assert.equal(r.snapshot.parcel.chargeableG, 900)
  assert.equal(r.snapshot.parcel.shipping, 60)
})
check('ส่งพัสดุแต่แคมเปญไม่เปิดส่งพัสดุ → ปฏิเสธ', () => {
  const r = priceCampaignOrder({ campaign: campaign(), catalog: parcelCat(), lines: [{ retailId: 'rt1', qty: 1 }], pickupDate: '2099-12-24', fulfillment: 'delivery', nowMs })
  assert.equal(r.ok, false)
})
check('สินค้าไม่มีน้ำหนักเมื่อส่งพัสดุ → ปฏิเสธพร้อมรหัสสินค้า', () => {
  const c = campaign({ parcel: { enabled: true } })
  const cat = parcelCat()
  cat.retailItems = cat.retailItems.map((r) => (r.id === 'rt3' ? { ...r, weightG: undefined, dimsCm: undefined } : r))
  const r = priceCampaignOrder({ campaign: c, catalog: cat, lines: [{ retailId: 'rt3', qty: 1 }], pickupDate: '2099-12-24', fulfillment: 'delivery', nowMs })
  assert.equal(r.ok, false)
  assert.equal(r.itemId, 'rt3')
})
check('แต้มถูกจำกัดด้วยยอดสินค้า (แต้มที่ขอเกินยอดจะถูกตัดลง)', () => {
  const r = priceCampaignOrder({ campaign: campaign(), catalog: base(), lines: [{ retailId: 'rt1', qty: 1 }], pickupDate: '2099-12-24', fulfillment: 'pickup', points: 9999, pointValue: 1, nowMs })
  assert.equal(r.ok, true, r.error)
  assert.equal(r.pointsUsed, 75)
  assert.equal(r.totals.total, 0)
})
check('ส่วนลดตามยอดของแคมเปญถูกนำมาใช้เมื่อยอดถึงขั้น', () => {
  const deals = [{ kind: 'spend_off', name: 'ครบ 500 ลด 50', tiers: [{ min: 500, type: 'amount', value: 50 }] }]
  const r = priceCampaignOrder({ campaign: campaign({ deals }), catalog: base(), lines: [{ retailId: 'rt8', qty: 2 }], pickupDate: '2099-12-24', fulfillment: 'pickup', nowMs })
  assert.equal(r.ok, true, r.error)
  assert.equal(r.totals.total, 910)
})
check('โปรทั้งร้านที่ไม่ใช่ของแคมเปญไม่ถูกนำมาใช้', () => {
  const cat = base()
  cat.posDeals = [{ kind: 'spend_off', id: 'x', name: 'โปรทั้งร้าน', active: true, schedule: { from: '', to: '', days: [], timeFrom: '', timeTo: '' }, tiers: [{ min: 100, type: 'amount', value: 40 }] }]
  const r = priceCampaignOrder({ campaign: campaign(), catalog: cat, lines: [{ retailId: 'rt8', qty: 1 }], pickupDate: '2099-12-24', fulfillment: 'pickup', nowMs })
  assert.equal(r.ok, true, r.error)
  assert.equal(r.totals.total, 480)
})

check('ส่วนลดค่าส่ง: ยอดสินค้าถึงขั้น → ค่าส่งลดตามขั้น และบันทึกใน snapshot', () => {
  const c = campaign({ parcel: { enabled: true }, shipOff: [{ min: 60, value: 20 }] })
  const r = priceCampaignOrder({ campaign: c, catalog: parcelCat(), lines: [{ retailId: 'rt1', qty: 1 }], pickupDate: '2099-12-24', fulfillment: 'delivery', nowMs })
  assert.equal(r.ok, true, r.error)
  assert.equal(r.order.shippingFee, 65)
  assert.deepEqual(r.snapshot.shipDiscount, { tier: 60, amount: 20 })
})
check('ส่วนลดค่าส่ง: ยอดสินค้าไม่ถึงขั้น → ค่าส่งเท่าเดิม', () => {
  const c = campaign({ parcel: { enabled: true }, shipOff: [{ min: 80, value: 20 }] })
  const r = priceCampaignOrder({ campaign: c, catalog: parcelCat(), lines: [{ retailId: 'rt1', qty: 1 }], pickupDate: '2099-12-24', fulfillment: 'delivery', nowMs })
  assert.equal(r.order.shippingFee, 85)
  assert.equal(r.snapshot.shipDiscount.amount, 0)
})
check('ส่วนลดค่าส่ง: รับที่ร้านไม่ได้ส่วนลด แม้ยอดถึงขั้น', () => {
  const c = campaign({ parcel: { enabled: true }, shipOff: [{ min: 60, value: 20 }] })
  const r = priceCampaignOrder({ campaign: c, catalog: parcelCat(), lines: [{ retailId: 'rt1', qty: 1 }], pickupDate: '2099-12-24', fulfillment: 'pickup', nowMs })
  assert.equal(r.order.shippingFee, 0)
  assert.equal(r.snapshot.shipDiscount.amount, 0)
})
check('ส่วนลดค่าส่ง: นับยอดหลังหักคะแนน (75 − 10 = 65 < 70 → ไม่ได้ส่วนลด)', () => {
  const c = campaign({ parcel: { enabled: true }, shipOff: [{ min: 70, value: 20 }] })
  const r = priceCampaignOrder({ campaign: c, catalog: parcelCat(), lines: [{ retailId: 'rt1', qty: 1 }], pickupDate: '2099-12-24', fulfillment: 'delivery', points: 10, pointValue: 1, nowMs })
  assert.equal(r.ok, true, r.error)
  assert.equal(r.snapshot.shipDiscount.amount, 0)
})

console.log(fail ? `${fail} FAILED` : 'ALL PASS')
process.exit(fail ? 1 : 0)
