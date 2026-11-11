// ทดสอบการอ่าน QR จากรูปจริง (สร้างรูปด้วย qrcode แล้วถอดรหัสด้วยเส้นทางเดียวกับ Edge Function)
import { assertEquals } from 'jsr:@std/assert@1'
import QRCode from 'npm:qrcode@1.5.4'
import jpeg from 'npm:jpeg-js@0.4.4'
import { PNG } from 'npm:pngjs@7.0.0'
import { halveRgba, imageSize, readQrTexts } from './qrimage.ts'
import { classifyThaiQr } from './slip.ts'

// ค่าอ้างอิงที่สร้างจาก @thai-qr-payment/payload (สลิป) และ src/lib/promptpay.js (QR รับเงินของร้าน)
const SLIP_KBANK = '0037000600000101030040216A1B2C3D4E5F6G7H85102TH9104DE9E'
const PROMPTPAY_540 = '00020101021229370016A000000677010111011300668123456785802TH53037645406540.0063048A50'

const qrPng = async (text: string, scale: number): Promise<Uint8Array> => new Uint8Array(await QRCode.toBuffer(text, { type: 'png', errorCorrectionLevel: 'M', margin: 4, scale }))

function pngToJpeg(png: Uint8Array): Uint8Array {
  const img = PNG.sync.read(Buffer.from(png))
  return new Uint8Array(jpeg.encode({ data: img.data, width: img.width, height: img.height }, 92).data)
}

function blankPng(w: number, h: number): Uint8Array {
  const img = new PNG({ width: w, height: h })
  img.data.fill(255)
  return new Uint8Array(PNG.sync.write(img))
}

Deno.test('PNG: ถอด QR สลิปได้ และจำแนกเป็น slip ธนาคาร 004', async () => {
  const texts = await readQrTexts(await qrPng(SLIP_KBANK, 4))
  assertEquals(texts, [SLIP_KBANK])
  assertEquals(classifyThaiQr(texts[0]), { kind: 'slip', sendingBank: '004', transRef: 'A1B2C3D4E5F6G7H8' })
})

Deno.test('PNG ขนาดเล็ก (สลิปที่ QR เล็กในภาพหน้าจอ) ยังอ่านได้', async () => {
  const texts = await readQrTexts(await qrPng(SLIP_KBANK, 2))
  assertEquals(texts, [SLIP_KBANK])
})

Deno.test('JPEG: ถอด QR สลิปได้เหมือน PNG', async () => {
  const jpg = pngToJpeg(await qrPng(SLIP_KBANK, 4))
  assertEquals(imageSize(jpg)?.type, 'jpeg')
  assertEquals(await readQrTexts(jpg), [SLIP_KBANK])
})

Deno.test('QR พร้อมเพย์ของร้าน: อ่านได้แต่จำแนกเป็น payment_qr (ไม่ใช่สลิป)', async () => {
  const texts = await readQrTexts(await qrPng(PROMPTPAY_540, 4))
  assertEquals(texts, [PROMPTPAY_540])
  assertEquals(classifyThaiQr(texts[0]).kind, 'payment_qr')
})

Deno.test('รูปไม่มี QR / ไม่ใช่รูป → []', async () => {
  assertEquals(await readQrTexts(blankPng(120, 120)), [])
  assertEquals(await readQrTexts(new TextEncoder().encode('hello not an image')), [])
  assertEquals(await readQrTexts(new Uint8Array(0)), [])
})

Deno.test('รูปใหญ่เกินเพดานพิกเซล: ไม่ถอดรหัส (ตอบ [] ทันที)', async () => {
  // PNG ที่ header บอกขนาด 4000x4000 (16MP) ไม่ต้องถอดรหัสจริง
  const header = blankPng(16, 16)
  const dv = new DataView(header.buffer)
  dv.setUint32(16, 4000)
  dv.setUint32(20, 4000)
  assertEquals(imageSize(header), { type: 'png', w: 4000, h: 4000 })
  assertEquals(await readQrTexts(header), [])
})

Deno.test('halveRgba: เฉลี่ยบล็อก 2×2 และขนาดลดครึ่งหนึ่ง', () => {
  // ภาพ 4×2 พิกเซล ค่าแดงของพิกเซลที่ i = 4i (0..28) · ค่าอื่นเป็น 0
  const w = 4, h = 2
  const src = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) src[i * 4] = i * 4
  const out = halveRgba(src, w, h)
  assertEquals([out.w, out.h], [2, 1])
  // บล็อกซ้าย (0+4+16+20+2)>>2 = 10 · บล็อกขวา (8+12+24+28+2)>>2 = 18
  assertEquals([out.data[0], out.data[4]], [10, 18])
})
