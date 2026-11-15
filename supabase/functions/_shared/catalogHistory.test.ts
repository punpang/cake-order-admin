// ทดสอบการย้อนแคตาล็อกไปยังเวลาที่สร้างออร์เดอร์ (order-audit ใช้ _shared/schedlib/catalogHistory.js)
// รันผ่าน npm run test:deno
import { assertEquals } from 'jsr:@std/assert@1'
import { catalogAt } from './schedlib/catalogHistory.js'

Deno.test('catalogHistory: สินค้าที่ราคาถูกแก้หลังเวลาที่สนใจ คืนราคาเดิม', () => {
  const cur: any = { retailItems: [{ id: 'a', name: 'A', price: 120, active: true }] }
  const changes: any[] = [{ source: 'item', key: 'a', old: { id: 'a', name: 'A', price: 100, active: true, data: {} }, changedAt: '2026-11-15T04:00:00Z' }]
  const r: any = catalogAt(cur, changes, Date.parse('2026-11-15T03:00:00Z'))
  assertEquals(r.retailItems[0].price, 100)
})

Deno.test('catalogHistory: การตั้งค่าที่ถูกแก้หลังเวลาที่สนใจ คืนค่าเดิม และการเปลี่ยนก่อนเวลาไม่ถูกย้อน', () => {
  const cur: any = { retailItems: [], priceLists: [{ id: 'new' }] }
  const changes: any[] = [
    { source: 'config', key: 'priceLists', old: [{ id: 'old' }], changedAt: '2026-11-15T04:00:00Z' },
    { source: 'config', key: 'priceLists', old: [{ id: 'older' }], changedAt: '2026-11-15T01:00:00Z' },
  ]
  const r: any = catalogAt(cur, changes, Date.parse('2026-11-15T03:00:00Z'))
  assertEquals(r.priceLists, [{ id: 'old' }])
})
