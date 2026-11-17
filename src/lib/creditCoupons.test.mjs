// ทดสอบคูปองคืนเงิน (credit) การคืนเป็นคูปอง การแปลงคะแนนเป็นคูปอง และการถอดคะแนนลดราคา · รัน: node src/lib/creditCoupons.test.mjs
import assert from 'node:assert/strict'
import { couponQuoteOf, couponTermsText, creditBalanceOf, isCredit, modeOf } from './coupons.js'
import { REFUND_CHOICES, REFUND_METHODS, refundErrors } from './refund.js'
import { conversionPlan, couponPhase, couponUsable } from './loyalty.js'

let fail = 0
const t = (name, fn) => { try { fn(); console.log(`PASS ${name}`) } catch (e) { fail++; console.log(`FAIL ${name}: ${e.message}`) } }

const line = (id, unitPrice, qty) => ({ id, retailId: id, name: id, unitPrice, qty, kind: 'retail' })
const order = (items, extra = {}) => ({ id: 'O1', items, fulfillment: 'pickup', payments: [], adjustment: { amount: 0, reason: '' }, pointsUsed: null, couponsUsed: [], vat: undefined, ...extra })
const credit = (balance, extra = {}) => ({ id: 'cp1', type: 'discount', mode: 'credit', amount: balance, balance, holds: {}, status: 'pending', expiresAt: null, ...extra })

t('คูปองคืนเงินถูกจำแนกเป็น credit และอ่านยอดคงเหลือได้', () => {
  assert.equal(modeOf(credit(100)), 'credit')
  assert.equal(isCredit(credit(100)), true)
  assert.equal(isCredit({ mode: 'fixed', amount: 50 }), false)
  assert.equal(creditBalanceOf(credit(120.5)), 120.5)
  assert.equal(creditBalanceOf({ balance: -3 }), 0)
  assert.equal(creditBalanceOf({}), 0)
})

t('ใช้คูปองคืนเงินได้ไม่เกินยอดคงเหลือและไม่เกินยอดบิล', () => {
  const big = couponQuoteOf(credit(500), order([line('a', 300, 1)]))
  assert.deepEqual([big.ok, big.amount], [true, 300])
  const small = couponQuoteOf(credit(80), order([line('a', 300, 1)]))
  assert.deepEqual([small.ok, small.amount], [true, 80])
})

t('คูปองคืนเงินที่ยอดหมดแล้วใช้ไม่ได้', () => {
  const q = couponQuoteOf(credit(0), order([line('a', 300, 1)]))
  assert.equal(q.ok, false)
  assert.match(q.reason, /หมด/)
})

t('ข้อความเงื่อนไขของคูปองคืนเงินแสดงยอดคงเหลือ', () => {
  assert.match(couponTermsText(credit(75)), /ยอดคงเหลือ.*75.*ใช้ได้หลายครั้ง/)
})

t('คูปองคืนเงินใช้ไม่ได้เมื่อยอดคงเหลือเป็นศูนย์ และใช้ได้เมื่อยังมียอด', () => {
  assert.equal(couponUsable(credit(0), '2026-11-17', '2026-11-17T00:00:00Z'), false)
  assert.equal(couponUsable(credit(10), '2026-11-17', '2026-11-17T00:00:00Z'), true)
  assert.equal(couponUsable(credit(10, { status: 'void' }), '2026-11-17', '2026-11-17T00:00:00Z'), false)
})

t('คูปองที่ยกเลิกแล้ว (void) แสดงสถานะ void และใช้ไม่ได้', () => {
  assert.equal(couponPhase({ status: 'void' }, '2026-11-17'), 'void')
  assert.equal(couponUsable({ status: 'void', mode: 'fixed' }, '2026-11-17'), false)
})

t('คืนเป็นคูปองได้เฉพาะออร์เดอร์ที่ผูกลูกค้า และไม่มีการคืนเป็นคะแนนแล้ว', () => {
  assert.match(refundErrors([{ method: 'credit', amount: 100 }], { paid: 500, canCredit: false }), /ไม่ได้/)
  assert.equal(refundErrors([{ method: 'credit', amount: 100 }], { paid: 500, canCredit: true }), '')
  assert.match(refundErrors([{ method: 'points', amount: 100 }], { paid: 500, canCredit: true }), /ไม่ได้แล้ว/)
  assert.deepEqual(REFUND_CHOICES, ['cash', 'transfer', 'credit'])
  assert.match(REFUND_METHODS.points, /เดิม/)
})

t('ยอดคืนรวมทุกช่องทางต้องไม่เกินยอดที่ชำระแล้ว', () => {
  assert.match(refundErrors([{ method: 'cash', amount: 300 }, { method: 'credit', amount: 250 }], { paid: 500, canCredit: true }), /เกิน/)
  assert.equal(refundErrors([{ method: 'cash', amount: 200 }, { method: 'credit', amount: 300 }], { paid: 500, canCredit: true }), '')
})

t('แผนแปลงคะแนนรวมเฉพาะคะแนนที่ยังใช้ได้ และคิดมูลค่าตามมูลค่าต่อคะแนน', () => {
  const ledger = [
    { id: 'a', delta: 100, remaining: 40, expiresAt: '2027-01-01' },
    { id: 'b', delta: 60, remaining: 60, expiresAt: '2026-10-01' }, // หมดอายุแล้ว ไม่รวม
    { id: 'c', delta: 50, remaining: 0, expiresAt: '2027-01-01' }, // ใช้หมดแล้ว ไม่รวม
  ]
  assert.deepEqual(conversionPlan(ledger, '2026-11-17', 1), { points: 40, amount: 40 })
  assert.deepEqual(conversionPlan(ledger, '2026-11-17', 2), { points: 40, amount: 80 })
})

t('ลูกค้าที่ไม่มีคะแนนที่ใช้ได้ แปลงไม่ได้ (null)', () => {
  assert.equal(conversionPlan([], '2026-11-17', 1), null)
  assert.equal(conversionPlan([{ id: 'x', delta: 10, remaining: 10, expiresAt: '2026-01-01' }], '2026-11-17', 1), null)
})

console.log(fail ? `ไม่ผ่าน ${fail} กรณี` : 'ผ่านทุกกรณี')
process.exitCode = fail ? 1 : 0
