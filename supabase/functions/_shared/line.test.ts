// ทดสอบ LINE OA: ลายเซ็น webhook · แยกเหตุการณ์ · ชนิดข้อความ · รูปแบบรหัสผู้ใช้ · รันด้วย npm run test:deno
import { assertEquals } from 'jsr:@std/assert@1'
import { isLineUserId, LINE_TEXT_MAX, lineMessageText, parseLineEvents, verifyLineSignature } from './line.ts'

const SECRET = 'test-channel-secret'
async function sign(body: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)))
  return btoa(String.fromCharCode(...mac))
}

Deno.test('ลายเซ็น webhook: ตรงเฉพาะเนื้อหาและ secret ที่ถูกต้อง', async () => {
  const body = '{"events":[]}'
  const sig = await sign(body, SECRET)
  assertEquals(await verifyLineSignature(body, sig, SECRET), true)
  assertEquals(await verifyLineSignature(`${body} `, sig, SECRET), false)
  assertEquals(await verifyLineSignature(body, await sign(body, 'other-secret'), SECRET), false)
  assertEquals(await verifyLineSignature(body, null, SECRET), false)
  assertEquals(await verifyLineSignature(body, sig, ''), false)
})

Deno.test('แยกเหตุการณ์: ข้อความตัวอักษร / สติกเกอร์ / follow · ข้อมูลผิดรูปแบบ = ไม่มีเหตุการณ์', () => {
  const raw = JSON.stringify({ events: [
    { type: 'message', source: { type: 'user', userId: `U${'a'.repeat(32)}` }, webhookEventId: 'w1', timestamp: 1700000000000, message: { id: 'm1', type: 'text', text: 'สวัสดี' } },
    { type: 'message', source: { type: 'user', userId: `U${'b'.repeat(32)}` }, webhookEventId: 'w2', timestamp: 1, message: { id: 'm2', type: 'sticker' } },
    { type: 'follow', source: { type: 'user', userId: `U${'c'.repeat(32)}` }, webhookEventId: 'w3', timestamp: 2 },
  ] })
  const ev = parseLineEvents(raw)
  assertEquals(ev.length, 3)
  assertEquals(ev[0].message?.text, 'สวัสดี')
  assertEquals(ev[1].message?.type, 'sticker')
  assertEquals(ev[2].type, 'follow')
  assertEquals(parseLineEvents('ไม่ใช่ JSON'), [])
  assertEquals(parseLineEvents('{}'), [])
})

Deno.test('ข้อความในแชท: ตัวอักษรทำความสะอาดและจำกัดความยาว · ชนิดอื่นเป็นป้าย', () => {
  assertEquals(lineMessageText({ type: 'text', text: '  สวัส\u0001ดี  ' }), 'สวัสดี')
  assertEquals(lineMessageText({ type: 'text', text: 'ก'.repeat(LINE_TEXT_MAX + 10) }).length, LINE_TEXT_MAX)
  assertEquals(lineMessageText({ type: 'image', text: '' }), '[รูปภาพ]')
  assertEquals(lineMessageText({ type: 'unknown', text: '' }), '[ข้อความที่ยังไม่รองรับ]')
})

Deno.test('รหัสผู้ใช้ LINE: U ตามด้วย hex 32 ตัว', () => {
  assertEquals(isLineUserId(`U${'a'.repeat(32)}`), true)
  assertEquals(isLineUserId('Ua'), false)
  assertEquals(isLineUserId(`U${'g'.repeat(32)}`), false)
  assertEquals(isLineUserId(null), false)
})
