// ทดสอบชื่อช่องสัญญาณ (ลูกค้าและออร์เดอร์) · รันด้วย npm run test:deno (โฟลเดอร์ _shared)
import { assertEquals } from 'jsr:@std/assert@1'
import { CHAT_TOPIC_RE, newChatTopic, newTopic } from './chattopic.ts'

Deno.test('ชื่อช่องสัญญาณ: รูปแบบ chat- ตามด้วย hex 48 ตัว (192 บิต)', () => {
  assertEquals(CHAT_TOPIC_RE.test(newChatTopic()), true)
  assertEquals(CHAT_TOPIC_RE.test('chat-XYZ'), false)
  assertEquals(CHAT_TOPIC_RE.test('chat-' + 'a'.repeat(47)), false)
})

Deno.test('ชื่อช่องของออร์เดอร์: รูปแบบ order- ตามด้วย hex 48 ตัว', () => {
  const t = newTopic('order')
  assertEquals(/^order-[0-9a-f]{48}$/.test(t), true)
  assertEquals(t.startsWith('chat-'), false)
})

Deno.test('ชื่อช่องสัญญาณ: สุ่มไม่ซ้ำ', () => {
  const seen = new Set(Array.from({ length: 200 }, () => newChatTopic()))
  assertEquals(seen.size, 200)
})
