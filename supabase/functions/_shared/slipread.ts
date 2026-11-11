// อ่าน QR ในรูปที่ลูกค้าแนบ (ฝั่งเซิร์ฟเวอร์ ไม่ส่งรูปออกไปที่อื่น) → สลิปโอนเงิน / QR พร้อมเพย์ / ไม่พบ
import { classifyThaiQr } from './slip.ts'
import { readQrTexts } from './qrimage.ts'
import { normalizeRef } from './payfields.ts'

export type QrRead =
  | { kind: 'slip'; bankCode: string; ref: string } // สลิปธนาคารไทย: รหัสธนาคารต้นทาง + เลขอ้างอิง (ตัวพิมพ์ใหญ่)
  | { kind: 'promptpay' } // QR รับเงินของร้าน/พร้อมเพย์ → ไม่ใช่สลิป
  | { kind: 'none' } // ไม่พบ QR ที่อ่านได้

export async function readSlipQr(bytes: Uint8Array): Promise<QrRead> {
  let payment = false
  for (const text of await readQrTexts(bytes)) {
    const c = classifyThaiQr(text)
    if (c.kind === 'slip') return { kind: 'slip', bankCode: c.sendingBank, ref: normalizeRef(c.transRef) }
    if (c.kind === 'payment_qr') payment = true
  }
  return payment ? { kind: 'promptpay' } : { kind: 'none' }
}
