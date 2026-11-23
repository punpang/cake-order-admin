// ทดสอบเส้นทางข้อมูลบริการเกี่ยวกับเงิน: ออร์เดอร์ ⇄ input ที่ส่งให้เซิร์ฟเวอร์ · รายการบริการไม่ถูกส่งเป็นรายการ
// รัน: node src/lib/cashDraft.test.mjs
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { cashDraftOf, withCashService } from './cashService.js'

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
t('withCashService → คิดใหม่จากการตั้งค่า (ราคา/เงินพักเท่าเดิม) และต่อท้ายรายการสินค้า', () => {
  const r = withCashService([good], { kind: 'hide', notes: { 1000: 1, 100: 2 } }, shop)
  assert.equal(r.ok, true)
  assert.equal(r.items.length, 2)
  assert.equal(r.items[1].kind, 'service')
  assert.equal(r.items[1].unitPrice, 50)
  assert.equal(r.holdMoney.amount, 1200)
})
t('withCashService: ไม่มีบริการ → รายการเดิม ไม่มีเงินพัก', () => {
  const r = withCashService([good], undefined, shop)
  assert.deepEqual(r, { ok: true, items: [good], holdMoney: null })
})
t('withCashService: บริการที่ปิดอยู่ → ไม่ผ่าน', () => {
  const r = withCashService([good], { kind: 'pull', notes: { 100: 1 } }, { cashService: { services: { pull: { fee: 40, show: false } } } })
  assert.equal(r.ok, false)
})
t('ไป-กลับ: ออร์เดอร์ → input → คิดใหม่ได้เงินพักและค่าบริการเดิม', () => {
  const o = { items: [good, svcHide], holdMoney: { kind: 'hide', notes: { 1000: 1, 100: 2 }, amount: 1200 } }
  const r = withCashService(o.items.filter((i) => i.kind !== 'service'), cashDraftOf(o), shop)
  assert.equal(r.holdMoney.amount, o.holdMoney.amount)
  assert.equal(r.items.find((i) => i.kind === 'service').unitPrice, svcHide.unitPrice)
})
t('draftOf: ไม่ส่งรายการบริการเป็นรายการ แต่ส่ง cashService แทน', () => {
  const o = { customerId: 'c1', fulfillment: 'pickup', pickupAt: '2026-11-30T10:00', items: [good, svcHide], adjustment: null, holdMoney: { kind: 'hide', notes: { 100: 2 }, amount: 200 } }
  const d = draftOf(o)
  assert.deepEqual(d.items.map((i) => i.id), ['b1'])
  assert.deepEqual(d.cashService, { kind: 'hide', notes: { 100: 2 } })
})
t('draftOf: ออร์เดอร์ปกติไม่มี cashService', () => {
  const d = draftOf({ customerId: 'c1', fulfillment: 'pickup', pickupAt: '2026-11-30T10:00', items: [good], adjustment: null })
  assert.equal('cashService' in d, false)
})

if (fail) { console.log(`ล้ม ${fail} รายการ`); process.exit(1) }
await server.close()
console.log('ผ่านทั้งหมด')
