// ทดสอบคืนเงินบางส่วนของใบกำกับภาษี (ระดับ store จริง): ออกใบลดหนี้บางส่วนอ้างใบเดิม · กันคืนเกิน · ยกเลิกการคืนที่ออกใบแล้วไม่ได้ · ยกเลิกทั้งใบ/แก้ไขใบใช้ยอดคงเหลือ
// รัน: node src/data/refundPartialCredit.store.test.mjs
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { createServer } from 'vite'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const server = await createServer({ root: ROOT, server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' })
let fails = 0
const t = async (name, fn) => { try { await fn(); console.log('ok  ', name) } catch (e) { fails++; console.log('FAIL', name, '\n  ', e.message) } }
try {
  const demo = await server.ssrLoadModule('/src/data/demo.js')
  const S = await server.ssrLoadModule('/src/data/store.js')
  const A = await server.ssrLoadModule('/src/data/acct.js')
  demo.seedDemo()
  const { db, session, refundOrder, cancelOrder, cancelRefund } = S
  session.role = 'admin'
  const active = () => A.taxInvoices().filter((i) => i.type === 'invoice' && !i.voidedBy)
  const creditsOf = (invId) => A.taxInvoices().filter((d) => d.type === 'credit' && d.refId === invId)
  const orderOfInv = (inv) => db.orders.find((o) => o.id === inv.orderId)
  const money2 = (n) => Math.round(n * 100) / 100

  const [invA, invB] = active()
  await t('มีใบกำกับที่ใช้งานอยู่ 2 ใบในข้อมูลจำลอง', () => assert.ok(invA && invB))

  // 1) คืนบางส่วน → ใบลดหนี้บางส่วน 1 ใบ อ้างใบเดิม ใบเดิมยังใช้งาน
  const orderA = orderOfInv(invA)
  const amtA = money2(invA.total / 4)
  const countBefore = A.taxInvoices().length
  let entryA = null
  await t('คืนบางส่วน → ระบบออกใบลดหนี้บางส่วนอ้างใบเดิม และใบเดิมยังใช้งานอยู่', () => {
    const r = refundOrder(orderA, { reason: 'คืนเค้ก 1 ชิ้น', refunds: [{ method: 'cash', amount: amtA }], notify: false, sms: false })
    assert.equal(r.ok, true, r.error)
    entryA = r.entry
    const cns = creditsOf(invA.id)
    assert.equal(cns.length, 1)
    assert.equal(cns[0].total, amtA)
    assert.equal(cns[0].refNo, invA.no)
    assert.equal(entryA.creditNoteId, cns[0].id)
    assert.equal(invA.voidedBy, undefined)
    assert.equal(A.invoiceOfOrder(orderA.id).id, invA.id)
    assert.equal(A.taxInvoices().length, countBefore + 1)
  })

  // 2) ยอดคืนเกินยอดคงเหลือ → ปฏิเสธ และไม่มีเอกสารเพิ่ม
  await t('คืนเกินยอดคงเหลือของใบ → ปฏิเสธและไม่เพิ่มใบลดหนี้', () => {
    const remaining = money2(invA.total - amtA)
    const n = A.taxInvoices().length
    const r = refundOrder(orderA, { reason: 'เกิน', refunds: [{ method: 'cash', amount: money2(remaining + 1) }], notify: false, sms: false })
    assert.ok(r.error, 'ควรปฏิเสธ')
    assert.equal(A.taxInvoices().length, n)
  })

  // 3) การคืนที่ออกใบลดหนี้แล้ว ยกเลิกการคืนไม่ได้
  await t('ยกเลิกการคืนที่ออกใบลดหนี้แล้ว → ปฏิเสธ', () => {
    const r = cancelRefund(orderA, entryA.id, { reason: 'ทดสอบ', notify: false })
    assert.match(r.error ?? '', /ใบลดหนี้/)
    assert.equal(entryA.cancelled, undefined)
  })

  // 4) ยกเลิกทั้งใบหลังคืนบางส่วน → ใบลดหนี้เฉพาะยอดคงเหลือ (ไม่คืนภาษีซ้ำ)
  const orderB = orderOfInv(invB)
  const amtB = money2(invB.total / 3)
  await t('ยกเลิกทั้งใบหลังคืนบางส่วน → ใบลดหนี้ใบสุดท้ายเท่ายอดคงเหลือ', () => {
    const r1 = refundOrder(orderB, { reason: 'คืนบางส่วน', refunds: [{ method: 'cash', amount: amtB }], notify: false, sms: false })
    assert.equal(r1.ok, true, r1.error)
    const c = cancelOrder(orderB, { reason: 'ทดสอบ', refunds: [], notify: false, sms: false })
    assert.equal(c.ok, true, c.error)
    const cns = creditsOf(invB.id)
    assert.equal(cns.length, 2)
    const full = cns[1]
    assert.equal(full.total, money2(invB.total - amtB))
    assert.equal(full.vat, money2(invB.vat - cns[0].vat))
    assert.equal(invB.voidedBy, full.id)
    assert.equal(A.invoiceOfOrder(orderB.id), null)
  })

  // 5) แก้ไขใบหลังคืนบางส่วน (ใบ A มีลดหนี้บางส่วนจากข้อ 1) → ใบใหม่มียอดเท่ายอดคงเหลือ
  await t('แก้ไขใบหลังคืนบางส่วน → ใบใหม่มียอดเท่ายอดคงเหลือ', () => {
    const buyer = { ...invA.buyer, name: invA.buyer.name + ' (แก้)' }
    const r2 = A.reviseTaxInvoice(invA.id, buyer)
    assert.equal(r2.ok, true, r2.error)
    assert.equal(r2.invoice.total, money2(invA.total - amtA))
    assert.equal(A.invoiceOfOrder(orderA.id).id, r2.invoice.id)
  })
} finally {
  await server.close()
}
console.log(fails ? `\n${fails} ไม่ผ่าน` : '\nผ่านทั้งหมด')
process.exit(fails ? 1 : 0)
