// ทดสอบการคิดราคาใบเสนอฝั่งเซิร์ฟเวอร์ (quote-create ใช้ _shared/schedlib/quotePrice.js) ให้ตรงกับไฟล์อ้างอิงที่สร้างจากโค้ดเดิมของแอป
// (src/lib/quotePrice.golden.json) · รันผ่าน npm run test:deno
import { assertEquals } from 'jsr:@std/assert@1'
import { buildQuotePayload, bkkWall } from './schedlib/quotePrice.js'
import golden from '../../../src/lib/quotePrice.golden.json' with { type: 'json' }

const clone = (x: unknown) => JSON.parse(JSON.stringify(x))
// ผลการคิดราคา (โมดูล JS ไม่มีชนิดที่แยกกรณีสำเร็จ/ไม่สำเร็จ จึงกำหนดเองที่ขอบเขตนี้)
type BuildResult = { ok: boolean; code?: string; error?: string; payload?: any }
const buildAny = (args: any): BuildResult => buildQuotePayload(args) as BuildResult
const catFor = (c: any) => (c.shopVat ? { ...golden.catalog, shop: { ...golden.catalog.shop, vat: c.shopVat } } : golden.catalog)

for (const c of golden.cases as any[]) {
  Deno.test(`quote-create: ตรงกับแอป — ${c.name}`, () => {
    const r = buildAny({ draft: c.draft, customerId: c.customerId, catalog: catFor(c), nowMs: golden.nowMs })
    if (c.payload === null) {
      assertEquals(r.ok, false)
      assertEquals(r.code, 'closed')
      return
    }
    assertEquals(r.ok, true)
    assertEquals(clone(r.payload), c.payload)
  })
}

const base = (golden.cases as any[]).find((c) => c.name === 'retail-promos-and-gift')
const retailOf = (d: any) => d.items.find((i: any) => i.kind === 'retail')

Deno.test('quote-create: ราคาสินค้าหน้าร้านมาจากแคตาล็อก ไม่ใช่จากเครื่องพนักงาน', () => {
  const d = clone(base.draft)
  retailOf(d).retailPrice = 1
  const r = buildAny({ draft: d, customerId: base.customerId, catalog: golden.catalog, nowMs: golden.nowMs })
  assertEquals(r.ok, true)
  assertEquals(clone(r.payload), base.payload)
})

Deno.test('quote-create: สินค้าที่ปิดขายหรือไม่มีในระบบถูกปฏิเสธ', () => {
  const cat = clone(golden.catalog)
  cat.retailItems.find((x: any) => x.id === retailOf(base.draft).retailId).active = false
  assertEquals(buildAny({ draft: base.draft, customerId: null, catalog: cat, nowMs: golden.nowMs }).ok, false)
  const d = clone(base.draft)
  retailOf(d).retailId = 'no-such-item'
  assertEquals(buildAny({ draft: d, customerId: null, catalog: golden.catalog, nowMs: golden.nowMs }).ok, false)
})

Deno.test('quote-create: จำนวนและรูปแบบเวลาที่ไม่ถูกต้องถูกปฏิเสธ', () => {
  const d = clone(base.draft)
  retailOf(d).qty = 0
  assertEquals(buildAny({ draft: d, customerId: null, catalog: golden.catalog, nowMs: golden.nowMs }).ok, false)
  const e = clone(base.draft)
  e.pickupAt = '2026-11-21T15:00:00Z'
  assertEquals(buildAny({ draft: e, customerId: null, catalog: golden.catalog, nowMs: golden.nowMs }).ok, false)
})

Deno.test('quote-create: เวลาไทยไม่ขึ้นกับโซนของเซิร์ฟเวอร์', () => {
  // 2026-11-15 03:00 UTC = 10:00 น. ตามเวลาไทย
  const w = bkkWall(Date.parse('2026-11-15T03:00:00Z'))
  assertEquals([w.getHours(), w.getDate(), w.getMonth()], [10, 15, 10])
})
