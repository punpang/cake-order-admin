// ทดสอบกติกาจำกัดออเดอร์ต่อวัน · รัน: deno test supabase/functions/_shared/ordercap.test.ts
import { assertEquals } from 'jsr:@std/assert@1'
import { capFull, countPath, dayOfPickup } from './ordercap.ts'

Deno.test('dayOfPickup: ตัด 10 ตัวแรกของเวลานัด', () => {
  assertEquals(dayOfPickup('2026-11-20T10:30'), '2026-11-20')
  assertEquals(dayOfPickup('2026-11-20'), '2026-11-20')
})
Deno.test('dayOfPickup: รูปแบบผิดได้ค่าว่าง', () => {
  assertEquals(dayOfPickup('20/11/2026'), '')
  assertEquals(dayOfPickup(null), '')
})
Deno.test('countPath: กรองวันที่และไม่นับยกเลิก/ร่าง', () => {
  const p = countPath('2026-11-20')
  assertEquals(p.includes('data->>pickupAt=like.2026-11-20*'), true)
  assertEquals(p.includes('status=not.in.(cancelled,draft)'), true)
})
Deno.test('capFull: 0 หรือค่าเสีย = ไม่จำกัด', () => {
  assertEquals(capFull(0, 999), false)
  assertEquals(capFull(undefined, 5), false)
  assertEquals(capFull('abc', 5), false)
})
Deno.test('capFull: ยังไม่ครบ / ครบพอดี / เกิน', () => {
  assertEquals(capFull(10, 9), false)
  assertEquals(capFull(10, 10), true)
  assertEquals(capFull(10, 12), true)
  assertEquals(capFull('3', 3), true)
})
