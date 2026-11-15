// ทดสอบสถานะพิมพ์และอ่านแล้ว (ฝั่งเซิร์ฟเวอร์): ร้านเปิดปิดได้เฉพาะ "ลูกค้าเห็นร้าน" · ค่าเริ่มต้นเปิด
import { assertEquals } from 'jsr:@std/assert@1'
import { shopPresenceOf, TYPING_WINDOW_MS } from './chatpresence.ts'

const NOW = Date.UTC(2026, 10, 15, 4, 0, 0)
const ago = (ms: number) => new Date(NOW - ms).toISOString()

Deno.test('ร้านพิมพ์อยู่ (ภายในช่วง) → ลูกค้าเห็นว่าร้านกำลังพิมพ์', () => {
  assertEquals(shopPresenceOf({ staff_typing_at: ago(1000) }, undefined, NOW).shopTyping, true)
})

Deno.test('ร้านหยุดพิมพ์นานกว่าช่วงที่กำหนด → ไม่แสดง', () => {
  assertEquals(shopPresenceOf({ staff_typing_at: ago(TYPING_WINDOW_MS + 1) }, undefined, NOW).shopTyping, false)
})

Deno.test('ร้านปิดสถานะพิมพ์ → ลูกค้าไม่เห็น แม้พิมพ์อยู่', () => {
  assertEquals(shopPresenceOf({ staff_typing_at: ago(500) }, { typing: false }, NOW).shopTyping, false)
})

Deno.test('ร้านอ่านแล้ว → ส่งเวลาอ่านให้ลูกค้า · ปิดการแสดงอ่านแล้ว → ไม่ส่ง', () => {
  const at = ago(3000)
  assertEquals(shopPresenceOf({ staff_read_at: at }, undefined, NOW).shopReadAt, at)
  assertEquals(shopPresenceOf({ staff_read_at: at }, { read: false }, NOW).shopReadAt, null)
})

Deno.test('ไม่มีแถวสถานะ → ไม่แสดงอะไร', () => {
  assertEquals(shopPresenceOf(null, undefined, NOW), { shopTyping: false, shopReadAt: null })
})

Deno.test('ค่าเวลาที่อ่านไม่ได้ → ไม่แสดง', () => {
  assertEquals(shopPresenceOf({ staff_typing_at: 'ไม่ใช่เวลา', staff_read_at: 'ไม่ใช่เวลา' }, undefined, NOW), { shopTyping: false, shopReadAt: null })
})
