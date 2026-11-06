// กติกา OTP / PIN ของระบบลูกค้า (ฟังก์ชันล้วน ไม่แตะ db)
// หมายเหตุ: ตอนนี้จำลองในเบราว์เซอร์ ของจริงต้องทำฝั่งเซิร์ฟเวอร์ทั้งหมด (ดู docs/customer-auth.md)

export const OTP = {
  length: 6,
  ttlMs: 5 * 60e3, // รหัสหมดอายุ 5 นาที
  resendMs: 60e3, // ขอรหัสใหม่ได้ทุก 60 วินาที
  maxTries: 5, // กรอกผิดครบนี้ต้องขอรหัสใหม่
  verifiedMs: 10 * 60e3, // หลังยืนยันแล้ว มีเวลาทำขั้นถัดไป (ตั้ง PIN ฯลฯ)
}
export const PIN = { length: 6, maxFails: 5, lockMs: 15 * 60e3 }

// วัตถุประสงค์ของ OTP
export const OTP_PURPOSE = {
  register: 'สมัครสมาชิก',
  reset: 'ลืม PIN',
  change_pin: 'เปลี่ยน PIN',
  change_phone: 'เปลี่ยนเบอร์โทร',
  delete: 'ขอลบข้อมูล',
}

export const isPin = (s) => /^\d{6}$/.test(String(s ?? ''))
export const isOtpCode = (s) => /^\d{6}$/.test(String(s ?? ''))

// PIN ง่ายเกินไป: คืนเหตุผล ('' = ใช้ได้)
export function weakPin(pin, phone = '') {
  const p = String(pin ?? '')
  if (!isPin(p)) return 'PIN ต้องเป็นตัวเลข 6 หลัก'
  if (/^(\d)\1{5}$/.test(p)) return 'PIN ห้ามเป็นเลขซ้ำกันทั้งหมด'
  if ('0123456789'.includes(p) || '9876543210'.includes(p)) return 'PIN ห้ามเป็นเลขเรียงกัน'
  if (/^(\d\d)\1\1$/.test(p) || /^(\d\d\d)\1$/.test(p)) return 'PIN ห้ามเป็นรูปแบบซ้ำ'
  const d = String(phone ?? '').replace(/\D/g, '')
  if (d.length >= 6 && p === d.slice(-6)) return 'PIN ห้ามตรงกับเลขท้ายเบอร์โทร'
  return ''
}

const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
export function randomHex(bytes = 16) {
  const a = new Uint8Array(bytes)
  globalThis.crypto.getRandomValues(a)
  return toHex(a)
}
// จำลอง: SHA-256(salt:pin) · ของจริงใช้ argon2id/bcrypt ฝั่งเซิร์ฟเวอร์ + จำกัดจำนวนครั้งที่ลอง
export async function hashPin(pin, salt) {
  const data = new TextEncoder().encode(`${salt}:${pin}`)
  return toHex(await globalThis.crypto.subtle.digest('SHA-256', data))
}
export function safeEqual(a, b) {
  const x = String(a)
  const y = String(b)
  if (x.length !== y.length) return false
  let r = 0
  for (let i = 0; i < x.length; i++) r |= x.charCodeAt(i) ^ y.charCodeAt(i)
  return r === 0
}
export function genOtp() {
  const a = new Uint32Array(1)
  globalThis.crypto.getRandomValues(a)
  return String(a[0] % 1e6).padStart(OTP.length, '0')
}
