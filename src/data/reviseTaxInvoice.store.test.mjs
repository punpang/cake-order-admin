// ทดสอบการแก้ไขใบกำกับภาษีเต็มรูป (ระดับ store จริง): ออกใบลดหนี้ใบเดิม + ออกใบใหม่ในขั้นเดียว · ใบเดิมยังอยู่
// รัน: node src/data/reviseTaxInvoice.store.test.mjs
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { createServer } from 'vite'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const server = await createServer({ root: ROOT, server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' })
let fails = 0
const t = (name, fn) => { try { fn(); console.log('ok  ', name) } catch (e) { fails++; console.log('FAIL', name, '\n  ', e.message) } }
try {
  const demo = await server.ssrLoadModule('/src/data/demo.js')
  const S = await server.ssrLoadModule('/src/data/store.js')
  const A = await server.ssrLoadModule('/src/data/acct.js')
  demo.seedDemo()
  const { db, session } = S
  session.role = 'admin'
  const active = () => A.taxInvoices().filter((i) => i.type === 'invoice' && !i.voidedBy)
  const target = () => active()[0]
  const newBuyer = (inv, patch = {}) => ({ ...inv.buyer, name: inv.buyer.name + ' (แก้ไข)', ...patch })
  const count = () => A.taxInvoices().length

  t('มีใบกำกับที่ใช้งานอยู่ในข้อมูลจำลองอย่างน้อยหนึ่งใบ', () => assert.ok(target(), 'ไม่มีใบกำกับในข้อมูลจำลอง'))

  const inv = target()
  const orderId = inv.orderId
  const oldNo = inv.no
  const before = count()
  const r = A.reviseTaxInvoice(inv.id, newBuyer(inv))

  t('แก้ไขสำเร็จและคืนใบลดหนี้ + ใบใหม่', () => {
    assert.equal(r.ok, true, r.error)
    assert.equal(r.creditNote.type, 'credit')
    assert.equal(r.creditNote.refId, inv.id)
    assert.equal(r.invoice.type, 'invoice')
    assert.equal(r.invoice.orderId, orderId)
  })
  t('เพิ่มเอกสาร 2 ฉบับ (ลดหนี้ + ใบใหม่) และไม่ลบใบเดิม', () => {
    assert.equal(count(), before + 2)
    assert.ok(A.taxInvoices().some((i) => i.id === inv.id), 'ใบเดิมหายไป')
  })
  t('ใบเดิมถูกทำเครื่องหมายยกเลิกโดยใบลดหนี้', () => assert.equal(inv.voidedBy, r.creditNote.id))
  t('ใบที่ใช้งานของออร์เดอร์ คือใบใหม่ (ข้อมูลผู้ซื้อใหม่)', () => {
    const cur = A.invoiceOfOrder(orderId)
    assert.equal(cur.id, r.invoice.id)
    assert.equal(cur.buyer.name, inv.buyer.name + ' (แก้ไข)')
    assert.equal(cur.no !== oldNo, true)
  })
  t('ยอดของใบใหม่และใบลดหนี้ตรงกับใบเดิม', () => {
    assert.equal(r.invoice.total, inv.total)
    assert.equal(r.creditNote.total, inv.total)
  })
  t('ใบลดหนี้ใช้เลขเอกสารชุด CN และใบใหม่ใช้ชุด INV', () => {
    assert.match(r.creditNote.no, /CN/)
    assert.match(r.invoice.no, /INV/)
  })

  t('ข้อมูลผู้ซื้อไม่เปลี่ยน → ไม่ออกเอกสารเพิ่ม', () => {
    const cur = A.invoiceOfOrder(orderId)
    const n = count()
    const x = A.reviseTaxInvoice(cur.id, { ...cur.buyer })
    assert.match(x.error, /ไม่มีการเปลี่ยนแปลง/)
    assert.equal(count(), n)
  })
  t('ข้อมูลผู้ซื้อไม่ครบ → error และไม่แตะใบเดิม', () => {
    const cur = A.invoiceOfOrder(orderId)
    const n = count()
    const x = A.reviseTaxInvoice(cur.id, { name: '', taxId: '', branch: '00000', address: '' })
    assert.ok(x.error)
    assert.equal(count(), n)
    assert.equal(cur.voidedBy, undefined)
  })
  t('ใบที่ถูกยกเลิกแล้วแก้ไม่ได้', () => {
    const old = A.taxInvoices().find((i) => i.id === inv.id)
    const n = count()
    const x = A.reviseTaxInvoice(old.id, newBuyer(old, { taxId: '0105567001234' }))
    assert.equal(x.error, 'ใบนี้ถูกยกเลิกแล้ว')
    assert.equal(count(), n)
  })
  t('ไม่มีสิทธิ์ taxInvoice → ปฏิเสธและไม่เปลี่ยนข้อมูล', () => {
    const cur = A.invoiceOfOrder(orderId)
    const n = count()
    session.role = 'sales'
    try {
      const x = A.reviseTaxInvoice(cur.id, newBuyer(cur, { taxId: '0105567009999' }))
      assert.equal(x.error, 'ไม่มีสิทธิ์')
    } finally { session.role = 'admin' }
    assert.equal(count(), n)
    assert.equal(A.invoiceOfOrder(orderId).id, cur.id)
  })
  t('ออกใบใหม่ไม่สำเร็จ → ย้อนทั้งหมด ใบเดิมยังใช้งานได้', () => {
    const cur = A.invoiceOfOrder(orderId)
    const n = count()
    const saved = db.shop.vat
    db.shop.vat = { ...saved, taxId: '' } // ทำให้ตรวจผู้ขายไม่ผ่านตอนออกใบใหม่
    try {
      const x = A.reviseTaxInvoice(cur.id, newBuyer(cur, { taxId: '0105567008888' }))
      assert.ok(x.error, 'ควรมี error')
    } finally { db.shop.vat = saved }
    assert.equal(count(), n)
    assert.equal(cur.voidedBy, undefined)
    assert.equal(A.invoiceOfOrder(orderId).id, cur.id)
  })
} finally {
  await server.close()
}
console.log(fails ? `\n${fails} ไม่ผ่าน` : '\nผ่านทั้งหมด')
process.exit(fails ? 1 : 0)
