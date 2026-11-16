// ทดสอบคูปองส่วนลด 3 แบบ (ลดเป็นบาท / ซื้อครบ x บาท ลด y% / ซื้อสินค้า x ลด y%) · รัน: node src/lib/coupons.test.mjs
import assert from 'node:assert/strict'
import { couponFieldsOf, couponQuoteOf, couponTermsText, modeOf, productGoodsOf, quoteCouponList, validateCouponReward } from './coupons.js'

let pass = 0
const t = (name, fn) => { fn(); pass++; console.log('PASS', name) }

// บรรทัดสินค้า (retailId = รหัสสินค้า) · ออร์เดอร์ตัวอย่างไม่มีค่าส่ง/VAT/คะแนน
const line = (id, unitPrice, qty, retailId = id, extra = {}) => ({ id, retailId, name: id, unitPrice, qty, kind: 'retail', ...extra })
const order = (items, extra = {}) => ({ id: 'O1', items, fulfillment: 'pickup', payments: [], adjustment: { amount: 0, reason: '' }, pointsUsed: null, couponsUsed: [], vat: undefined, ...extra })
const fixed = (over = {}) => ({ id: 'c0', name: 'ลด 50', amount: 50, minSpend: 200, ...over })
const spend = (over = {}) => ({ id: 'c1', name: 'ซื้อครบ 500 ลด 10%', mode: 'spend', minSpend: 500, pct: 10, cap: 100, amount: 100, ...over })
const product = (over = {}) => ({ id: 'c2', name: 'ซื้อคัพเค้ก ลด 20%', mode: 'product', productId: 'cup', productName: 'คัพเค้ก', pct: 20, cap: 60, amount: 60, ...over })

t('คูปองแบบเดิม (ไม่มี mode) = ลดเป็นบาท: ขั้นต่ำยอดสินค้า และตัดให้ไม่เกินยอดที่ต้องชำระ', () => {
  assert.equal(modeOf({ amount: 50 }), 'fixed')
  assert.deepEqual(couponQuoteOf(fixed(), order([line('a', 300, 1)])), { ok: true, amount: 50, reason: '' })
  const q = couponQuoteOf(fixed(), order([line('a', 150, 1)]))
  assert.equal(q.ok, false)
  assert.match(q.reason, /200/)
  assert.equal(couponQuoteOf(fixed({ minSpend: 0, amount: 500 }), order([line('a', 120, 1)])).amount, 120)
})

t('ซื้อครบ x บาท ลด y% สูงสุด z บาท: ยอดสินค้าต้องถึง x แล้วลด y% ไม่เกิน z', () => {
  const c = spend()
  assert.equal(couponQuoteOf(c, order([line('a', 400, 1)])).ok, false) // 400 < 500
  assert.equal(couponQuoteOf(c, order([line('a', 500, 1)])).amount, 50) // ถึงพอดี 10%
  assert.equal(couponQuoteOf(c, order([line('a', 600, 1)])).amount, 60) // 10% ของ 600
  assert.equal(couponQuoteOf(c, order([line('a', 1500, 1)])).amount, 100) // 10% = 150 แต่ลดสูงสุด 100
})

t('ซื้อสินค้า x ลด y% สูงสุด z บาท: ลดจากยอดของสินค้านั้นเท่านั้น และไม่นับของแถม', () => {
  const c = product()
  assert.equal(couponQuoteOf(c, order([line('cup', 150, 2), line('other', 1000, 1)])).amount, 60) // คัพเค้ก 300 → 20% = 60 (เพดาน 60)
  assert.equal(couponQuoteOf(c, order([line('cup', 100, 1), line('other', 1000, 1)])).amount, 20) // 100 → 20
  const none = couponQuoteOf(c, order([line('other', 1000, 1)]))
  assert.equal(none.ok, false)
  assert.match(none.reason, /คัพเค้ก/)
  assert.equal(couponQuoteOf(c, order([line('cup', 100, 1, 'cup', { promoGift: true })])).ok, false)
  assert.equal(productGoodsOf(order([line('', 10, 1, '')]), ''), 0) // ไม่กำหนดสินค้า = 0 (ไม่จับรายการที่ไม่มีรหัส)
})

t('ส่วนลดของแบบ % ไม่เกินยอดที่ต้องชำระ ณ ตอนใช้ (คูปองอื่นในออร์เดอร์ถูกหักก่อน)', () => {
  const o = order([line('a', 600, 1)], { couponsUsed: [{ couponId: 'x', name: 'x', amount: 580 }] })
  assert.equal(couponQuoteOf(spend(), o).amount, 20)
})

t('คูปองหลายใบ: คิดตามลำดับ และแยกใบที่ไม่เข้าเงื่อนไข', () => {
  const o = order([line('cup', 300, 1), line('a', 200, 1)]) // รวม 500
  const r = quoteCouponList(o, [product(), spend({ minSpend: 900 }), fixed({ minSpend: 0, amount: 30 })])
  assert.deepEqual(r.used.map((x) => [x.couponId, x.amount]), [['c2', 60], ['c0', 30]])
  assert.equal(r.rejected.length, 1)
  assert.equal(r.rejected[0].coupon.id, 'c1')
})

t('ข้อความเงื่อนไขของแต่ละแบบ', () => {
  assert.match(couponTermsText(spend()), /^ซื้อครบ .+ ลด 10% สูงสุด .+/)
  assert.match(couponTermsText(product()), /^ซื้อ คัพเค้ก ลด 20% สูงสุด /)
  assert.match(couponTermsText(fixed()), /^ส่วนลด .+ \(ขั้นต่ำ .+\)$/)
  assert.match(couponTermsText({ amount: 50 }), /^ส่วนลด /)
})

t('ฟิลด์ที่คัดลอกจากของแลก: แบบซื้อครบเก็บยอดขั้นต่ำ แบบซื้อสินค้าเก็บรหัสและชื่อสินค้า', () => {
  assert.deepEqual(couponFieldsOf({ mode: 'spend', minSpend: '500', pct: '10', cap: '100', productId: 'x' }), { mode: 'spend', pct: 10, cap: 100, amount: 100, minSpend: 500, productId: '', productName: '' })
  const p = couponFieldsOf({ mode: 'product', productId: 'cup', productName: 'คัพเค้ก', pct: 20, cap: 60, minSpend: 999 })
  assert.equal(p.minSpend, 0)
  assert.equal(p.productId, 'cup')
  assert.equal(p.productName, 'คัพเค้ก')
  assert.equal(couponFieldsOf({ amount: '50', minSpend: '200' }).mode, 'fixed')
})

t('ตรวจของแลกประเภทคูปองก่อนบันทึก', () => {
  assert.equal(validateCouponReward({ mode: 'fixed', amount: '50' }), '')
  assert.match(validateCouponReward({ mode: 'fixed', amount: '' }), /มูลค่า/)
  assert.match(validateCouponReward({ mode: 'spend', minSpend: '', pct: '10', cap: '100' }), /ยอดซื้อขั้นต่ำ/)
  assert.match(validateCouponReward({ mode: 'product', productId: '', pct: '10', cap: '100' }), /เลือกสินค้า/)
  assert.match(validateCouponReward({ mode: 'spend', minSpend: '500', pct: '0', cap: '100' }), /ลดกี่ %/)
  assert.match(validateCouponReward({ mode: 'spend', minSpend: '500', pct: '101', cap: '100' }), /ลดกี่ %/)
  assert.match(validateCouponReward({ mode: 'product', productId: 'cup', pct: '10', cap: '0' }), /ลดสูงสุด/)
  assert.equal(validateCouponReward({ mode: 'product', productId: 'cup', pct: '12.5', cap: '80' }), '')
})

console.log(`ผ่าน ${pass} กรณี`)
