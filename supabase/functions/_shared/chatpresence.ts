// สถานะพิมพ์และอ่านแล้ว · ฟังก์ชันล้วน (ไม่แตะฐานข้อมูล)
// ร้านเป็นผู้เปิดปิด "ลูกค้าเห็นร้าน" เท่านั้น: ร้านกำลังพิมพ์ / ร้านอ่านแล้ว · ร้านเห็นลูกค้าเสมอ (ไม่มีสวิตช์)
// สถานะพิมพ์ถือว่ายังอยู่ภายในช่วงนี้นับจากครั้งล่าสุดที่พิมพ์ (ผู้พิมพ์ส่งทุก ~3 วินาที)

export const TYPING_WINDOW_MS = 6000

export type PresenceRow = {
  staff_typing_at?: string | null
  staff_read_at?: string | null
  customer_typing_at?: string | null
  customer_read_at?: string | null
} | null

// ตั้งค่าจาก config bot.presence · ไม่มีค่า = เปิดทั้งคู่ (ค่าเริ่มต้น)
export type PresenceCfg = { typing?: boolean; read?: boolean } | null | undefined

// มุมมองที่ลูกค้าเห็น: ร้านกำลังพิมพ์ไหม และร้านอ่านถึงเวลาไหน (null = ไม่แสดง)
export function shopPresenceOf(row: PresenceRow, cfg: PresenceCfg, nowMs: number): { shopTyping: boolean; shopReadAt: string | null } {
  const typingOn = cfg?.typing !== false
  const readOn = cfg?.read !== false
  const typingAt = row?.staff_typing_at ? Date.parse(row.staff_typing_at) : NaN
  const shopTyping = typingOn && Number.isFinite(typingAt) && nowMs - typingAt >= -2000 && nowMs - typingAt < TYPING_WINDOW_MS
  const readAt = row?.staff_read_at && Number.isFinite(Date.parse(row.staff_read_at)) ? row.staff_read_at : null
  return { shopTyping, shopReadAt: readOn ? readAt : null }
}
