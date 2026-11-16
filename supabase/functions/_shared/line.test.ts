// ทดสอบ LINE: ลายเซ็น การแยกเหตุการณ์ การตัดความยาว และเนื้อหาตอบกลับ · รัน: deno test supabase/functions/_shared/
import { assertEquals } from 'jsr:@std/assert@1'
import { clampText, LINE_TEXT_MAX, lineSignature, parseLineEvents, replyBody, safeEq, verifyLineSignature } from './line.ts'

const SECRET = 'test-secret'
const BODY = '{"events":[{"type":"message"}]}'
// ค่าที่คำนวณไว้ล่วงหน้าด้วย HMAC-SHA256 (openssl) สำหรับความลับและเนื้อหาข้างบน
const EXPECTED = 'oIX+R0sXD8C2DbEWugN3+J/L8j+gFjLgdcVuQpMibHE='

Deno.test('ลายเซ็นตรงกับค่าที่คำนวณไว้ล่วงหน้า', async () => {
  assertEquals(await lineSignature(SECRET, BODY), EXPECTED)
})

Deno.test('ตรวจลายเซ็นถูกต้อง และปฏิเสธเมื่อเนื้อหา ความลับ หรือหัวผิด', async () => {
  assertEquals(await verifyLineSignature(SECRET, BODY, EXPECTED), true)
  assertEquals(await verifyLineSignature(SECRET, BODY + ' ', EXPECTED), false)
  assertEquals(await verifyLineSignature('other', BODY, EXPECTED), false)
  assertEquals(await verifyLineSignature(SECRET, BODY, null), false)
  assertEquals(await verifyLineSignature('', BODY, EXPECTED), false)
})

Deno.test('safeEq: ความยาวต่างกันหรือต่างกันตัวเดียวเป็นไม่ตรง', () => {
  assertEquals(safeEq('abc', 'abcd'), false)
  assertEquals(safeEq('abc', 'abd'), false)
  assertEquals(safeEq('abc', 'abc'), true)
})

Deno.test('แยกเหตุการณ์จาก JSON และทนต่อข้อมูลผิดรูปแบบ', () => {
  assertEquals(parseLineEvents('not json'), [])
  assertEquals(parseLineEvents('{"destination":"x"}'), [])
  assertEquals(parseLineEvents(BODY).length, 1)
})

Deno.test('ตัดข้อความยาวเกินเพดานของ LINE และตัดช่องว่างหัวท้าย', () => {
  assertEquals(clampText('ก'.repeat(LINE_TEXT_MAX + 10)).length, LINE_TEXT_MAX)
  assertEquals(clampText('  สวัสดี  '), 'สวัสดี')
  assertEquals(clampText(null), '')
})

Deno.test('เนื้อหาตอบกลับมีไม่เกิน 5 ข้อความ และมี replyToken', () => {
  const b = JSON.parse(replyBody('tok', ['a', 'b', 'c', 'd', 'e', 'f']))
  assertEquals(b.replyToken, 'tok')
  assertEquals(b.messages.length, 5)
  assertEquals(b.messages[0], { type: 'text', text: 'a' })
})
