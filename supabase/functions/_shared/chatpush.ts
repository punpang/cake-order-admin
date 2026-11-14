// แจ้งลูกค้าเมื่อพนักงานตอบกลับในแชท (เว็บ/แอป): ฟังก์ชันล้วน
// เงื่อนไข: ข้อความท้ายกระทู้ต้องเป็นของพนักงาน และเพิ่งส่ง (ไม่เกิน 10 นาที) · ข้อความเก่า (เช่น ตอนซิงก์กระทู้เดิม) ไม่แจ้ง
export const CHAT_PUSH_MAX_AGE_MS = 10 * 60e3
const FUTURE_SKEW_MS = 60e3 // นาฬิกาเครื่องพนักงานอาจเร็วกว่าเซิร์ฟเวอร์เล็กน้อย

// คืนรหัสและเวลาของข้อความท้ายสุดเมื่อผ่านเงื่อนไข · ไม่ผ่าน = null
export function staffReplyOf(messages: unknown, nowMs: number): { id: string; at: string } | null {
  if (!Array.isArray(messages) || !messages.length) return null
  const last = messages[messages.length - 1] as Record<string, unknown> | null
  if (!last || last.from !== 'staff') return null
  const at = String(last.at ?? '')
  const t = new Date(at).getTime()
  if (!Number.isFinite(t)) return null
  const age = nowMs - t
  if (age > CHAT_PUSH_MAX_AGE_MS || age < -FUTURE_SKEW_MS) return null
  return { id: String(last.id ?? ''), at }
}
