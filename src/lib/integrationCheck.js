// ตรวจค่าที่ผู้ใช้กรอกตอนเชื่อม Telegram (จำลอง) · ฟังก์ชันล้วน
export const TELEGRAM_TOKEN = /^\d{6,}:[A-Za-z0-9_-]{30,}$/
export function checkTelegram(token, chatId) {
  if (!TELEGRAM_TOKEN.test(String(token ?? '').trim())) return { error: 'รูปแบบ bot token ไม่ถูกต้อง (ตัวอย่าง 123456789:AAxxxxxxxx…)' }
  const c = String(chatId ?? '').trim()
  if (!/^-?\d{5,}$/.test(c) && !/^@[A-Za-z][A-Za-z0-9_]{4,}$/.test(c)) return { error: 'chat id ต้องเป็นตัวเลข (กลุ่มขึ้นต้นด้วย -) หรือ @ชื่อช่อง' }
  return { ok: true, token: String(token).trim(), chatId: c }
}
