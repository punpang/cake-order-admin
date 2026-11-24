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
  c.shop.parcel = { boxG: 100, volDivisor: 5000, rates: [{ upToG: 1000, price: 60 }, { upToG: 2000, price: 90 }] }
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
  assert.equal(r.order.shippingFee, 60)
  assert.equal(r.snapshot.parcel.chargeableG, 900)
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

console.log(fail ? `${fail} FAILED` : 'ALL PASS')
process.exit(fail ? 1 : 0)
