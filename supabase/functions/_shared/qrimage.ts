// อ่าน QR จากรูป JPEG / PNG (ใช้ใน Edge Function บน Deno) · ถอดรหัสภาพด้วย jpeg-js / pngjs แล้วหา QR ด้วย jsQR (ล้วน JS ไม่มี native)
// ไม่รองรับ WebP/GIF: ข้ามไป (ไม่ใช่ข้อผิดพลาด) · รูปที่ใหญ่เกิน MAX_QR_PIXELS ไม่ถอดรหัส เพื่อจำกัดหน่วยความจำและเวลา CPU
import jpeg from 'npm:jpeg-js@0.4.4'
import { PNG } from 'npm:pngjs@7.0.0'
import * as jsqrModule from 'npm:jsqr@1.4.0'
import { Buffer } from 'node:buffer'

export const MAX_QR_PIXELS = 8_000_000

// jsQR เป็นโมดูล CJS: ตัวฟังก์ชันอยู่ที่ default (ตรวจทั้งสองแบบเพื่อความทนทาน)
type JsQr = (data: Uint8ClampedArray, width: number, height: number, opts?: { inversionAttempts?: 'dontInvert' | 'onlyInvert' | 'attemptBoth' | 'invertFirst' }) => { data: string } | null
const jsQR: JsQr = ((jsqrModule as any).default ?? jsqrModule) as JsQr

// อ่านชนิดและขนาดจาก header อย่างเดียว (ไม่ถอดรหัสทั้งภาพ)
export function imageSize(b: Uint8Array): { type: 'png' | 'jpeg'; w: number; h: number } | null {
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
    return { type: 'png', w: dv.getUint32(16), h: dv.getUint32(20) }
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue }
      const marker = b[i + 1]
      if (marker === 0xff) { i++; continue }
      // SOF0..SOF15 ยกเว้น DHT (C4) JPG (C8) DAC (CC) คือเฟรมที่มีขนาดภาพ
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { type: 'jpeg', h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8] }
      }
      // เครื่องหมายที่ไม่มีความยาว: SOI, EOI, TEM, RST0-7
      if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue }
      i += 2 + ((b[i + 2] << 8) | b[i + 3])
    }
    return null
  }
  return null
}

// คืนข้อความของ QR ที่พบในรูป (อย่างมากหนึ่งรายการต่อรูป) · รูปที่อ่านไม่ได้คืน []
export async function readQrTexts(bytes: Uint8Array): Promise<string[]> {
  const size = imageSize(bytes)
  if (!size || size.w < 16 || size.h < 16 || size.w * size.h > MAX_QR_PIXELS) return []
  try {
    const img = size.type === 'png'
      ? PNG.sync.read(Buffer.from(bytes))
      : jpeg.decode(bytes, { useTArray: true, maxResolutionInMP: 9, maxMemoryUsageInMB: 256, formatAsRGBA: true })
    const rgba = new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.data.length)
    const hit = jsQR(rgba, img.width, img.height, { inversionAttempts: 'attemptBoth' })
    return hit ? [hit.data] : []
  } catch {
    return []
  }
}
