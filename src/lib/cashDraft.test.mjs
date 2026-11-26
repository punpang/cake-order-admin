// ทดสอบเส้นทางข้อมูลบริการเกี่ยวกับเงิน: ออร์เดอร์ ⇄ input ที่ส่งให้เซิร์ฟเวอร์ · รายการบริการไม่ถูกส่งเป็นรายการ
// รัน: node src/lib/cashDraft.test.mjs
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { cashDraftOf, cashServicesOf } from './cashService.js'

// ordersSync.js ใช้ import แบบไม่มีนามสกุล จึงโหลดผ่าน Vite SSR (เหมือนเทสต์ ordersSync อื่น ๆ)
const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const server = await createServer({ root: ROOT, server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' })
const { draftOf } = await server.ssrLoadModule('/src/lib/ordersSync.js')

const shop = { cashService: { maxNotes: 5, services: { hide: { fee: 50, show: true }, pull: { fee: 40, show: true }, stash: { fee: 30, show: true } } } }
const svcHide = { id: 'svc-hide', kind: 'service', serviceKind: 'hide', name: 'ซ่อนเงิน', qty: 1, unitPrice: 50, noPoints: true }
const good = { id: 'b1', kind: 'retail', name: 'ขนม', qty: 2, unitPrice: 75 }
let fail = 0
const t = (name, fn) => { try { fn(); console.log('ok -', name) } catch (e) { fail++; console.log('FAIL -', name, e.message) } }

t('cashDraftOf: ซ่อนเงินคืนรูปแบบ input (ชนิดและธนบัตร)', () => {
  const o = { items: [good, svcHide], holdMoney: { kind: 'hide', notes: { 1000: 1, 100: 2 }, amount: 1200 } }
  assert.deepEqual(cashDraftOf(o), { kind: 'hide', notes: { 1000: 1, 100: 2 } })
})
t('cashDraftOf: ซ่อนของไม่มีธนบัตร', () => {
  const o = { items: [{ ...svcHide, serviceKind: 'stash' }], holdMoney: null }
  assert.deepEqual(cashDraftOf(o), { kind: 'stash' })
})
t('cashDraftOf: ออร์เดอร์ไม่มีบริการ = undefined', () => {
  assert.equal(cashDraftOf({ items: [good], holdMoney: null }), undefined)
  assert.equal(cashDraftOf(null), undefined)
})
t('cashServicesOf: ค่าบริการต่อรายการเค้ก (forItem) และเงินพักรวมเป็นก้อนเดียวต่อออร์เดอร์', () => {
  const a = { ...good, id: 'a1', name: 'เค้ก A', cashService: { kind: 'hide', notes: { 1000: 1, 100: 2 } } }
  const b = { ...good, id: 'b2', name: 'เค้ก B', cashService: { kind: 'hide', notes: { 100: 2 } } }
  const r = cashServicesOf([a, b, { ...good, id: 'c3' }], shop)
  assert.equal(r.ok, true, r.error)
  assert.deepEqual(r.items.map((i) => [i.forItem, i.kind, i.unitPrice]), [['a1', 'service', 50], ['b2', 'service', 50]])
  assert.equal(new Set(r.items.map((i) => i.id)).size, 2)
  assert.deepEqual(r.holdMoney, { kind: 'hide', notes: { 1000: 1, 100: 4 }, amount: 1400 })
})
t('cashServicesOf: ชิ้นที่ไม่เลือกบริการไม่มีค่าบริการและไม่มีเงินพัก', () => {
  const r = cashServicesOf([good], shop)
  assert.deepEqual(r, { ok: true, items: [], holdMoney: null })
})
t('cashServicesOf: ซ่อนของ (ไม่มีธนบัตร) ได้ค่าบริการอย่างเดียว', () => {
  const r = cashServicesOf([{ ...good, id: 's1', cashService: { kind: 'stash' } }], shop)
  assert.equal(r.ok, true)
  assert.equal(r.items[0].serviceKind, 'stash')
  assert.equal(r.holdMoney, null)
})
t('cashServicesOf: ซ่อนเงินกับดึงเงินในออร์เดอร์เดียวกัน → ไม่ผ่าน', () => {
  const r = cashServicesOf([
    { ...good, id: 'a', name: 'A', cashService: { kind: 'hide', notes: { 100: 1 } } },
    { ...good, id: 'b', name: 'B', cashService: { kind: 'pull', notes: { 100: 1 } } },
  ], shop)
  assert.equal(r.ok, false)
  assert.match(r.error, /คนละออเดอร์/)
})
t('cashServicesOf: เพดานธนบัตรใช้กับยอดรวมทั้งออร์เดอร์ (maxNotes = 5)', () => {
  const r = cashServicesOf([
    { ...good, id: 'a', name: 'A', cashService: { kind: 'hide', notes: { 100: 3 } } },
    { ...good, id: 'b', name: 'B', cashService: { kind: 'hide', notes: { 100: 3 } } },
  ], shop)
  assert.equal(r.ok, false)
})
t('cashServicesOf: บริการที่ปิดอยู่ในชิ้นใดชิ้นหนึ่ง → ไม่ผ่านพร้อมชื่อชิ้น', () => {
  const r = cashServicesOf([{ ...good, name: 'เค้กX', cashService: { kind: 'pull', notes: { 100: 1 } } }], { cashService: { services: { pull: { fee: 40, show: false } } } })
  assert.equal(r.ok, false)
  assert.match(r.error, /^เค้กX:/)
})
t('draftOf: ไม่ส่งรายการบริการเป็นรายการ แต่ส่ง cashService แทน', () => {
  const o = { customerId: 'c1', fulfillment: 'pickup', pickupAt: '2026-11-30T10:00', items: [good, svcHide], adjustment: null, holdMoney: { kind: 'hide', notes: { 100: 2 }, amount: 200 } }
  const d = draftOf(o)
  assert.deepEqual(d.items.map((i) => i.id), ['b1'])
  assert.deepEqual(d.cashService, { kind: 'hide', notes: { 100: 2 } })
})
t('draftOf: บริการต่อรายการ → ส่ง cashService ในแต่ละรายการ (ไม่ส่งระดับออร์เดอร์)', () => {
  const cake = { ...good, id: 'a1', cashService: { kind: 'hide', notes: { 100: 2 } } }
  const svc = { ...svcHide, id: 'svc-hide-a1', forItem: 'a1' }
  const d = draftOf({ customerId: 'c1', fulfillment: 'pickup', pickupAt: '2026-11-30T10:00', items: [cake, svc], adjustment: null, holdMoney: { kind: 'hide', notes: { 100: 2 }, amount: 200 } })
  assert.deepEqual(d.items.map((i) => i.id), ['a1'])
  assert.deepEqual(d.items[0].cashService, { kind: 'hide', notes: { 100: 2 } })
  assert.equal('cashService' in d, false)
})
t('draftOf: ออร์เดอร์ปกติไม่มี cashService', () => {
  const d = draftOf({ customerId: 'c1', fulfillment: 'pickup', pickupAt: '2026-11-30T10:00', items: [good], adjustment: null })
  assert.equal('cashService' in d, false)
})

if (fail) { console.log(`ล้ม ${fail} รายการ`); process.exit(1) }
await server.close()
console.log('ผ่านทั้งหมด')
