// ทดสอบการตรวจออร์เดอร์ตรงฝั่งเซิร์ฟเวอร์ (order-audit ใช้ _shared/schedlib/orderAudit.js) ให้ผลเหมือนแอป
// ข้อมูลอ้างอิงคือใบเสนอที่คิดด้วยตรรกะเดียวกับการขาย (src/lib/quotePrice.golden.json) · รันผ่าน npm run test:deno
import { assertEquals } from 'jsr:@std/assert@1'
import { auditOrder } from './schedlib/orderAudit.js'
import golden from '../../../src/lib/quotePrice.golden.json' with { type: 'json' }

const g: any = golden
const clone = (x: any) => JSON.parse(JSON.stringify(x))
const catFor = (c: any) => (c.shopVat ? { ...g.catalog, shop: { ...g.catalog.shop, vat: c.shopVat } } : g.catalog)
const orderOf = (c: any) => ({ ...clone(c.payload), status: 'awaiting_payment', channel: null, payments: [], adjustment: { amount: 0, reason: '' } })

for (const c of g.cases.filter((x: any) => x.payload)) {
  Deno.test(`order-audit: ออร์เดอร์ตรงถูกต้อง ${c.name} ผ่าน`, () => {
    const r: any = auditOrder(orderOf(c), catFor(c), { nowMs: g.nowMs })
    assertEquals(r.ok, true)
  })
}

Deno.test('order-audit: ราคาต่อชิ้นที่ถูกแก้ถูกจับ', () => {
  const c = g.cases.find((x: any) => x.name === 'cake-pickup')
  const o = orderOf(c)
  o.items[0].unitPrice = o.items[0].unitPrice - 50
  const r: any = auditOrder(o, catFor(c), { nowMs: g.nowMs })
  assertEquals(r.ok, false)
  assertEquals(r.flags.some((f: any) => f.code === 'unit_price_mismatch'), true)
})
