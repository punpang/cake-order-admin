// ทดสอบบริการเกี่ยวกับเงิน (ซ่อนเงิน/ดึงเงิน/ซ่อนของ): ราคาคิดจากการตั้งค่า · เงินพักจากธนบัตร · ใบเสนอ/ออร์เดอร์ · รายการค่าบริการไม่เข้าแต้ม
// รัน: node src/lib/cashService.test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { cashServiceOf, cashSettingsOf } from './cashService.js'
import { buildQuotePayload } from './quotePrice.js'
import { orderTotals } from './pricing.js'

const golden = JSON.parse(readFileSync(new URL('./quotePrice.golden.json', import.meta.url), 'utf8'))
const shop = { cashService: { maxNotes: 5, services: { hide: { fee: 50, show: true }, pull: { fee: 40, show: true }, stash: { fee: 30, show: true } } } }
const hideShop = (over = {}) => ({ cashService: { ...shop.cashService, ...over } })
let fail = 0
const t = (name, fn) => { try { fn(); console.log('ok -', name) } catch (e) { fail++; console.log('FAIL -', name, e.message) } }

t('ค่าเริ่มต้น: ไม่มีการตั้งค่า = ไม่เปิดบริการ ค่าบริการ 0 ไม่จำกัดธนบัตร', () => {
  const s = cashSettingsOf(undefined)
  assert.equal(s.maxNotes, 0)
  for (const k of ['hide', 'pull', 'stash']) assert.deepEqual(s.services[k], { fee: 0, show: false, customer: false })
})
t('ค่าตั้งผิดรูปแบบ (ค่าบริการติดลบ/ข้อความ) ถูกปรับเป็น 0 และ maxNotes ติดลบเป็น 0', () => {
  const s = cashSettingsOf({ cashService: { maxNotes: -3, services: { hide: { fee: -5, show: 'yes' }, pull: { fee: 'abc', show: true } } } })
  assert.equal(s.maxNotes, 0)
  assert.deepEqual(s.services.hide, { fee: 0, show: false, customer: false })
  assert.deepEqual(s.services.pull, { fee: 0, show: true, customer: false })
})
t('ไม่ใช้บริการ (ไม่มี input) → ไม่มีรายการและไม่มีเงินพัก', () => {
  assert.deepEqual(cashServiceOf(undefined, shop), { ok: true, item: null, holdMoney: null })
  assert.deepEqual(cashServiceOf(null, shop), { ok: true, item: null, holdMoney: null })
})
t('ประเภทไม่รู้จัก → ไม่ผ่าน', () => assert.equal(cashServiceOf({ kind: 'other' }, shop).ok, false))
t('บริการที่ยังไม่เปิดให้ลูกค้าเห็น (show = false) → ไม่ผ่าน', () => {
  assert.equal(cashServiceOf({ kind: 'hide', notes: { 100: 1 } }, { cashService: { services: { hide: { fee: 50, show: false } } } }).ok, false)
})
t('ซ่อนเงิน: ยอดเงินพักคำนวณจากธนบัตร (client ส่ง amount มาก็ไม่ใช้) · ค่าบริการจากการตั้งค่า (client ส่ง unitPrice มาก็ไม่ใช้)', () => {
  const r = cashServiceOf({ kind: 'hide', notes: { 1000: 1, 100: 2 }, amount: 1, unitPrice: 0, fee: 0 }, shop)
  assert.equal(r.ok, true, r.error)
  assert.deepEqual(r.holdMoney, { kind: 'hide', notes: { 1000: 1, 100: 2 }, amount: 1200 })
  assert.equal(r.item.kind, 'service')
  assert.equal(r.item.unitPrice, 50)
  assert.equal(r.item.noPoints, true)
})
t('ดึงเงิน: ใช้ธนบัตรได้เช่นกัน และค่าบริการของดึงเงิน', () => {
  const r = cashServiceOf({ kind: 'pull', notes: { 500: 1 } }, shop)
  assert.equal(r.holdMoney.kind, 'pull')
  assert.equal(r.item.unitPrice, 40)
})
t('ธนบัตรไม่ถูกต้อง → ไม่ผ่าน: ทศนิยม · ติดลบ · ธนบัตรที่ไม่รองรับ · ว่าง · ไม่ใช่ออบเจกต์', () => {
  assert.equal(cashServiceOf({ kind: 'hide', notes: { 100: 1.5 } }, shop).ok, false)
  assert.equal(cashServiceOf({ kind: 'hide', notes: { 100: -1 } }, shop).ok, false)
  assert.equal(cashServiceOf({ kind: 'hide', notes: { 200: 1 } }, shop).ok, false)
  assert.equal(cashServiceOf({ kind: 'hide', notes: {} }, shop).ok, false)
  assert.equal(cashServiceOf({ kind: 'hide', notes: [100] }, shop).ok, false)
  assert.equal(cashServiceOf({ kind: 'hide' }, shop).ok, false)
})
t('เพดานจำนวนธนบัตรจากการตั้งค่า (5 ใบ): 6 ใบไม่ผ่าน · 5 ใบผ่าน', () => {
  assert.equal(cashServiceOf({ kind: 'hide', notes: { 100: 6 } }, shop).ok, false)
  assert.equal(cashServiceOf({ kind: 'hide', notes: { 100: 5 } }, shop).ok, true)
})
t('ซ่อนของ: ไม่มีธนบัตรและไม่มีเงินพัก · ส่งธนบัตรมาต้องไม่ผ่าน', () => {
  const r = cashServiceOf({ kind: 'stash' }, shop)
  assert.equal(r.ok, true)
  assert.equal(r.holdMoney, null)
  assert.equal(r.item.unitPrice, 30)
  assert.equal(cashServiceOf({ kind: 'stash', notes: { 100: 1 } }, shop).ok, false)
})

// ใบเสนอ: รายการค่าบริการ + เงินพักอยู่ในใบเสนอที่เซิร์ฟเวอร์คิด · ไม่รับรายการ kind 'service' จากเครื่อง
const catalog = { ...golden.catalog, shop: { ...golden.catalog.shop, ...hideShop() } }
const retailDraft = (extra = {}) => ({
  fulfillment: 'pickup', pickupAt: '2026-11-30T10:00',
  items: [{ id: 'b1', kind: 'retail', retailId: 'rt1', retailPrice: 75, sizeId: null, typeId: null, mods: [], qty: 4, selections: {}, note: '', images: [], tiers: [] }],
  ...extra,
})
t('ใบเสนอมีค่าบริการซ่อนเงินเป็นรายการและมีเงินพัก (ยอดรวมรวมค่าบริการ)', () => {
  const r = buildQuotePayload({ draft: retailDraft({ cashService: { kind: 'hide', notes: { 1000: 1 } } }), customerId: 'c1', catalog, nowMs: golden.nowMs })
  assert.equal(r.ok, true, r.error)
  const svc = r.payload.items.find((i) => i.kind === 'service')
  assert.equal(svc.unitPrice, 50)
  assert.deepEqual(r.payload.holdMoney, { kind: 'hide', notes: { 1000: 1 }, amount: 1000 })
  const o = orderTotals({ ...r.payload, payments: [], returns: [], couponsUsed: [], pointsUsed: null })
  assert.equal(o.hold, 1000)
  assert.equal(o.total, 300 + 50) // สินค้า 75×4 + ค่าบริการ 50 (ไม่รวมเงินพัก)
  assert.equal(o.payable, 1350)
})
t('รายการ kind service ที่ส่งมาในสินค้าถูกปฏิเสธ (ราคาต้องมาจากการตั้งค่า)', () => {
  const draft = retailDraft({ items: [{ id: 'fake', kind: 'service', unitPrice: 1, qty: 1 }] })
  assert.equal(buildQuotePayload({ draft, customerId: 'c1', catalog, nowMs: golden.nowMs }).ok, false)
})
t('ไม่ใช้บริการ: ใบเสนอเหมือนเดิม (ไม่มีรายการค่าบริการ ไม่มีเงินพัก)', () => {
  const r = buildQuotePayload({ draft: retailDraft(), customerId: 'c1', catalog, nowMs: golden.nowMs })
  assert.equal(r.ok, true, r.error)
  assert.equal(r.payload.items.some((i) => i.kind === 'service'), false)
  assert.equal(r.payload.holdMoney, undefined)
})
t('บริการที่ปิดอยู่ในการตั้งค่า → ใบเสนอไม่ผ่าน', () => {
  const off = { ...golden.catalog, shop: { ...golden.catalog.shop, ...hideShop({ services: { hide: { fee: 50, show: false } } }) } }
  assert.equal(buildQuotePayload({ draft: retailDraft({ cashService: { kind: 'hide', notes: { 100: 1 } } }), customerId: 'c1', catalog: off, nowMs: golden.nowMs }).ok, false)
})

t('ให้ลูกค้าเห็น (customer): ค่าเริ่มต้นปิด · เปิดได้เฉพาะเมื่อเปิดให้บริการแล้ว · ค่าผิดรูปแบบเป็นปิด', () => {
  const none = cashSettingsOf(undefined)
  for (const k of ['hide', 'pull', 'stash']) assert.equal(none.services[k].customer, false)
  const s = cashSettingsOf({ cashService: { services: { hide: { fee: 50, show: true, customer: true }, pull: { fee: 40, show: false, customer: true }, stash: { fee: 30, show: true, customer: 'yes' } } } })
  assert.equal(s.services.hide.customer, true)
  assert.equal(s.services.pull.customer, false, 'ปิดบริการแล้วต้องไม่ให้ลูกค้าเห็น')
  assert.equal(s.services.stash.customer, false, 'ค่าที่ไม่ใช่ true ต้องเป็นปิด')
})
t('customer ไม่เปลี่ยนกติกาฝั่งพนักงาน: บริการที่เปิดให้บริการ (show) รับได้แม้ปิดให้ลูกค้าเห็น', () => {
  const r = cashServiceOf({ kind: 'hide', notes: { 100: 1 } }, { cashService: { services: { hide: { fee: 50, show: true, customer: false } } } })
  assert.equal(r.ok, true)
})

if (fail) { console.log(`ล้ม ${fail} รายการ`); process.exit(1) }
console.log('ผ่านทั้งหมด')
