// ทดสอบตัวช่วย sms-send ตามกฎในเอกสาร SMS Gateway API (docs/sms-gateway-api.md) · รันผ่าน npm run test:deno
import { assertEquals } from 'jsr:@std/assert@1'
import { ID, IDEM, MAX_TEXT, customerRecipientOk, gatewayErrorText, mapGatewayStatus, normalizeNumber } from './smsgateway.ts'

Deno.test('ผู้รับ (โหมดจริง): ลูกค้าที่มีในระบบและไม่ถูกลบ → ส่งได้', () => {
  assertEquals(customerRecipientOk([{ id: 'c1', data: { active: true } }]), true)
  assertEquals(customerRecipientOk([{ id: 'c1', data: {} }]), true)
})

Deno.test('ผู้รับ (โหมดจริง): ไม่พบ / ถูกลบ / คำตอบผิดรูป → ส่งไม่ได้', () => {
  assertEquals(customerRecipientOk([]), false)
  assertEquals(customerRecipientOk([{ id: 'c1', data: { deleted: true } }]), false)
  assertEquals(customerRecipientOk(null), false)
  assertEquals(customerRecipientOk({ id: 'c1' }), false)
})

Deno.test('เบอร์: รูปแบบที่เอกสารเกตเวย์รับ แปลงเป็น 0… ได้', () => {
  assertEquals(normalizeNumber('0812345678'), '0812345678')
  assertEquals(normalizeNumber('021234567'), '021234567')
  assertEquals(normalizeNumber('0066812345678'), '0812345678')
  assertEquals(normalizeNumber('66812345678'), '0812345678')
  assertEquals(normalizeNumber('+66 81 234 5678'), '0812345678')
})

Deno.test('เบอร์: รูปแบบที่ไม่ถูกต้องไม่ผ่าน', () => {
  assertEquals(normalizeNumber('12345'), null)
  assertEquals(normalizeNumber(''), null)
  assertEquals(normalizeNumber(null), null)
})

Deno.test('คีย์กันส่งซ้ำ: 8–64 ตัว และใช้ได้เฉพาะ A-Z a-z 0-9 _ -', () => {
  assertEquals(IDEM.test('ob' + 'a'.repeat(32)), true)
  assertEquals(IDEM.test('sms-test-abc-12345678'), true)
  assertEquals(IDEM.test('short'), false)
  assertEquals(IDEM.test('a'.repeat(65)), false)
  assertEquals(IDEM.test('has.dot-and-long'), false)
  assertEquals(IDEM.test('has:colon-and-long'), false)
})

Deno.test('รหัสงาน (id) ของ lookup: ตัวเลขหรือตัวอักษรที่อนุญาต', () => {
  assertEquals(ID.test('7'), true)
  assertEquals(ID.test('../etc'), false)
})

Deno.test('ข้อผิดพลาดของเกตเวย์: ส่งต่อ 400/404/409/429 และสถานะอื่นเป็น 502', () => {
  assertEquals(mapGatewayStatus(400), 400)
  assertEquals(mapGatewayStatus(404), 404)
  assertEquals(mapGatewayStatus(409), 409)
  assertEquals(mapGatewayStatus(429), 429)
  assertEquals(mapGatewayStatus(401), 502)
  assertEquals(mapGatewayStatus(403), 502)
  assertEquals(mapGatewayStatus(500), 502)
  assertEquals(mapGatewayStatus(0), 502)
})

Deno.test('รหัสข้อผิดพลาดทุกตัวในเอกสารมีข้อความไทย (ไม่ตกไปที่ข้อความทั่วไป)', () => {
  const codes = [
    'invalid_json', 'empty_body', 'invalid_to', 'invalid_message', 'message_too_long', 'missing_idempotency_key',
    'invalid_idempotency_key', 'invalid_sim', 'invalid_id', 'invalid_kind', 'invalid_path', 'invalid_days',
    'invalid_direction', 'chunked_not_supported', 'body_too_large', 'unauthorized', 'forbidden', 'ip_not_allowed',
    'insufficient_scope', 'not_found', 'idempotency_key_reused', 'message_still_pending', 'rate_limited',
    'daily_limit_reached', 'internal_error',
  ]
  for (const code of codes) assertEquals(gatewayErrorText(400, code).startsWith('เกตเวย์ตอบ'), false, code)
})

Deno.test('เพดานความยาวฝั่งเรา 350 ตัวอักษร (5 ฉบับภาษาไทย)', () => {
  assertEquals(MAX_TEXT, 350)
})
