// เงินพัก (ซ่อนเงิน/ดึงเงิน) ในบัญชี: ชำระเข้าภาระ 2330 (ชำระก่อนเสมอ) · ส่งมอบคืนเงินออกจาก 2330 · ไม่เป็นรายได้
// ยกเลิก: คืนเงินพักตาม cancel.holdRefund · ส่วนที่เหลือโอนเข้า 2300 แล้วริบเป็นรายได้อื่น (4900) เหมือนมัดจำสินค้า
// รัน: node src/lib/acct/derive.hold.test.mjs
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { createServer } from 'vite'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const server = await createServer({ root: ROOT, server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' })
let fails = 0
try {
  const { deriveAll } = await server.ssrLoadModule('/src/lib/acct/derive.js')
  const { CASH, BANK, DEPOSIT, OUTPUT_VAT, AR, HOLD } = await server.ssrLoadModule('/src/lib/acct/chart.js')

  const item = (price, qty = 1) => ({ id: 'i' + price, kind: 'retail', retailId: 'x', name: 'สินค้า', unitPrice: price, regularPrice: price, fullPrice: price, qty, mods: [], discounts: [], specials: [], bundles: [] })
  const base = { channel: 'web', fulfillment: 'pickup', shippingFee: 0, vat: undefined, adjustment: { amount: 0, reason: '' }, couponsUsed: [], pointsUsed: null, createdAt: '2026-11-01T09:00:00' }
  const ctx = (orders) => ({ orders, groups: [], retail: [], ingredients: [], pointValue: 1, rewards: [], coupons: [], customers: [], acct: {}, shop: {} })
  const cash = (id, amount, at) => ({ id, status: 'confirmed', amount, method: 'เงินสด', posMethod: 'cash', at })
  const holdOf = (amount) => ({ holdMoney: { kind: 'hide', amount, notes: {} } })
  const linesOf = (entries, prefix) => entries.filter((e) => e.id.startsWith(prefix)).flatMap((e) => e.lines)
  // ยอดสุทธิของบัญชี: เดบิต − เครดิต (บาท)
  const net = (lines, acc) => Math.round(lines.filter((l) => l.account === acc).reduce((s, l) => s + (l.dr || 0) - (l.cr || 0), 0) * 100) / 100
  const balanced = (entries) => entries.every((e) => Math.abs(e.lines.reduce((s, l) => s + (l.dr || 0) - (l.cr || 0), 0)) < 0.005)

  const cases = []
  const t = (name, fn) => cases.push([name, fn])

  t('ไม่มีเงินพัก: การชำระบัญชีเหมือนเดิม (ไม่มีบรรทัด 2330)', () => {
    const A = { ...base, id: 'A', code: 'A1', status: 'payment_confirmed', items: [item(400)], payments: [cash('pa', 400, '2026-11-01T10:05:00')] }
    const es = deriveAll(ctx([A]), [])
    const pl = linesOf(es, 'pay:A')
    assert.equal(net(pl, CASH), 400)
    assert.equal(net(pl, DEPOSIT), -400)
    assert.equal(net(pl, HOLD), 0)
    assert.ok(balanced(es))
  })

  t('ชำระเงินพัก+สินค้า: เงินพักเข้า 2330 · สินค้าเข้า 2300 · ยังไม่มีรายได้', () => {
    const A = { ...base, id: 'A', code: 'A1', status: 'payment_confirmed', ...holdOf(1000), items: [item(400)], payments: [cash('pa', 1400, '2026-11-01T10:05:00')] }
    const es = deriveAll(ctx([A]), [])
    const pl = linesOf(es, 'pay:A')
    assert.equal(net(pl, CASH), 1400)
    assert.equal(net(pl, HOLD), -1000)
    assert.equal(net(pl, DEPOSIT), -400)
    assert.ok(balanced(es))
    assert.equal(es.some((e) => e.id.startsWith('dlv:A')), false)
  })

  t('ชำระหลายงวด: งวดแรก 600 เป็นเงินพักทั้งหมด · งวดสอง 800 = เงินพัก 400 + สินค้า 400', () => {
    const A = { ...base, id: 'A', code: 'A1', status: 'payment_confirmed', ...holdOf(1000), items: [item(400)], payments: [cash('p1', 600, '2026-11-01T10:00:00'), cash('p2', 800, '2026-11-02T10:00:00')] }
    const es = deriveAll(ctx([A]), [])
    const pl = linesOf(es, 'pay:A')
    assert.equal(net(pl, HOLD), -1000)
    assert.equal(net(pl, DEPOSIT), -400)
    assert.equal(net(pl, CASH), 1400)
    assert.ok(balanced(es))
  })

  t('VAT คิดเฉพาะส่วนสินค้า: ภาษีขาย 26.17 (400 รวม VAT 7%) ไม่รวมเงินพัก 1000', () => {
    const A = { ...base, id: 'A', code: 'A1', status: 'payment_confirmed', vat: { rate: 7, mode: 'inclusive' }, ...holdOf(1000), items: [item(400)], payments: [cash('pa', 1400, '2026-11-01T10:05:00')] }
    const es = deriveAll(ctx([A]), [])
    const pl = linesOf(es, 'pay:A')
    assert.equal(net(pl, OUTPUT_VAT), -26.17)
    assert.equal(net(pl, HOLD), -1000)
    assert.ok(balanced(es))
  })

  t('ส่งมอบ: คืนเงินพักออกจาก 2330 · รายได้มีเฉพาะสินค้า · 2330 เหลือ 0', () => {
    const A = { ...base, id: 'A', code: 'A1', status: 'delivered', deliveredAt: '2026-11-02T10:00:00', ...holdOf(1000), items: [item(400)], payments: [cash('pa', 1400, '2026-11-01T10:05:00')] }
    const es = deriveAll(ctx([A]), [])
    const all = es.flatMap((e) => e.lines)
    assert.equal(net(all, HOLD), 0)
    assert.equal(net(all, CASH), 400) // รับเงินสด 1400 · คืนเงินพักที่ส่งมอบ 1000
    assert.equal(-net(all, '4200'), 400)
    assert.ok(balanced(es))
  })

  t('รับที่ร้าน: เงินพักครบ สินค้ายังไม่ชำระ → ตอนส่งมอบลงลูกหนี้ 400 (ไม่ใช่รายได้จากเงินพัก)', () => {
    const A = { ...base, id: 'A', code: 'A1', status: 'delivered', deliveredAt: '2026-11-02T10:00:00', ...holdOf(1000), items: [item(400)], payments: [cash('pa', 1000, '2026-11-01T10:05:00')] }
    const es = deriveAll(ctx([A]), [])
    const all = es.flatMap((e) => e.lines)
    assert.equal(net(all, AR), 400)
    assert.equal(net(all, HOLD), 0)
    assert.equal(-net(all, '4200'), 400)
    assert.ok(balanced(es))
  })

  t('ยกเลิกก่อนส่งมอบ: คืนเงินพัก 600 · ส่วนที่เหลือ 400 โอนเข้า 2300 แล้วริบเป็น 4900 · 2330 เหลือ 0', () => {
    const A = { ...base, id: 'A', code: 'A1', status: 'cancelled', cancel: { at: '2026-11-02T10:00:00', refunds: [], refundAmount: 600, holdRefunds: [{ method: 'cash', amount: 600 }] }, ...holdOf(1000), items: [item(400)], payments: [cash('pa', 1000, '2026-11-01T10:05:00')] }
    const es = deriveAll(ctx([A]), [])
    const all = es.flatMap((e) => e.lines)
    assert.equal(net(all, HOLD), 0)
    assert.equal(net(all, DEPOSIT), 0)
    assert.equal(net(all, '4900'), -400)
    assert.equal(net(all, CASH), 400)
    assert.ok(balanced(es))
  })

  t('ยกเลิกหลังชำระครบ: คืนเฉพาะเงินพัก 1000 · สินค้า 400 ริบเป็น 4900', () => {
    const A = { ...base, id: 'A', code: 'A1', status: 'cancelled', cancel: { at: '2026-11-02T10:00:00', refunds: [], refundAmount: 1000, holdRefunds: [{ method: 'cash', amount: 1000 }] }, ...holdOf(1000), items: [item(400)], payments: [cash('pa', 1400, '2026-11-01T10:05:00')] }
    const es = deriveAll(ctx([A]), [])
    const all = es.flatMap((e) => e.lines)
    assert.equal(net(all, HOLD), 0)
    assert.equal(net(all, DEPOSIT), 0)
    assert.equal(net(all, '4900'), -400)
    assert.equal(net(all, CASH), 400)
    assert.ok(balanced(es))
  })

  t('ลดเงินพักแล้วคืนส่วนเกินเงินสด 300: เดบิต 2300 (ลดส่วนที่เกินจากสินค้า) · 2330 = เงินพักใหม่ 700', () => {
    const A = { ...base, id: 'A', code: 'A1', status: 'payment_confirmed', ...holdOf(700), items: [item(400)], payments: [cash('pa', 1400, '2026-11-01T10:05:00')], returns: [{ id: 'h1', kind: 'hold', at: '2026-11-02T10:00:00', by: 'admin', reason: 'ลดเงินพัก', refunds: [{ method: 'cash', amount: 300 }], amount: 300 }] }
    const es = deriveAll(ctx([A]), [])
    const all = es.flatMap((e) => e.lines)
    assert.equal(net(all, HOLD), -700)
    assert.equal(net(all, DEPOSIT), -400)
    assert.equal(net(all, CASH), 1100)
    assert.ok(balanced(es))
  })

  t('ยกเลิกแบ่งคืนเงินพัก: เงินสด 300 + โอน 300 · ส่วนที่เหลือ 400 โอนเข้า 2300 แล้วริบ 4900', () => {
    const A = { ...base, id: 'A', code: 'A1', status: 'cancelled', cancel: { at: '2026-11-02T10:00:00', refunds: [], refundAmount: 600, holdRefunds: [{ method: 'cash', amount: 300 }, { method: 'transfer', amount: 300 }] }, ...holdOf(1000), items: [item(400)], payments: [cash('pa', 1000, '2026-11-01T10:05:00')] }
    const es = deriveAll(ctx([A]), [])
    const all = es.flatMap((e) => e.lines)
    assert.equal(net(all, HOLD), 0)
    assert.equal(net(all, DEPOSIT), 0)
    assert.equal(net(all, '4900'), -400)
    assert.equal(net(all, CASH), 700)
    assert.equal(net(all, BANK), -300)
    assert.ok(balanced(es))
  })

  t('ลดเงินพักแล้วยกเลิก: คืนเงินพักที่เหลือ 700 เงินสด · สินค้าริบ 400 · 2300 และ 2330 เป็น 0', () => {
    const A = { ...base, id: 'A', code: 'A1', status: 'cancelled', cancel: { at: '2026-11-02T10:00:00', refunds: [], refundAmount: 700, holdRefunds: [{ method: 'cash', amount: 700 }] }, ...holdOf(700), items: [item(400)], payments: [cash('pa', 1400, '2026-11-01T10:05:00')], returns: [{ id: 'h1', kind: 'hold', at: '2026-11-02T09:00:00', by: 'admin', reason: 'ลดเงินพัก', refunds: [{ method: 'cash', amount: 300 }], amount: 300 }] }
    const es = deriveAll(ctx([A]), [])
    const all = es.flatMap((e) => e.lines)
    assert.equal(net(all, HOLD), 0)
    assert.equal(net(all, DEPOSIT), 0)
    assert.equal(net(all, '4900'), -400)
    assert.equal(net(all, CASH), 400)
    assert.ok(balanced(es))
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
