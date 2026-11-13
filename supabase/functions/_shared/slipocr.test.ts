// ทดสอบการอ่านยอด/วัน-เวลาจากภาพสลิป (ไม่เรียก API จริง ใช้ fetch จำลอง)
import { assertEquals, assert } from 'jsr:@std/assert@1'
import { OCR_DEFAULT_MODEL, parseSlipFields, readSlipFields, readSlipFieldsRemote, readSlipFieldsWorkersAI, WAI_DEFAULT_MODEL } from './slipocr.ts'

const NOW = Date.UTC(2026, 10, 11, 3, 0, 0) // 11-11-2026 10:00 เวลาไทย
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x10, 0x00, 0x10, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xd9])

Deno.test('parseSlipFields: ยอดและวัน-เวลาถูกต้อง → ค่าครบ', () => {
  assertEquals(parseSlipFields('{"amount": 178, "datetime": "2026-11-11T14:48"}', NOW), { amount: 178, paidAt: '2026-11-11T14:48', receiverName: null, receiverAccount: null })
})

Deno.test('parseSlipFields: ยอดเป็นข้อความที่มีคอมมา และข้อความรอบ JSON → อ่านได้', () => {
  assertEquals(parseSlipFields('ผลการอ่าน: {"amount": "1,250.5", "datetime": "2026-11-11 09:05"} ตามนี้', NOW), { amount: 1250.5, paidAt: '2026-11-11T09:05', receiverName: null, receiverAccount: null })
})

Deno.test('parseSlipFields: ค่าผิดรูปแบบทิ้งเป็น null ทีละฟิลด์', () => {
  assertEquals(parseSlipFields('{"amount": -5, "datetime": "2026-13-40T10:00"}', NOW), { amount: null, paidAt: null, receiverName: null, receiverAccount: null })
  assertEquals(parseSlipFields('{"amount": 99999999, "datetime": "2026-11-11T25:00"}', NOW), { amount: null, paidAt: null, receiverName: null, receiverAccount: null })
  assertEquals(parseSlipFields('{"amount": 50, "datetime": null}', NOW), { amount: 50, paidAt: null, receiverName: null, receiverAccount: null })
  assertEquals(parseSlipFields('ขออภัย อ่านไม่ได้', NOW), { amount: null, paidAt: null, receiverName: null, receiverAccount: null })
  assertEquals(parseSlipFields('{ไม่ใช่ json}', NOW), { amount: null, paidAt: null, receiverName: null, receiverAccount: null })
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
  assertEquals(r, { amount: 30, paidAt: '2026-11-11T10:00', receiverName: null, receiverAccount: null })
  assertEquals(body.output_config.format.type, 'json_schema')
  assert(body.max_tokens >= 1000)
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

Deno.test('parseSlipFields: ชื่อผู้รับโอนและเลขที่บัญชีผู้รับโอน', () => {
  const r = parseSlipFields('{"amount": 320, "datetime": "2026-11-11T14:48", "receiver_name": " นาย ตัวอย่าง\\n ใจดี ", "receiver_account": "xxx-x-x1234-x"}', NOW)
  assertEquals(r, { amount: 320, paidAt: '2026-11-11T14:48', receiverName: 'นาย ตัวอย่าง ใจดี', receiverAccount: 'xxx-x-x1234-x' })
  // เลขบัญชีที่ไม่มีตัวเลขพอ / ไม่ใช่ข้อความ → null
  assertEquals(parseSlipFields('{"amount": 1, "datetime": null, "receiver_name": 5, "receiver_account": "xx-x"}', NOW), { amount: 1, paidAt: null, receiverName: null, receiverAccount: null })
})

Deno.test('readSlipFields: รุ่นที่ไม่รองรับ structured outputs (400) → ลองใหม่แบบไม่ส่ง output_config', async () => {
  const bodies: any[] = []
  const fetchImpl = (async (_url: string, init: any) => {
    const b = JSON.parse(init.body)
    bodies.push(b)
    if (b.output_config) return new Response('{"error":"x"}', { status: 400 })
    return new Response(JSON.stringify({ content: [{ type: 'text', text: '{"amount": 30, "datetime": null, "receiver_name": "ร้านเค้ก", "receiver_account": "123-4-56789-0"}' }] }), { status: 200 })
  }) as unknown as typeof fetch
  const r = await readSlipFields({ bytes: JPG, key: 'k', model: 'claude-old', nowMs: NOW, fetchImpl })
  assertEquals(r, { amount: 30, paidAt: null, receiverName: 'ร้านเค้ก', receiverAccount: '123-4-56789-0' })
  assertEquals(bodies.length, 2)
  assertEquals(bodies[1].output_config, undefined)
})

Deno.test('readSlipFieldsRemote: ส่งโทเคนและรูป แล้วอ่านผลที่ตรวจชนิดข้อมูลแล้ว', async () => {
  let seen: any = null
  const fetchImpl = (async (url: string, init: any) => {
    seen = { url, auth: init.headers.authorization, type: init.headers['content-type'] }
    return new Response(JSON.stringify({ amount: 178, paidAt: '2026-11-11T20:24', receiverName: 'ร้านตัวอย่าง', receiverAccount: 'KB000001234567', review: [] }), { status: 200 })
  }) as unknown as typeof fetch
  const r = await readSlipFieldsRemote({ bytes: JPG, url: 'https://ocr.example/', token: 't1', fetchImpl })
  assertEquals(r, { amount: 178, paidAt: '2026-11-11T20:24', receiverName: 'ร้านตัวอย่าง', receiverAccount: 'KB000001234567' })
  assertEquals(seen, { url: 'https://ocr.example/', auth: 'Bearer t1', type: 'image/jpeg' })
})

Deno.test('readSlipFieldsRemote: ค่าผิดชนิดถูกทิ้ง · ไม่มี url/โทเคน หรือเซิร์ฟเวอร์ล้มเหลว → null', async () => {
  const bad = (async () => new Response(JSON.stringify({ amount: '178', paidAt: 'yesterday', receiverName: 5 }), { status: 200 })) as unknown as typeof fetch
  assertEquals(await readSlipFieldsRemote({ bytes: JPG, url: 'https://x/', token: 't', fetchImpl: bad }), { amount: null, paidAt: null, receiverName: null, receiverAccount: null })
  assertEquals(await readSlipFieldsRemote({ bytes: JPG, url: '', token: 't', fetchImpl: bad }), null)
  const down = (async () => new Response('x', { status: 503 })) as unknown as typeof fetch
  assertEquals(await readSlipFieldsRemote({ bytes: JPG, url: 'https://x/', token: 't', fetchImpl: down }), null)
})

Deno.test('readSlipFieldsWorkersAI: แปลงข้อความวันที่ที่โมเดลคัดลอก และอ่านยอดได้ (จำลองการเรียก)', async () => {
  let body: any = null
  let url = ''
  const fetchImpl = (async (u: string, init: any) => {
    url = u
    body = JSON.parse(init.body)
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"amount": 650, "date_text": "2 พ.ย. 69 13:17 น."}' } }] }), { status: 200 })
  }) as unknown as typeof fetch
  const r = await readSlipFieldsWorkersAI({ bytes: JPG, accountId: 'acc1', token: 't1', nowMs: Date.UTC(2026, 10, 13), fetchImpl })
  assertEquals(r, { amount: 650, paidAt: '2026-11-02T13:17', receiverName: null, receiverAccount: null })
  assertEquals(url, 'https://api.cloudflare.com/client/v4/accounts/acc1/ai/v1/chat/completions')
  assertEquals(body.model, WAI_DEFAULT_MODEL)
  assertEquals(body.messages[0].content[0].image_url.url.startsWith('data:image/jpeg;base64,'), true)
})

Deno.test('readSlipFieldsWorkersAI: ไม่มีค่า/ตอบผิดสถานะ/ยอดผิดรูปแบบ → null หรือค่าว่างที่ปลอดภัย', async () => {
  const down = (async () => new Response('x', { status: 403 })) as unknown as typeof fetch
  assertEquals(await readSlipFieldsWorkersAI({ bytes: JPG, accountId: 'a', token: 't', fetchImpl: down }), null)
  assertEquals(await readSlipFieldsWorkersAI({ bytes: JPG, accountId: '', token: 't', fetchImpl: down }), null)
  const bad = (async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"amount": "ไม่รู้", "date_text": null}' } }] }), { status: 200 })) as unknown as typeof fetch
  assertEquals(await readSlipFieldsWorkersAI({ bytes: JPG, accountId: 'a', token: 't', fetchImpl: bad }), { amount: null, paidAt: null, receiverName: null, receiverAccount: null })
})
