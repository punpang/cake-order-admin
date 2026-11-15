// ทดสอบชื่อช่องสัญญาณของลูกค้า · รันด้วย npm run test:deno (โฟลเดอร์ _shared)
import { assertEquals } from 'jsr:@std/assert@1'
import { CHAT_TOPIC_RE, newChatTopic } from './chattopic.ts'

Deno.test('ชื่อช่องสัญญาณ: รูปแบบ chat- ตามด้วย hex 48 ตัว (192 บิต)', () => {
  assertEquals(CHAT_TOPIC_RE.test(newChatTopic()), true)
  assertEquals(CHAT_TOPIC_RE.test('chat-XYZ'), false)
  assertEquals(CHAT_TOPIC_RE.test('chat-' + 'a'.repeat(47)), false)
})

Deno.test('ชื่อช่องสัญญาณ: สุ่มไม่ซ้ำ', () => {
  const seen = new Set(Array.from({ length: 200 }, () => newChatTopic()))
  assertEquals(seen.size, 200)
})
