// ทดสอบการตรวจบิลหน้าร้านฝั่งเซิร์ฟเวอร์ (pos-audit ใช้ _shared/schedlib/posAudit.js) ให้ผลเหมือนแอป (src/lib/posAudit.golden.json)
// รันผ่าน npm run test:deno
import { assertEquals } from 'jsr:@std/assert@1'
import { auditPosOrder } from './schedlib/posAudit.js'
import golden from '../../../src/lib/posAudit.golden.json' with { type: 'json' }

const g: any = golden
const clone = (x: any) => JSON.parse(JSON.stringify(x))
const codesOf = (r: any): string[] => r.flags.map((f: any) => f.code)

for (const b of g.bills) {
  Deno.test(`pos-audit: บิลขายถูกต้อง ${b.code} ผ่าน`, () => {
    const r: any = auditPosOrder(b, g.catalog)
    assertEquals(r.ok, true)
  })
}

Deno.test('pos-audit: การลดราคาฐานของสินค้าถูกจับ', () => {
  const b = clone(g.bills[0])
  Object.assign(b.items[0], { retailPrice: 1, fullPrice: 1, unitPrice: 1, discounts: [] })
  const r: any = auditPosOrder(b, g.catalog)
  assertEquals(r.ok, false)
  assertEquals(codesOf(r).includes('base_price_mismatch'), true)
})
