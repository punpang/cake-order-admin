// ทดสอบบัญชีของคูปองคืนเงิน (ภาระ 2320) และคะแนน (ภาระ 2310) หลังถอดการใช้คะแนนลดราคา · รัน: node src/lib/acct/derive.credit.test.mjs
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { createServer } from 'vite'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const server = await createServer({ root: ROOT, server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' })
let fails = 0
try {
  const { deriveAll } = await server.ssrLoadModule('/src/lib/acct/derive.js')
  const { CASH, BANK, POINTS_LIAB, COUPON_LIAB } = await server.ssrLoadModule('/src/lib/acct/chart.js')

  const item = (price, qty = 1) => ({ id: 'i' + price, kind: 'retail', retailId: 'x', name: 'สินค้า', unitPrice: price, regularPrice: price, fullPrice: price, qty, mods: [], discounts: [], specials: [], bundles: [] })
  const base = { channel: 'web', fulfillment: 'pickup', shippingFee: 0, vat: undefined, adjustment: { amount: 0, reason: '' } }
  const ctx = (orders) => ({ orders, groups: [], retail: [], ingredients: [], pointValue: 1, rewards: [], coupons: [], customers: [], acct: {}, shop: {} })
  const balanced = (entries) => entries.every((e) => Math.abs(e.lines.reduce((s, l) => s + (l.dr || 0) - (l.cr || 0), 0)) < 0.005)
  const sumOf = (lines, acc) => Math.round(lines.filter((l) => l.account === acc).reduce((s, l) => s + (l.dr || 0) - (l.cr || 0), 0) * 100) / 100

  const cases = []
  const t = (name, fn) => cases.push([name, fn])

  t('คืนเป็นคูปองคืนเงิน: ลงภาระ 2320 ไม่ลงธนาคารหรือเงินสด', () => {
    const A = { ...base, id: 'A', code: 'A1', status: 'delivered', createdAt: '2026-11-01T10:00:00', deliveredAt: '2026-11-02T10:00:00', items: [item(500)], couponsUsed: [], pointsUsed: null, payments: [{ id: 'pa', status: 'confirmed', amount: 500, method: 'เงินสด', posMethod: 'cash', at: '2026-11-01T10:05:00' }], returns: [{ id: 'r1', at: '2026-11-03T10:00:00', by: 'admin', reason: 'คืนเป็นคูปอง', refunds: [{ method: 'credit', amount: 200 }], amount: 200 }] }
    const rl = deriveAll(ctx([A]), []).find((e) => e.id.startsWith('ret:A'))?.lines || []
    assert.ok(rl.some((l) => l.account === COUPON_LIAB && l.cr === 200), 'ไม่มีการลงภาระ 2320 ยอด 200')
    assert.equal(rl.some((l) => l.account === BANK || l.account === CASH), false)
  })

  t('ใช้คูปองคืนเงินในออร์เดอร์: ตัดภาระ 2320 แทนค่าใช้จ่ายส่วนลด และภาระเหลือ 0 เมื่อใช้ครบ', () => {
    const A = { ...base, id: 'A', code: 'A1', status: 'delivered', createdAt: '2026-11-01T10:00:00', deliveredAt: '2026-11-02T10:00:00', items: [item(500)], couponsUsed: [], pointsUsed: null, payments: [{ id: 'pa', status: 'confirmed', amount: 500, method: 'เงินสด', posMethod: 'cash', at: '2026-11-01T10:05:00' }], returns: [{ id: 'r1', at: '2026-11-03T10:00:00', by: 'admin', reason: 'คืนเป็นคูปอง', refunds: [{ method: 'credit', amount: 200 }], amount: 200 }] }
    const B = { ...base, id: 'B', code: 'B1', status: 'delivered', createdAt: '2026-11-10T10:00:00', deliveredAt: '2026-11-10T12:00:00', items: [item(300)], pointsUsed: null, couponsUsed: [{ couponId: 'cp1', name: 'คูปองคืนเงิน', amount: 200, credit: true }], payments: [{ id: 'pb', status: 'confirmed', amount: 100, method: 'เงินสด', posMethod: 'cash', at: '2026-11-10T11:00:00' }], returns: [] }
    const all = deriveAll(ctx([A, B]), [])
    const dlvB = all.find((e) => e.id === 'dlv:B')?.lines || []
    assert.ok(dlvB.some((l) => l.account === COUPON_LIAB && l.dr === 200), 'ไม่ตัดภาระ 2320 ยอด 200')
    assert.equal(dlvB.some((l) => l.account === '5420' && l.dr === 200), false, 'ลงค่าใช้จ่ายส่วนลดทั้งที่มีภาระรองรับ')
    assert.equal(sumOf(all.flatMap((e) => e.lines), COUPON_LIAB), 0)
    assert.equal(balanced(all), true)
    assert.equal(all.flatMap((e) => e.lines).some((l) => l.account === POINTS_LIAB), false, 'มีรายการลงบัญชีคะแนนโดยไม่ได้ตั้งใจ')
  })

  t('คืนเป็นคะแนนยังลง 2310 และใช้คะแนนตัดภาระ 2310 ก่อน ไม่ลง 5410 เต็มจำนวน', () => {
    const A = { ...base, id: 'A', code: 'A1', status: 'delivered', createdAt: '2026-11-01T10:00:00', deliveredAt: '2026-11-02T10:00:00', items: [item(500)], couponsUsed: [], pointsUsed: null, payments: [{ id: 'pa', status: 'confirmed', amount: 500, method: 'เงินสด', posMethod: 'cash', at: '2026-11-01T10:05:00' }], returns: [{ id: 'r1', at: '2026-11-03T10:00:00', by: 'admin', reason: 'คืนเป็นคะแนน', refunds: [{ method: 'points', amount: 100, points: 100 }], amount: 100 }] }
    const B = { ...base, id: 'B', code: 'B1', status: 'delivered', createdAt: '2026-11-10T10:00:00', deliveredAt: '2026-11-10T12:00:00', items: [item(300)], couponsUsed: [], pointsUsed: { points: 100, amount: 100, entryId: 'e' }, payments: [{ id: 'pb', status: 'confirmed', amount: 200, method: 'เงินสด', posMethod: 'cash', at: '2026-11-10T11:00:00' }], returns: [] }
    const all = deriveAll(ctx([A, B]), [])
    const dl = all.find((e) => e.id === 'dlv:B')?.lines || []
    assert.ok(dl.some((l) => l.account === POINTS_LIAB && l.dr === 100), 'ไม่ตัดภาระ 2310 ยอด 100')
    assert.equal(dl.some((l) => l.account === '5410' && l.dr), false)
    const rf = all.find((e) => e.id.startsWith('ret:A'))?.lines || []
    assert.ok(rf.some((l) => l.account === POINTS_LIAB && l.cr === 100))
    assert.equal(balanced(all), true)
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
