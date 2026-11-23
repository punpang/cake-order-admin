// ทดสอบส่วนลดเดือนเกิดในยอดรวม POS (orderTotals) · รัน: node src/lib/birthdayPos.test.mjs
import assert from 'node:assert/strict'
import { orderTotals } from './pricing.js'

const base = { items: [{ unitPrice: 500, qty: 2, discounts: [] }], fulfillment: 'pickup', payments: [], couponsUsed: [], pointsUsed: null, adjustment: { amount: 0 }, vat: null }
let fail = 0
const t = (name, fn) => { try { fn(); console.log('ok -', name) } catch (e) { fail++; console.log('FAIL -', name, e.message) } }

t('ส่วนลดเดือนเกิดหักจากยอดรวม (1000 - 50 = 950)', () => assert.equal(orderTotals({ ...base, birthdayDiscount: { amount: 50 } }).total, 950))
t('ไม่มีส่วนลดเดือนเกิด ยอดเดิมไม่เปลี่ยน', () => assert.equal(orderTotals(base).total, 1000))
t('แสดงบรรทัดส่วนลดเดือนเกิดในรายการส่วนลด', () => {
  const lines = orderTotals({ ...base, birthdayDiscount: { amount: 50 } }).discountLines
  assert.ok(lines.some((l) => l.label === 'ส่วนลดเดือนเกิด (หมวดเค้ก)' && l.amount === 50))
})
t('ส่วนลดเดือนเกิดกับ VAT แยก: คิด VAT จากยอดหลังหักส่วนลด', () => {
  const r = orderTotals({ ...base, vat: { rate: 7, mode: 'exclusive' }, birthdayDiscount: { amount: 50 } })
  assert.equal(r.total, 950 + Math.round(950 * 7) / 100)
})
if (fail) { console.log(`ล้ม ${fail} รายการ`); process.exit(1) }
console.log('ผ่านทั้งหมด')
