// ตัวช่วยของ Edge Function line-push (แยกไว้เพื่อทดสอบได้)
// LINE ช่องทางเสริม: ส่งเฉพาะลูกค้าที่ผูก LINE แล้ว (punpang_line_users.customer_id) · SMS ยังเป็นช่องทางหลัก

// ข้อความ LINE ไม่เกิน 5000 ตัวอักษร (ตามเอกสาร Messaging API)
export const LINE_TEXT_MAX = 5000

// ตรวจข้อความแล้วสร้างเพย์โหลดของ push message · ข้อความว่าง/ยาวเกิน → error
export function pushPayload(text: unknown): { ok: true; messages: { type: 'text'; text: string }[] } | { ok: false; error: string } {
  const t = typeof text === 'string' ? text.trim() : ''
  if (!t) return { ok: false, error: 'ไม่มีข้อความที่จะส่ง' }
  if (t.length > LINE_TEXT_MAX) return { ok: false, error: `ข้อความยาวเกิน ${LINE_TEXT_MAX} ตัวอักษร` }
  return { ok: true, messages: [{ type: 'text', text: t }] }
}

// เลือก LINE user ที่ยังติดตามอยู่ (followed = true) ล่าสุด · ไม่มี → null
export function pickFollowedLineUser(rows: unknown): string | null {
  if (!Array.isArray(rows)) return null
  const live = rows
    .filter((r) => r && r.followed === true && typeof r.line_user_id === 'string' && r.line_user_id)
    .sort((a, b) => String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')))
  return live.length ? String(live[0].line_user_id) : null
}

// ระยะเก็บข้อความ LINE (วัน) · ร้านตั้งได้ที่ตั้งค่าร้าน (shop.lineRetentionDays) · ค่าไม่ถูกต้อง/ไม่มี → ค่าเริ่มต้น 180 วัน
export const LINE_RETENTION_DEFAULT = 180
export const LINE_RETENTION_MIN = 7
export const LINE_RETENTION_MAX = 365
export function lineRetentionDays(v: unknown): number {
  const n = Math.round(Number(v))
  return Number.isFinite(n) && n >= LINE_RETENTION_MIN && n <= LINE_RETENTION_MAX ? n : LINE_RETENTION_DEFAULT
}

// เวลาตัดข้อความ: ข้อความที่สร้างก่อนเวลานี้ต้องลบ (ISO 8601 ตามเขตเวลา UTC)
export function retentionCutoffIso(days: number, nowMs: number): string {
  return new Date(nowMs - days * 86400000).toISOString()
}
