// สถานะพิมพ์และอ่านแล้ว (ใช้ทั้งฝั่งลูกค้าและพนักงาน) · ฟังก์ชันล้วน ไม่แตะเครือข่าย
// ค่าช่วงเวลาต้องตรงกับ supabase/functions/_shared/chatpresence.ts (TYPING_WINDOW_MS)
export const TYPING_WINDOW_MS = 6000 // สถานะพิมพ์แสดงอยู่นานเท่านี้หลังการพิมพ์ครั้งล่าสุด
export const TYPING_PING_MS = 3000 // ผู้พิมพ์ส่งสถานะได้ไม่ถี่กว่านี้
export const PRESENCE_POLL_MS = 3000 // เปิดแชทอยู่ อ่านสถานะของอีกฝั่งทุกช่วงนี้

// เวลาเป็นมิลลิวินาที · ตัดเศษวินาทีที่เกิน 3 หลัก (Postgres ส่งเป็นไมโครวินาที) ให้ Safari อ่านได้ · อ่านไม่ได้ = NaN
export function msOf(v) {
  if (typeof v === 'number') return v
  const n = Date.parse(String(v ?? '').replace(/(\.\d{3})\d+/, '$1'))
  return Number.isFinite(n) ? n : NaN
}

// กำลังพิมพ์อยู่ไหม · atMs = เวลาที่พิมพ์ล่าสุด (NaN = ไม่เคย) · ยอมให้เวลาเครื่องคลาดได้ 2 วินาที
export function isTypingNow(atMs, nowMs) {
  if (!Number.isFinite(atMs)) return false
  const d = nowMs - atMs
  return d >= -2000 && d < TYPING_WINDOW_MS
}

// ถึงเวลาส่งสถานะอีกครั้งหรือยัง
export const pingDue = (lastMs, nowMs, everyMs = TYPING_PING_MS) => nowMs - lastMs >= everyMs

// ข้อความล่าสุดของผู้ส่งที่ระบุ (ไม่มี = null)
export function lastFrom(messages, from) {
  const list = Array.isArray(messages) ? messages : []
  for (let i = list.length - 1; i >= 0; i--) if (list[i]?.from === from) return list[i]
  return null
}

// อีกฝั่งอ่านแล้วหรือยัง: เวลาอ่านล่าสุด (readAt) ไม่ก่อนเวลาของข้อความล่าสุดของผู้ส่ง from → คืน id ของข้อความนั้น · ไม่ครบ = null
export function readReceiptId(messages, from, readAt) {
  const readMs = msOf(readAt)
  const m = lastFrom(messages, from)
  if (!m || !Number.isFinite(readMs)) return null
  const msgMs = msOf(m.at)
  return Number.isFinite(msgMs) && readMs >= msgMs ? m.id : null
}
