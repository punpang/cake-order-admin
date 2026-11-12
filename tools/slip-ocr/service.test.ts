import { assertEquals } from 'jsr:@std/assert@1'
import { handle, isImage, sameToken, MAX_BYTES } from './service.ts'

const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46])
const TOKEN = 'secret-token-123'
const ok = async () => ({ amount: 40, paidAt: '2026-11-11T15:49', receiverName: null, receiverAccount: null, review: [] })
const post = (body: BodyInit | null, headers: Record<string, string> = {}) => new Request('http://x/', { method: 'POST', body, headers: { authorization: `Bearer ${TOKEN}`, ...headers } })

Deno.test('ไม่มีโทเคนที่ถูกต้อง → 401 และไม่เรียกการอ่าน', async () => {
  let called = false
  const r = await handle(new Request('http://x/', { method: 'POST', body: JPG }), TOKEN, async () => { called = true; return {} })
  assertEquals(r.status, 401)
  assertEquals(called, false)
})

Deno.test('ปิดบริการเมื่อไม่ได้ตั้งโทเคน → 503', async () => {
  const r = await handle(post(JPG), '', ok)
  assertEquals(r.status, 503)
})

Deno.test('เมธอดอื่นไม่ใช่ POST → 405', async () => {
  const r = await handle(new Request('http://x/', { method: 'GET', headers: { authorization: `Bearer ${TOKEN}` } }), TOKEN, ok)
  assertEquals(r.status, 405)
})

Deno.test('ไฟล์ที่ไม่ใช่ JPEG/PNG → 415 · ขนาดเกินกำหนด → 413', async () => {
  assertEquals((await handle(post(new Uint8Array([1, 2, 3, 4, 5])), TOKEN, ok)).status, 415)
  assertEquals((await handle(post(JPG, { 'content-length': String(MAX_BYTES + 1) }), TOKEN, ok)).status, 413)
})

Deno.test('ส่งรูปถูกต้อง → 200 พร้อมผลอ่าน', async () => {
  const r = await handle(post(JPG), TOKEN, ok)
  assertEquals(r.status, 200)
  assertEquals((await r.json()).amount, 40)
})

Deno.test('การอ่านล้มเหลว → 502 โดยไม่เปิดเผยรายละเอียดภายใน', async () => {
  const r = await handle(post(JPG), TOKEN, async () => { throw new Error('/secret/path') })
  assertEquals(r.status, 502)
  assertEquals((await r.text()).includes('secret'), false)
})

Deno.test('ตรวจรูปแบบไฟล์และเทียบโทเคน', () => {
  assertEquals(isImage(JPG), 'image/jpeg')
  assertEquals(isImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0])), 'image/png')
  assertEquals(isImage(new Uint8Array([0x47, 0x49, 0x46])), null)
  assertEquals(sameToken('Bearer abc', 'Bearer abc'), true)
  assertEquals(sameToken('Bearer abd', 'Bearer abc'), false)
  assertEquals(sameToken('', 'Bearer abc'), false)
})
