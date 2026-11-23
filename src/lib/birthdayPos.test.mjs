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

// รอบ 2: ใบเสนอ/ออร์เดอร์บนเว็บ คิดส่วนลดเดือนเกิดจากสิทธิที่เซิร์ฟเวอร์ส่งให้ (ไม่มีสิทธิ = ไม่คิด)
import { readFileSync } from 'node:fs'
import { buildQuotePayload } from './quotePrice.js'
const golden = JSON.parse(readFileSync(new URL('./quotePrice.golden.json', import.meta.url), 'utf8'))
const draft = { fulfillment: 'pickup', pickupAt: '2026-11-30T10:00', items: [{ id: 'b1', kind: 'retail', retailId: 'rt1', retailPrice: 75, sizeId: null, typeId: null, mods: [], qty: 4, selections: {}, note: '', images: [], tiers: [] }] }
const quote = (birth) => buildQuotePayload({ draft, customerId: 'bd-web', catalog: golden.catalog, nowMs: golden.nowMs, birth })
const lv4 = { eligible: true, active: true, rate: 10, cap: 50, cakeCategories: ['เค้กชิ้น'] }
{
  const withBirth = quote(lv4)
  assert.equal(withBirth.ok, true, withBirth.error)
  // 75 × 4 = 300 → 10% = 30 (ต่ำกว่าเพดาน 50)
  assert.equal(withBirth.payload.birthdayDiscount?.amount, 30)
  const noBirth = quote(null)
  assert.equal(noBirth.payload.birthdayDiscount, undefined)
  const notEligible = quote({ ...lv4, eligible: false, rate: 0 })
  assert.equal(notEligible.payload.birthdayDiscount, undefined)
  console.log('ok - ใบเสนอคิดส่วนลดเดือนเกิด 30 บาท (เค้กชิ้น 300 × 10%) · ไม่มีสิทธิ = ไม่คิด')
}
