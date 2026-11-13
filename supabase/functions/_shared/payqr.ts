// รหัสสุ่มไม่ซ้ำของรายการแจ้งชำระ (Ref 2 ของ QR พร้อมเพย์แบบ Biller) · อักษรชุดเดียวกับฝั่งแอป (src/lib/promptpay.js)
const QR_REF_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const QR_REF_LIMIT = Math.floor(256 / QR_REF_CHARS.length) * QR_REF_CHARS.length // สุ่มแบบไม่เอนเอียง (ทิ้งค่าที่เกิน)
const QR_REF_RE = new RegExp(`^[${QR_REF_CHARS}]{12}$`)

export function newQrRef(): string {
  let out = ''
  while (out.length < 12) {
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    for (const b of bytes) if (b < QR_REF_LIMIT && out.length < 12) out += QR_REF_CHARS[b % QR_REF_CHARS.length]
  }
  return out
}

export const qrRefOk = (v: unknown): boolean => QR_REF_RE.test(String(v ?? ''))
