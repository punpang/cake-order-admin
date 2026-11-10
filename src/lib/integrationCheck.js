// ตรวจค่าที่ผู้ใช้กรอกตอนเชื่อม Telegram / SMS (จำลอง) · ฟังก์ชันล้วน
export const TELEGRAM_TOKEN = /^\d{6,}:[A-Za-z0-9_-]{30,}$/
export function checkTelegram(token, chatId) {
  if (!TELEGRAM_TOKEN.test(String(token ?? '').trim())) return { error: 'รูปแบบ bot token ไม่ถูกต้อง (ตัวอย่าง 123456789:AAxxxxxxxx…)' }
  const c = String(chatId ?? '').trim()
  if (!/^-?\d{5,}$/.test(c) && !/^@[A-Za-z][A-Za-z0-9_]{4,}$/.test(c)) return { error: 'chat id ต้องเป็นตัวเลข (กลุ่มขึ้นต้นด้วย -) หรือ @ชื่อช่อง' }
  return { ok: true, token: String(token).trim(), chatId: c }
}
const PRIVATE_HOST = /^(localhost|.*\.local|.*\.internal|.*\.localhost)$/i
// ไม่รับ IP ตรง ๆ ทั้ง IPv4/IPv6 (รับเฉพาะชื่อโดเมน)
const isIp = (h) => /^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(':') || h.startsWith('[')
// URL ของผู้ให้บริการ SMS: https เท่านั้น · ชื่อโดเมนจริง (ไม่รับ IP/localhost/ภายใน กัน SSRF ตอนเซิร์ฟเวอร์เรียกจริง) · ห้ามมี user:pass
export function checkSmsUrl(raw) {
  const t = String(raw ?? '').trim()
  if (!t) return { error: 'ใส่ URL ของผู้ให้บริการ SMS' }
  if (t.length > 500) return { error: 'URL ยาวเกินไป' }
  let u
  try { u = new URL(t) } catch { return { error: 'รูปแบบ URL ไม่ถูกต้อง' } }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { error: 'URL ต้องขึ้นต้นด้วย http:// หรือ https://' }
  if (u.username || u.password) return { error: 'URL ห้ามมีชื่อผู้ใช้/รหัสผ่าน (ใส่ที่ช่องคีย์)' }
  const h = u.hostname.toLowerCase()
  if (PRIVATE_HOST.test(h) || !h.includes('.') || isIp(h)) return { error: 'ต้องเป็นชื่อโดเมนของผู้ให้บริการ (ไม่รับ IP / localhost / ที่อยู่ภายใน)' }
  return { ok: true, url: u.href, host: h }
}
export function checkSmsSender(s) {
  const t = String(s ?? '').trim()
  return /^[A-Za-z0-9._-]{3,11}$/.test(t) ? { ok: true, sender: t } : { error: 'ชื่อผู้ส่งใช้ได้ A-Z a-z 0-9 . _ - ยาว 3–11 ตัว' }
}
