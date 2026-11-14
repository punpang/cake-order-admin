// ทดสอบรูปที่ลูกค้าแนบในแชท: ชนิดรูป ขนาด สิทธิ์ของโฟลเดอร์ จำนวนต่อข้อความ และกำหนดลบ
import { assertEquals } from 'jsr:@std/assert@1'
import { CHAT_PHOTO_DAYS, CHAT_PHOTO_MAX_BYTES, decodePhotoDataUrl, isExpiredAt, photoKeyOwned, photoRefsOf, sniffPhoto } from './chatphoto.ts'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10])
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])
const toUrl = (b: Uint8Array, mime: string) => `data:${mime};base64,${btoa(String.fromCharCode(...b))}`

Deno.test('ชนิดรูปจากลายเซ็นต้นไฟล์: PNG / JPEG / WEBP ผ่าน · ไฟล์อื่นไม่ผ่าน', () => {
  assertEquals(sniffPhoto(PNG)?.type, 'image/png')
  assertEquals(sniffPhoto(JPG)?.type, 'image/jpeg')
  assertEquals(sniffPhoto(WEBP)?.type, 'image/webp')
  assertEquals(sniffPhoto(new TextEncoder().encode('hello world')), null)
})

Deno.test('ถอดรหัสรูป: รูปถูกต้องผ่าน · รูปแบบผิด/ไม่ใช่รูป/ใหญ่เกินไปไม่ผ่าน', () => {
  assertEquals('error' in decodePhotoDataUrl(toUrl(PNG, 'image/png')), false)
  assertEquals('error' in decodePhotoDataUrl('text/plain;base64,AAAA'), true)
  assertEquals('error' in decodePhotoDataUrl(toUrl(new TextEncoder().encode('hello world'), 'image/png')), true)
  const big = `data:image/png;base64,${'A'.repeat(Math.ceil(((CHAT_PHOTO_MAX_BYTES + 100) * 4) / 3))}`
  assertEquals('error' in decodePhotoDataUrl(big), true)
})

Deno.test('คีย์รูปต้องอยู่ในโฟลเดอร์ของลูกค้าคนนั้นเท่านั้น', () => {
  assertEquals(photoKeyOwned('webchat/c1/a.jpg', 'c1'), true)
  assertEquals(photoKeyOwned('webchat/c2/a.jpg', 'c1'), false)
  assertEquals(photoKeyOwned('staff/c1/a.jpg', 'c1'), false)
  assertEquals(photoKeyOwned('webchat/c1/../c2/a.jpg', 'c1'), false)
})

Deno.test('รายการรูปในข้อความ: ไม่แนบเลย = ผ่าน · เกิน 5 รูป / รูปของคนอื่น = ไม่ผ่าน · ซ้ำกันตัดทิ้ง', () => {
  assertEquals(photoRefsOf(undefined, 'c1'), { refs: [] })
  const ok = ['r2://private/webchat/c1/a.jpg', 'r2://private/webchat/c1/a.jpg', 'r2://private/webchat/c1/b.png']
  assertEquals(photoRefsOf(ok, 'c1'), { refs: ['r2://private/webchat/c1/a.jpg', 'r2://private/webchat/c1/b.png'] })
  assertEquals('error' in photoRefsOf(Array(6).fill('r2://private/webchat/c1/a.jpg'), 'c1'), true)
  assertEquals('error' in photoRefsOf(['r2://private/webchat/c2/a.jpg'], 'c1'), true)
  assertEquals('error' in photoRefsOf('ไม่ใช่รายการ', 'c1'), true)
})

Deno.test('กำหนดลบ: เกิน 90 วันลบได้ · ยังไม่ครบไม่ลบ · เวลาอ่านไม่ได้ถือว่าลบ', () => {
  const now = Date.parse('2026-11-14T10:00:00Z')
  const daysAgo = (d: number) => new Date(now - d * 86400e3).toISOString()
  assertEquals(CHAT_PHOTO_DAYS, 90)
  assertEquals(isExpiredAt(daysAgo(91), now), true)
  assertEquals(isExpiredAt(daysAgo(89), now), false)
  assertEquals(isExpiredAt('ไม่ใช่วันที่', now), true)
})
