// ทดสอบสินค้าไม่คำนวณแต้ม (noPoints): ไม่ใช้คูปองส่วนลด และตัดออกจากฐานยอดคูปอง
import assert from 'node:assert/strict'
import { couponGoodsOf, couponQuoteOf, productGoodsOf } from './coupons.js'

let pass = 0
const t = (name, fn) => { fn(); pass++; console.log('PASS', name) }
const line = (id, unitPrice, qty, extra = {}) => ({ id, retailId: id, name: id, unitPrice, qty, kind: 'retail', ...extra })
const order = (items) => ({ id: 'O1', items, fulfillment: 'pickup', payments: [], adjustment: { amount: 0, reason: '' }, pointsUsed: null, couponsUsed: [], vat: undefined })
const fixed = { id: 'c0', name: 'ลด 50', amount: 50, minSpend: 0 }
const spend = { id: 'c1', name: 'ซื้อครบ 500 ลด 10%', mode: 'spend', minSpend: 500, pct: 10, cap: 100 }
const product = { id: 'c2', name: 'คัพเค้ก ลด 20%', mode: 'product', productId: 'cup', productName: 'คัพเค้ก', pct: 20, cap: 60 }

t('ยอดฐานคูปองไม่รวมสินค้าไม่คำนวณแต้ม', () => {
  assert.equal(couponGoodsOf(order([line('a', 300, 1), line('b', 200, 1, { noPoints: true })])), 300)
})

t('ซื้อครบ x บาท: นับเฉพาะสินค้าปกติ (ยอดปกติไม่ถึงเกณฑ์ แม้รวมแล้วเกิน)', () => {
  const q = couponQuoteOf(spend, order([line('a', 400, 1), line('b', 300, 1, { noPoints: true })]))
  assert.equal(q.ok, false)
  assert.match(q.reason, /500/)
})

t('ส่วนลดไม่ไปลดสินค้าไม่คำนวณแต้ม (ลดได้เฉพาะส่วนปกติ)', () => {
  const q = couponQuoteOf(fixed, order([line('a', 30, 1), line('b', 500, 1, { noPoints: true })]))
  assert.equal(q.ok, true)
  assert.equal(q.amount, 30)
})

t('ซื้อสินค้าที่กำหนด: สินค้าไม่คำนวณแต้มไม่นับ', () => {
  assert.equal(productGoodsOf(order([line('cup', 100, 1, { noPoints: true })]), 'cup'), 0)
  const q = couponQuoteOf(product, order([line('cup', 100, 1, { noPoints: true })]))
  assert.equal(q.ok, false)
})

t('ออร์เดอร์ปกติไม่เปลี่ยนผล (ไม่มี noPoints)', () => {
  assert.deepEqual(couponQuoteOf(fixed, order([line('a', 300, 1)])), { ok: true, amount: 50, reason: '' })
})

console.log(`ผ่าน ${pass} การทดสอบ`)
