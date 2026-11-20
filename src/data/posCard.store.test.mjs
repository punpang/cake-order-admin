// ทดสอบกฎบัตรใน POS ที่ระดับ store จริง (โหลดผ่าน Vite SSR แบบเดียวกับแอป)
// บัตรต้องกดยืนยัน "รับชำระด้วยบัตรแล้ว" ก่อนนับเป็นยอดรับ ทั้งบิลเต็ม บิลค้าง และการแลกสินค้า
// เงินสดและโอนยังเป็นไปตามกติกาเดิม · รัน: node src/data/posCard.store.test.mjs
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { createServer } from 'vite'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const server = await createServer({ root: ROOT, server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' })
let fails = 0
try {
  const demo = await server.ssrLoadModule('/src/data/demo.js')
  const S = await server.ssrLoadModule('/src/data/store.js')
  const { orderTotals } = await server.ssrLoadModule('/src/lib/pricing.js')
  demo.seedDemo()
  const { db, openShift, posSale, posItems, vatNow, exchangeSale } = S

  const tmplAll = db.orders.flatMap((o) => o.items || []).filter((i) => i.kind === 'retail' && i.retailId && !i.promoGift && Number(i.unitPrice) > 0)
  const tmpl = [...tmplAll].sort((a, b) => a.unitPrice - b.unitPrice)[0]
  openShift(0)
  const cart = () => [{ kind: 'retail', refId: tmpl.retailId, qty: 1, mods: [] }]
  const total = Math.max(orderTotals({ items: posItems(cart(), new Date()), adjustment: { amount: 0, reason: '' }, vat: vatNow(), shippingFee: 0, fulfillment: 'pickup', couponsUsed: [], pointsUsed: null, loyalty: null, payments: [] }).total, 0)
  assert.ok(total > 0, 'ต้องมียอดบิลทดสอบ')

  const check = (name, fn) => {
    try {
      fn()
      console.log(`ok - ${name}`)
    } catch (e) {
      fails++
      console.log(`not ok - ${name}: ${e.message}`)
    }
  }

  check('บัตรไม่ยืนยัน ทั้งบิลเต็ม → ปฏิเสธ', () => {
    assert.equal(posSale({ cart: cart(), lines: [{ method: 'card', amount: total, confirmed: false }] }), null)
  })
  check('บัตรไม่มีฟิลด์ยืนยัน ทั้งบิลเต็ม → ปฏิเสธ', () => {
    assert.equal(posSale({ cart: cart(), lines: [{ method: 'card', amount: total }] }), null)
  })
  check('บัตรไม่ยืนยัน รับบางส่วน → ปฏิเสธ', () => {
    assert.equal(posSale({ cart: cart(), lines: [{ method: 'card', amount: Math.floor(total / 2) }], partial: true }), null)
  })
  check('บัตรยืนยันแล้ว ทั้งบิลเต็ม → รับบิลและบันทึกยอดเป็นบัตร', () => {
    const o = posSale({ cart: cart(), lines: [{ method: 'card', amount: total, confirmed: true }] })
    assert.ok(o, 'ต้องรับบิล')
    assert.equal(o.status, 'delivered')
    assert.equal(o.payments[0].posMethod, 'card')
    assert.equal(o.payments[0].status, 'confirmed')
  })
  check('เงินสดรับไม่ครบ → ปฏิเสธ (ควบคุม)', () => {
    assert.equal(posSale({ cart: cart(), lines: [{ method: 'cash', amount: total, received: total - 1 }] }), null)
  })
  check('โอนไม่มี QR และยังไม่ยืนยัน → ปฏิเสธ (ควบคุม)', () => {
    assert.equal(posSale({ cart: cart(), lines: [{ method: 'transfer', amount: total }] }), null)
  })

  // การแลกสินค้า: บัตรที่ยังไม่ยืนยันต้องไม่ทำให้มีการคืนสินค้าหรือการคืนเงินเกิดขึ้น
  const base = posSale({ cart: cart(), lines: [{ method: 'cash', amount: total, received: total }] })
  assert.ok(base, 'ต้องมีบิลเดิมสำหรับทดสอบการแลก')
  const refundsBefore = base.refunds?.length ?? 0
  check('แลกสินค้าด้วยบัตรที่ยังไม่ยืนยัน → ปฏิเสธและไม่มีการคืนเงิน', () => {
    const r = exchangeSale({ order: base, returnItems: [{ id: base.items[0].id, qty: 1 }], restock: true, refunds: [{ method: 'cash', amount: total }], newCart: cart(), method: 'card', confirmed: false })
    assert.ok(r.error, 'ต้องได้ข้อความผิดพลาด')
    assert.equal(base.refunds?.length ?? 0, refundsBefore)
  })
  check('แลกสินค้าด้วยบัตรที่ยืนยันแล้ว → สำเร็จ', () => {
    const r = exchangeSale({ order: base, returnItems: [{ id: base.items[0].id, qty: 1 }], restock: true, refunds: [{ method: 'cash', amount: total }], newCart: cart(), method: 'card', confirmed: true })
    assert.equal(r.error, undefined, r.error)
    assert.ok(r.ok)
  })
} finally {
  await server.close()
}
if (fails) {
  console.log(`ล้มเหลว ${fails} รายการ`)
  process.exitCode = 1
} else {
  console.log('ผ่านทั้งหมด')
}
