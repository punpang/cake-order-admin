// เงินพัก (ซ่อนเงิน/ดึงเงิน): ไม่ใช่รายได้ · ยอดที่ลูกค้าต้องจ่าย = total + hold · ยอดค้าง = payable − paid
import assert from 'node:assert/strict'
import { orderTotals } from './pricing.js'

const base = (extra = {}) => ({
  items: [{ unitPrice: 400, qty: 1, id: 'i1', name: 'เค้ก' }],
  fulfillment: 'pickup',
  payments: [],
  ...extra,
})

const cases = [
  {
    name: 'ไม่มีเงินพัก: ยอดเดิมไม่เปลี่ยน (total, balance, hold = 0)',
    run: () => {
      const t = orderTotals(base())
      assert.equal(t.total, 400)
      assert.equal(t.hold, 0)
      assert.equal(t.payable, 400)
      assert.equal(t.balance, 400)
    },
  },
  {
    name: 'เงินพัก 1000 + สินค้า 400: total คงเดิม (รายได้ไม่รวมเงินพัก) · payable = 1400',
    run: () => {
      const t = orderTotals(base({ holdMoney: { kind: 'hide', amount: 1000, notes: { 1000: 1 } } }))
      assert.equal(t.total, 400)
      assert.equal(t.hold, 1000)
      assert.equal(t.payable, 1400)
      assert.equal(t.balance, 1400)
    },
  },
  {
    name: 'ชำระครบ 1400 แล้ว: ยอดค้าง 0',
    run: () => {
      const t = orderTotals(base({
        holdMoney: { kind: 'pull', amount: 1000, notes: { 1000: 1 } },
        payments: [{ id: 'p1', amount: 1400, status: 'confirmed' }],
      }))
      assert.equal(t.balance, 0)
    },
  },
  {
    name: 'เงินพักไม่กระทบ VAT: ฐานภาษีเท่ากับยอดสินค้า + ค่าบริการเท่านั้น',
    run: () => {
      const t = orderTotals(base({ vat: { rate: 7, mode: 'inclusive' }, holdMoney: { kind: 'hide', amount: 1000, notes: {} } }))
      const plain = orderTotals(base({ vat: { rate: 7, mode: 'inclusive' } }))
      assert.equal(t.vat, plain.vat)
      assert.equal(t.beforeVat, plain.beforeVat)
    },
  },
  {
    name: 'เงินพักไม่กระทบแต้ม/คูปอง (ไม่เปลี่ยน couponDiscount/pointsDiscount)',
    run: () => {
      const t = orderTotals(base({ holdMoney: { kind: 'hide', amount: 500, notes: {} }, pointsUsed: { points: 10, amount: 50 } }))
      assert.equal(t.pointsDiscount, 50)
      assert.equal(t.total, 350)
    },
  },
]

let fails = 0
for (const c of cases) {
  try {
    c.run()
    console.log(`ok - ${c.name}`)
  } catch (e) {
    fails++
    console.error(`not ok - ${c.name}\n  ${e.message}`)
  }
}
process.exit(fails ? 1 : 0)
