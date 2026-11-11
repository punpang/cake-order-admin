// ทดสอบการอ่าน QR ที่ลูกค้าแนบ: สลิปโอนเงิน / QR พร้อมเพย์ / ไม่มี QR (รูปจริงที่สร้างด้วย qrcode)
import { assertEquals } from 'jsr:@std/assert@1'
import QRCode from 'npm:qrcode@1.5.4'
import { PNG } from 'npm:pngjs@7.0.0'
import { readSlipQr } from './slipread.ts'

const SLIP_KBANK = '0037000600000101030040216A1B2C3D4E5F6G7H85102TH9104DE9E'
const PROMPTPAY_540 = '00020101021229370016A000000677010111011300668123456785802TH53037645406540.0063048A50'

const qrPng = async (text: string): Promise<Uint8Array> => new Uint8Array(await QRCode.toBuffer(text, { type: 'png', errorCorrectionLevel: 'M', margin: 4, scale: 4 }))

Deno.test('สลิปธนาคารในรูป → slip พร้อมรหัสธนาคารต้นทางและเลขอ้างอิง', async () => {
  assertEquals(await readSlipQr(await qrPng(SLIP_KBANK)), { kind: 'slip', bankCode: '004', ref: 'A1B2C3D4E5F6G7H8' })
})

Deno.test('QR พร้อมเพย์ (ไม่ใช่สลิป) → promptpay', async () => {
  assertEquals(await readSlipQr(await qrPng(PROMPTPAY_540)), { kind: 'promptpay' })
})

Deno.test('รูปไม่มี QR → none', async () => {
  const blank = new PNG({ width: 200, height: 200 })
  blank.data.fill(255)
  assertEquals(await readSlipQr(new Uint8Array(PNG.sync.write(blank))), { kind: 'none' })
})

Deno.test('ไฟล์ที่ไม่ใช่รูป → none (ไม่โยนข้อผิดพลาด)', async () => {
  assertEquals(await readSlipQr(new TextEncoder().encode('ไม่ใช่รูปภาพ')), { kind: 'none' })
})
