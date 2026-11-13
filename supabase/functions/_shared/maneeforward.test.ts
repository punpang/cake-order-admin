// ทดสอบการรับแจ้งเตือนแม่มณี: ลายเซ็น ยอด การกรองแอป การจับคู่กับ QR
import { assertEquals } from 'jsr:@std/assert@1'
import { verifyGatewaySignature, parseManeeAmount, isManeeApp, matchTransfers } from './maneeforward.ts'

const SECRET = 'example-secret-0123456'
const hmacHex = async (secret: string, msg: string) => {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg)))].map((x) => x.toString(16).padStart(2, '0')).join('')
}

Deno.test('ลายเซ็นถูกต้องตามเอกสาร (ตัวอย่าง)', async () => {
  const body = '{"event":"sms.forwarded","id":"9b2f6c1e-4a7d-4e0b-8c52-1f3a7e9d0b11","rule_id":3,"from":"+66812345678","body":"รหัส OTP 1234","received_at":1731230000000}'
  const sig = 'sha256=0d821f723cffa86db75d9a95569067bced57730762f5754a760b5401e8cd2ed6'
  assertEquals(await verifyGatewaySignature(SECRET, '1731230000', body, sig, 1731230000), true)
})

Deno.test('ลายเซ็นผิด / body ถูกแก้ / เวลาเกิน 5 นาที = ไม่ผ่าน', async () => {
  const body = '{"a":1}'
  const good = 'sha256=' + await hmacHex(SECRET, `1731230000.${body}`)
  assertEquals(await verifyGatewaySignature(SECRET, '1731230000', '{"a":2}', good, 1731230000), false)
  assertEquals(await verifyGatewaySignature(SECRET, '1731230000', body, good, 1731230000 + 301), false)
  assertEquals(await verifyGatewaySignature('short', '1731230000', body, good, 1731230000), false)
  assertEquals(await verifyGatewaySignature(SECRET, '1731230000', body, good, 1731230000), true)
})

Deno.test('ยอดจากข้อความแม่มณี', () => {
  assertEquals(parseManeeAmount('คุณได้รับเงิน 1.00 บาท จาก MR.Someone'), 1)
  assertEquals(parseManeeAmount('คุณได้รับเงิน 1,250.50 บาท จาก X'), 1250.5)
  assertEquals(parseManeeAmount('คุณโอนเงิน 500.00 บาท ให้ X'), null)
  assertEquals(parseManeeAmount(''), null)
})

Deno.test('กรองแอปแม่มณี', () => {
  assertEquals(isManeeApp('com.x', 'แอปพลิเคชัน แม่มณี'), true)
  assertEquals(isManeeApp('com.other', 'ธนาคาร'), false)
  assertEquals(isManeeApp('com.manee.pkg', '', 'com.manee.pkg'), true)
})

Deno.test('จับคู่: ยอดเท่ากัน และเวลาอยู่ในช่วงอายุ QR (หลังสร้าง ไม่เกินหมดอายุ)', () => {
  const qr = { amount: 90, createdAtMs: 1000_000, expiresAtMs: 1000_000 + 600_000 }
  const list = [
    { id: 'a', amount: 90, receivedAtMs: 1000_000 - 1 },   // ก่อนสร้าง QR
    { id: 'b', amount: 90, receivedAtMs: 1000_000 + 5_000 }, // ตรง
    { id: 'c', amount: 89, receivedAtMs: 1000_000 + 5_000 }, // ยอดไม่ตรง
    { id: 'd', amount: 90, receivedAtMs: 1000_000 + 700_000 }, // หมดอายุแล้ว
    { id: 'e', amount: 90, receivedAtMs: 1000_000 + 600_000 }, // พอดีเวลาหมดอายุ = ตรง
  ]
  assertEquals(matchTransfers(list, qr).map((t) => t.id), ['b', 'e'])
})
