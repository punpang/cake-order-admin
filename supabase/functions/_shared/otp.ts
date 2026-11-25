// โมดูล OTP กลาง (ใช้ร่วมกับ preorder) · เฉพาะส่วนที่ไม่ผูกกับตารางบัญชี · พฤติกรรมเดิมทุกอย่าง
const enc = new TextEncoder()
export const MIN = 60000
// perAllHour: เพดานรวมทั้งระบบต่อชั่วโมง (กันถูกยิงขอ OTP ถึงเบอร์คนอื่นเพื่อเผาโควตา SMS แม้ปลอม IP ได้)
export const OTP = { ttlMs: 5 * MIN, resendMs: MIN, maxTries: 5, verifiedMs: 10 * MIN, perPhoneHour: 5, perIpHour: 20, perAllHour: 120 }
export const hex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b as ArrayBuffer)].map((x) => x.toString(16).padStart(2, '0')).join('')
export const sha256Hex = async (s: string) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)))
export const randHex = (n = 16) => hex(crypto.getRandomValues(new Uint8Array(n)))
// เบอร์มือถือไทย → { local: 0XXXXXXXXX, e164: +66XXXXXXXXX }
export function thaiPhone(raw: unknown) {
  const d = String(raw ?? '').replace(/[\s-]/g, '')
  const m = /^(?:\+66|66|0)([689]\d{8})$/.exec(d)
  return m ? { local: `0${m[1]}`, e164: `+66${m[1]}` } : null
}

