// ทดสอบข้อความแทนไฟล์แนบที่ระบบไม่เก็บเป็นไฟล์ · รัน: npx --yes deno@2.1.4 test --no-prompt --no-lock --node-modules-dir=none _shared/attnote.test.ts
import { assertEquals } from 'jsr:@std/assert@1'
import { attachmentNote } from './attnote.ts'

Deno.test('ลิงก์ที่แชร์ แสดงชื่อเรื่องและลิงก์ https', () => {
  assertEquals(attachmentNote({ type: 'share', title: 'เค้กช็อกโกแลต', payload: { url: 'https://example.com/a' } }), '[ลิงก์ที่แชร์] เค้กช็อกโกแลต https://example.com/a')
})
Deno.test('ลิงก์ที่ไม่ใช่ https ไม่แสดงลิงก์', () => {
  assertEquals(attachmentNote({ type: 'fallback', payload: { url: 'http://x.test' } }), '[ข้อความที่แชร์]')
})
Deno.test('สตอรี่ที่กล่าวถึงเพจ', () => {
  assertEquals(attachmentNote({ type: 'story_mention', payload: { url: 'https://cdn.example/s.jpg' } }), '[ลูกค้ากล่าวถึงเพจในสตอรี่] https://cdn.example/s.jpg')
})
Deno.test('ชนิดที่ไม่รู้จักและไม่มีเนื้อหา → null', () => {
  assertEquals(attachmentNote({ type: 'something_new', payload: {} }), null)
  assertEquals(attachmentNote(null), null)
})
Deno.test('ตัดอักขระควบคุมและความยาว', () => {
  const n = attachmentNote({ type: 'share', title: 'a\u0000b'.repeat(200) })
  assertEquals(n?.includes('\u0000'), false)
  assertEquals((n ?? '').length <= 200 + '[ลิงก์ที่แชร์] '.length, true)
})
Deno.test('การ์ดข้อความ (template) แสดงชื่อการ์ดจากรายการแรก', () => {
  assertEquals(attachmentNote({ type: 'template', payload: { template_type: 'generic', elements: [{ title: 'ออร์เดอร์ OR-1' }] } }), '[การ์ดข้อความ] ออร์เดอร์ OR-1')
})
