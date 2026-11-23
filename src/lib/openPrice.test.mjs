// ทดสอบการตรวจราคาสินค้าไม่กำหนดราคา (openPrice) และการปฏิเสธจากเซิร์ฟเวอร์ (buildQuotePayload)
import assert from 'node:assert/strict'
import { openPriceOk } from './openPrice.js'
import { buildQuotePayload } from './quotePrice.js'

let pass = 0
const t = (name, fn) => { fn(); pass++; console.log('PASS', name) }

t('ราคาที่ยอมรับ: จำนวนบวก ทศนิยมไม่เกิน 2 ตำแหน่ง', () => {
  assert.deepEqual(openPriceOk('150'), { ok: true, value: 150, error: '' })
  assert.equal(openPriceOk('99.5').value, 99.5)
  assert.equal(openPriceOk(' 12.25 ').value, 12.25)
})

t('ราคาที่ปฏิเสธ: ว่าง 0 ติดลบ ทศนิยมเกิน ตัวอักษร เกินเพดาน', () => {
  for (const bad of ['', '0', '0.00', '-5', '1.234', 'abc', '1e3', '1000001']) assert.equal(openPriceOk(bad).ok, false, bad)
})

const cat = {
  retailItems: [
    { id: 'p1', name: 'ขนมปัง', price: 40, active: true, category: 'ขนม' },
    { id: 'op', name: 'ของฝากตามราคา', price: 0, active: true, category: 'ของฝาก', openPrice: true },
  ],
  optionGroups: [], priceLists: [], bundles: [], posDiscounts: [], posBundles: [], posDeals: [], shop: {},
}
const draft = (items) => ({ fulfillment: 'pickup', pickupAt: '2099-01-01T10:00', items, customerId: null })

t('เซิร์ฟเวอร์: สินค้าไม่กำหนดราคาสั่งผ่านเว็บไม่ได้', () => {
  const r = buildQuotePayload({ draft: draft([{ id: 'l1', kind: 'retail', retailId: 'op', qty: 1, retailPrice: 1 }]), customerId: null, catalog: cat, nowMs: Date.parse('2026-11-24T03:00:00Z'), checkClosure: false })
  assert.equal(r.ok, false)
  assert.match(r.error, /หน้าร้าน/)
})

t('เซิร์ฟเวอร์: สินค้าปกติยังสั่งได้ (ไม่กระทบ)', () => {
  const r = buildQuotePayload({ draft: draft([{ id: 'l1', kind: 'retail', retailId: 'p1', qty: 2, retailPrice: 40 }]), customerId: null, catalog: cat, nowMs: Date.parse('2026-11-24T03:00:00Z'), checkClosure: false })
  assert.equal(r.ok, true, r.error)
})

console.log(`ผ่าน ${pass} การทดสอบ`)
