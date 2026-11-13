// รหัสสุ่มของรายการแจ้งชำระ: 5 ตัวต่อท้าย POS/ORD ใน Ref 2 (เช่น ORD121126000741ABCDE) · อักษรชุดเดียวกับฝั่งแอป (src/lib/promptpay.js) · ไม่มี 0 1 I L O
export const QR_SUFFIX_LEN = 5
const QR_SUFFIX_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const QR_SUFFIX_LIMIT = Math.floor(256 / QR_SUFFIX_CHARS.length) * QR_SUFFIX_CHARS.length // สุ่มแบบไม่เอนเอียง (ทิ้งค่าที่เกิน)

export function newQrSuffix(): string {
  let out = ''
  while (out.length < QR_SUFFIX_LEN) {
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    for (const b of bytes) if (b < QR_SUFFIX_LIMIT && out.length < QR_SUFFIX_LEN) out += QR_SUFFIX_CHARS[b % QR_SUFFIX_CHARS.length]
  }
  return out
}

// Ref 2 = POS/ORD ตามออร์เดอร์ (ORD + ddmmyy + xxxxxx = 12 หลัก · POS + ddmmyy + xxxxx = 11 หลัก) + รหัสสุ่ม 5 ตัว
export const qrRefOk = (v: unknown): boolean => /^(?:ORD\d{12}|POS\d{11})[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/.test(String(v ?? ''))
