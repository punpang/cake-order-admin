// ทดสอบการอ่านยอด/วัน-เวลาจากภาพสลิป (ไม่เรียก API จริง ใช้ fetch จำลอง)
import { assertEquals, assert } from 'jsr:@std/assert@1'
import { OCR_DEFAULT_MODEL, parseSlipFields, readSlipFields } from './slipocr.ts'

const NOW = Date.UTC(2026, 10, 11, 3, 0, 0) // 11-11-2026 10:00 เวลาไทย
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x10, 0x00, 0x10, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xd9])

Deno.test('parseSlipFields: ยอดและวัน-เวลาถูกต้อง → ค่าครบ', () => {
  assertEquals(parseSlipFields('{"amount": 178, "datetime": "2026-11-11T14:48"}', NOW), { amount: 178, paidAt: '2026-11-11T14:48' })
})

Deno.test('parseSlipFields: ยอดเป็นข้อความที่มีคอมมา และข้อความรอบ JSON → อ่านได้', () => {
  assertEquals(parseSlipFields('ผลการอ่าน: {"amount": "1,250.5", "datetime": "2026-11-11 09:05"} ตามนี้', NOW), { amount: 1250.5, paidAt: '2026-11-11T09:05' })
})

Deno.test('parseSlipFields: ค่าผิดรูปแบบทิ้งเป็น null ทีละฟิลด์', () => {
  assertEquals(parseSlipFields('{"amount": -5, "datetime": "2026-13-40T10:00"}', NOW), { amount: null, paidAt: null })
  assertEquals(parseSlipFields('{"amount": 99999999, "datetime": "2026-11-11T25:00"}', NOW), { amount: null, paidAt: null })
  assertEquals(parseSlipFields('{"amount": 50, "datetime": null}', NOW), { amount: 50, paidAt: null })
  assertEquals(parseSlipFields('ขออภัย อ่านไม่ได้', NOW), { amount: null, paidAt: null })
  assertEquals(parseSlipFields('{ไม่ใช่ json}', NOW), { amount: null, paidAt: null })
})

Deno.test('parseSlipFields: ปีผิดชัดเจน (ไม่อยู่ในช่วง ±) → ไม่รับวัน', () => {
  assertEquals(parseSlipFields('{"amount": 10, "datetime": "2019-01-01T10:00"}', NOW).paidAt, null)
  assertEquals(parseSlipFields('{"amount": 10, "datetime": "2030-01-01T10:00"}', NOW).paidAt, null)
})

Deno.test('readSlipFields: ส่งรูปเป็น base64 ไปยัง Messages API ด้วยรุ่นที่ตั้งไว้ และอ่านคำตอบ', async () => {
  let body: any = null
  let headers: any = null
  const fetchImpl = (async (_url: string, init: any) => {
    body = JSON.parse(init.body)
    headers = init.headers
    return new Response(JSON.stringify({ content: [{ type: 'text', text: '{"amount": 30, "datetime": "2026-11-11T10:00"}' }] }), { status: 200 })
  }) as unknown as typeof fetch
  const r = await readSlipFields({ bytes: JPG, key: 'k-test', model: 'claude-test-model', nowMs: NOW, fetchImpl })
  assertEquals(r, { amount: 30, paidAt: '2026-11-11T10:00' })
  assertEquals(body.model, 'claude-test-model')
  assertEquals(headers['x-api-key'], 'k-test')
  const img = body.messages[0].content[0]
  assertEquals(img.type, 'image')
  assertEquals(img.source.media_type, 'image/jpeg')
  assertEquals(atob(img.source.data).length, JPG.length)
})

Deno.test('readSlipFields: ไม่มีคีย์ → ไม่เรียก API และคืน null', async () => {
  let called = false
  const fetchImpl = (async () => { called = true; return new Response('{}') }) as unknown as typeof fetch
  assertEquals(await readSlipFields({ bytes: JPG, key: '', model: '', fetchImpl }), null)
  assertEquals(called, false)
})

Deno.test('readSlipFields: API ตอบผิดสถานะ/ล้มเหลว → null (ไม่ทำให้งานสลิปพัง)', async () => {
  const bad = (async () => new Response('{"error":"x"}', { status: 500 })) as unknown as typeof fetch
  const boom = (async () => { throw new Error('network') }) as unknown as typeof fetch
  assertEquals(await readSlipFields({ bytes: JPG, key: 'k', model: '', fetchImpl: bad }), null)
  assertEquals(await readSlipFields({ bytes: JPG, key: 'k', model: '', fetchImpl: boom }), null)
})

Deno.test('ค่าเริ่มต้นของรุ่นที่ใช้อ่านสลิปถูกกำหนดไว้', () => {
  assert(OCR_DEFAULT_MODEL.startsWith('claude-'))
})
