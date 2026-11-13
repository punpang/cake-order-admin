// ทดสอบรหัสสุ่มไม่ซ้ำของรายการแจ้งชำระ (Ref 2 ของ QR)
import { assertEquals } from 'jsr:@std/assert@1'
import { newQrRef, qrRefOk } from './payqr.ts'

Deno.test('รหัสสุ่ม 12 ตัวตามชุดอักษร และไม่ซ้ำกันในการสุ่มหลายครั้ง', () => {
  const seen = new Set<string>()
  for (let i = 0; i < 200; i++) {
    const r = newQrRef()
    assertEquals(qrRefOk(r), true)
    seen.add(r)
  }
  assertEquals(seen.size, 200)
})

Deno.test('qrRefOk ไม่รับตัวอักษรที่อ่านสับสนและความยาวผิด', () => {
  assertEquals(qrRefOk('ABCDEFGHJKMN'), true)
  assertEquals(qrRefOk('ABCDEFGH0JKM'), false)
  assertEquals(qrRefOk('ABCDEFGHIJKM'), false)
  assertEquals(qrRefOk('ABC'), false)
  assertEquals(qrRefOk(null), false)
})
