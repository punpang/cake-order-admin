// เงินพักในระดับ store จริง: แก้เงินพัก · งวดแรกต้องครอบคลุมเงินพัก · ยกเลิกคืนเงินพักตามสูตร · เพดานคืนสินค้า · ยกเลิกการลดเงินพัก
// โหลดผ่าน Vite SSR แบบเดียวกับแอป · รัน: node src/data/holdMoney.store.test.mjs
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { createServer } from 'vite'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const server = await createServer({ root: ROOT, server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' })
let fails = 0
try {
  const S = await server.ssrLoadModule('/src/data/store.js')
  const { orderTotals } = await server.ssrLoadModule('/src/lib/pricing.js')

  // ออร์เดอร์จำลอง: สินค้า 400 (ไม่มี VAT) + เงินพัก 1000 · ชำระเงินสดตามที่กำหนด
  const hm = (amount, notes = {}) => ({ kind: 'hide', amount, notes })
  const mk = (over = {}) => ({
    id: 'H1', code: 'H1', channel: 'web', fulfillment: 'pickup', status: 'awaiting_payment', createdAt: '2026-11-01T09:00:00',
    items: [{ id: 'i1', name: 'เค้ก', kind: 'retail', retailId: 'r1', qty: 1, unitPrice: 400, regularPrice: 400, fullPrice: 400, discounts: [], mods: [], specials: [], bundles: [] }],
    adjustment: { amount: 0, reason: '' }, shippingFee: 0, vat: undefined, couponsUsed: [], pointsUsed: null, returns: [], history: [],
    customerId: null, holdMoney: hm(1000, { 1000: 1 }), payments: [], ...over,
  })
  const paid = (id, amount, status = 'confirmed') => ({ id, status, amount, requested: amount, method: 'เงินสด', posMethod: 'cash', reportedBy: 'admin', confirmedBy: 'admin', confirmedAt: '2026-11-01T10:00:00', qrRef: 'Q' + id })

  const cases = []
  const t = (name, fn) => cases.push([name, fn])

  t('แก้เงินพักเพิ่ม (ไม่มีส่วนเกิน) → สำเร็จ ไม่มีการคืน', () => {
    const o = mk({ payments: [paid('p1', 1000)], status: 'payment_confirmed' })
    const r = S.setHoldMoney(o, hm(1500, { 1000: 1, 500: 1 }), { reason: 'ลูกค้าเพิ่มเงิน', refunds: [] })
    assert.equal(r.error, undefined, r.error)
    assert.equal(o.holdMoney.amount, 1500)
    assert.equal(o.returns.length, 0)
    assert.equal(orderTotals(o).balance, 900) // เงินพักใหม่ 1500 + สินค้า 400 − ชำระแล้ว 1000
  })

  t('ลดเงินพักจนชำระเกิน: ต้องคืนส่วนเกินพอดี (ไม่คืน → ไม่ผ่าน)', () => {
    const o = mk({ payments: [paid('p1', 1400)], status: 'payment_confirmed' })
    const r = S.setHoldMoney(o, hm(700, { 500: 1, 100: 2 }), { reason: 'ลดเงินพัก', refunds: [] })
    assert.ok(r.error, 'ควรไม่ผ่าน')
    assert.equal(o.holdMoney.amount, 1000) // ไม่เปลี่ยนเมื่อไม่ผ่าน
  })

  t('ลดเงินพักแล้วคืนส่วนเกิน 300 เงินสดพอดี → สำเร็จ บันทึกเป็นการคืนชนิด hold', () => {
    const o = mk({ payments: [paid('p1', 1400)], status: 'payment_confirmed' })
    const r = S.setHoldMoney(o, hm(700, { 500: 1, 100: 2 }), { reason: 'ลดเงินพัก', refunds: [{ method: 'cash', amount: 300 }] })
    assert.equal(r.error, undefined, r.error)
    assert.equal(o.returns.length, 1)
    assert.equal(o.returns[0].kind, 'hold')
    assert.equal(o.returns[0].amount, 300)
    assert.equal(orderTotals(o).balance, 0)
  })

  t('ลดเงินพักแต่คืนไม่พอดี → ไม่ผ่าน', () => {
    const o = mk({ payments: [paid('p1', 1400)], status: 'payment_confirmed' })
    assert.ok(S.setHoldMoney(o, hm(700, { 500: 1, 100: 2 }), { reason: 'ลด', refunds: [{ method: 'cash', amount: 200 }] }).error)
  })

  t('คืนเงินพักด้วยคูปองไม่ได้', () => {
    const o = mk({ payments: [paid('p1', 1400)], status: 'payment_confirmed' })
    assert.ok(S.setHoldMoney(o, hm(700, { 500: 1, 100: 2 }), { reason: 'ลด', refunds: [{ method: 'credit', amount: 300 }] }).error)
  })

  t('งวดแรกต้องครอบคลุมเงินพัก: 600 ไม่ผ่าน · 1000 ผ่าน', () => {
    const o = mk({ payments: [paid('p1', 600, 'reported')] })
    assert.ok(S.confirmPayment(o, 'p1', null)?.error)
    assert.equal(o.payments[0].status, 'reported')
    o.payments[0].amount = 1000
    assert.equal(S.confirmPayment(o, 'p1', null)?.error, undefined)
    assert.equal(o.payments[0].status, 'confirmed')
  })

  t('ยกเลิก: คืนเงินพักต้องพอดีตามสูตร (ชำระ 1400 − สินค้า 400 = 1000)', () => {
    const o = mk({ payments: [paid('p1', 1400)], status: 'payment_confirmed' })
    assert.ok(S.cancelOrder(o, { reason: 'ทดสอบ', refunds: [], holdRefunds: [{ method: 'cash', amount: 900 }] }).error)
    const r = S.cancelOrder(o, { reason: 'ทดสอบ', refunds: [], holdRefunds: [{ method: 'cash', amount: 600 }, { method: 'transfer', amount: 400 }] })
    assert.equal(r.error, undefined, r.error)
    assert.equal(o.cancel.holdRefundAmount, 1000)
    assert.equal(o.cancel.holdRefunds.length, 2)
    assert.equal(o.status, 'cancelled')
  })

  t('คืนสินค้าบางส่วนเกินยอดสินค้าที่ชำระ (400) ไม่ได้ แม้มีเงินพัก', () => {
    const o = mk({ payments: [paid('p1', 1400)], status: 'payment_confirmed', channel: 'web', items: [{ id: 'i1', name: 'เค้ก', kind: 'retail', retailId: 'r1', qty: 1, unitPrice: 400, regularPrice: 400, fullPrice: 400, discounts: [], mods: [], specials: [], bundles: [] }] })
    const r = S.refundOrder(o, { reason: 'ทดสอบ', refunds: [{ method: 'cash', amount: 500 }] })
    assert.ok(r.error, 'ควรไม่ผ่าน')
  })

  t('ยกเลิกการลดเงินพักไม่ได้', () => {
    const o = mk({ payments: [paid('p1', 1400)], status: 'payment_confirmed' })
    S.setHoldMoney(o, hm(700, { 500: 1, 100: 2 }), { reason: 'ลด', refunds: [{ method: 'cash', amount: 300 }] })
    const r = S.cancelRefund(o, o.returns[0].id, { reason: 'ทดสอบ' })
    assert.ok(r.error)
  })

  for (const [name, fn] of cases) {
    try { fn(); console.log(`PASS ${name}`) } catch (e) { fails++; console.log(`FAIL ${name}: ${e.message}`) }
  }
} catch (e) {
  fails++
  console.log('ERROR', e?.stack || e)
} finally {
  await server.close()
}
console.log(fails ? `ไม่ผ่าน ${fails} กรณี` : 'ผ่านทุกกรณี')
process.exitCode = fails ? 1 : 0
