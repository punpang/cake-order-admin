// ทดสอบบริการเกี่ยวกับเงินฝั่งเซิร์ฟเวอร์ (ชุดเดียวกับแอปผ่าน schedlib): ราคา/เงินพักคิดที่เซิร์ฟเวอร์ และปฏิเสธค่าที่เครื่องส่งมาเอง
// รัน: npx -y deno@2 test --no-prompt --no-lock --node-modules-dir=none supabase/functions/_shared/
import { assert, assertEquals } from 'jsr:@std/assert@1'
import { cashServiceOf, cashSettingsOf } from './schedlib/cashService.js'
import { buildQuotePayload } from './schedlib/quotePrice.js'
import { orderTotals } from './schedlib/pricing.js'

const shop = { cashService: { maxNotes: 5, services: { hide: { fee: 50, show: true }, pull: { fee: 40, show: true }, stash: { fee: 30, show: true } } } }
// ใช้ fixture เดียวกับ src/lib/cashService.test.mjs (quotePrice.golden.json) เพื่อให้แอปกับเซิร์ฟเวอร์ตรวจกับข้อมูลชุดเดียวกัน
import golden from '../../../src/lib/quotePrice.golden.json' with { type: 'json' }

Deno.test('ค่าบริการ/ธนบัตรเริ่มต้นเมื่อไม่มีการตั้งค่า', () => {
  const s: any = cashSettingsOf(undefined)
  assertEquals(s.maxNotes, 0)
  assertEquals(s.services.hide, { fee: 0, show: false, customer: false })
})

Deno.test('ซ่อนเงิน: เงินพักคิดจากธนบัตร ค่าบริการจากการตั้งค่า (ค่าที่ client ส่งมาถูกละเลย)', () => {
  const r: any = cashServiceOf({ kind: 'hide', notes: { 1000: 1, 100: 2 }, amount: 1, unitPrice: 0 }, shop)
  assert(r.ok)
  assertEquals(r.holdMoney, { kind: 'hide', notes: { 1000: 1, 100: 2 }, amount: 1200 })
  assertEquals(r.item?.unitPrice, 50)
  assertEquals(r.item?.kind, 'service')
  assertEquals(r.item?.noPoints, true)
})

Deno.test('ซ่อนของ: ไม่มีเงินพัก และห้ามส่งธนบัตรมา', () => {
  assertEquals((cashServiceOf({ kind: "stash" }, shop) as any).holdMoney, null)
  assert(!(cashServiceOf({ kind: 'stash', notes: { 100: 1 } }, shop) as any).ok)
})

Deno.test('ธนบัตรผิดรูปแบบ/เกินเพดาน/ประเภทไม่รู้จัก/บริการปิดอยู่ → ไม่ผ่าน', () => {
  assert(!(cashServiceOf({ kind: 'hide', notes: { 200: 1 } }, shop) as any).ok)
  assert(!(cashServiceOf({ kind: 'hide', notes: { 100: 1.5 } }, shop) as any).ok)
  assert(!(cashServiceOf({ kind: 'hide', notes: { 100: 6 } }, shop) as any).ok)
  assert(!(cashServiceOf({ kind: 'other' }, shop) as any).ok)
  assert(!(cashServiceOf({ kind: 'hide', notes: { 100: 1 } }, { cashService: { services: { hide: { fee: 50, show: false } } } }) as any).ok)
})

Deno.test('ใบเสนอฝั่งเซิร์ฟเวอร์: มีรายการค่าบริการและเงินพัก · ยอดรวมรวมค่าบริการ ไม่รวมเงินพัก', () => {
  const catalog = { ...golden.catalog, shop: { ...golden.catalog.shop, cashService: shop.cashService } }
  const draft = {
    fulfillment: 'pickup',
    pickupAt: '2026-11-30T10:00',
    items: [{ id: 'b1', kind: 'retail', retailId: 'rt1', retailPrice: 75, sizeId: null, typeId: null, mods: [], qty: 4, selections: {}, note: '', images: [], tiers: [] }],
    cashService: { kind: 'hide', notes: { 1000: 1 } },
  }
  const r: any = buildQuotePayload({ draft, customerId: 'c1', catalog, nowMs: golden.nowMs })
  assert(r.ok, r.error)
  assertEquals(r.payload.holdMoney.amount, 1000)
  assert(r.payload.items.some((i: { kind: string }) => i.kind === 'service'))
  const o = orderTotals({ ...r.payload, payments: [], returns: [], couponsUsed: [], pointsUsed: null })
  assertEquals(o.total, 350)
  assertEquals(o.hold, 1000)
})

Deno.test('รายการ kind service ที่ส่งมาจากเครื่องถูกปฏิเสธ', () => {
  const draft = {
    fulfillment: 'pickup',
    pickupAt: '2026-11-30T10:00',
    items: [{ id: 'x', kind: 'service', unitPrice: 1, qty: 1 }],
  }
  assert(!buildQuotePayload({ draft, customerId: 'c1', catalog: golden.catalog, nowMs: golden.nowMs }).ok)
})
