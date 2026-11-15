// ตัวช่วยของ Edge Function sms-send (แยกไว้เพื่อทดสอบได้) · ตามเอกสาร SMS Gateway API: docs/sms-gateway-api.md (อัปเดต 2026-11-15)

// เพดานความยาวฝั่งเรา (เกตเวย์เป็นผู้ตัดสินจริง): เกตเวย์รับ 1–5 ฉบับ (ค่าเริ่มต้น 5 ตั้งได้ในแอปเกตเวย์) ภาษาไทยฉบับละประมาณ 70 ตัว → 350 ตัว
// เอกสารเกตเวย์กำหนดเพดานรวม 1,000 ตัวอักษร และภาษาอังกฤษฉบับละประมาณ 160 ตัว
export const MAX_TEXT = 350

// คีย์กันส่งซ้ำ: 8–64 ตัว ใช้ได้เฉพาะ A-Z a-z 0-9 _ -
export const IDEM = /^[A-Za-z0-9_-]{8,64}$/
// รหัสงาน (id) ของเกตเวย์
export const ID = /^[A-Za-z0-9_-]{1,64}$/

// เบอร์: รับ 0xxxxxxxxx(x) · 66xxxxxxxxx · 0066xxxxxxxxx · +66 (ตัดช่องว่าง/ขีดออกก่อน) แล้วส่งเป็น 0… ให้เกตเวย์
export function normalizeNumber(s: unknown): string | null {
  let d = String(s ?? '').replace(/\D/g, '')
  if (/^0066\d{8,9}$/.test(d)) d = '0' + d.slice(4)
  else if (/^66\d{8,9}$/.test(d)) d = '0' + d.slice(2)
  return /^0\d{8,9}$/.test(d) ? d : null
}

// สถานะที่เกตเวย์ตอบ: 400/404/409/429 ส่งต่อให้ผู้เรียกแก้ได้ · อื่น ๆ (401/403/5xx/เชื่อมต่อไม่ได้) เป็นการตั้งค่าหรือเกตเวย์ → 502
export function mapGatewayStatus(gatewayStatus: number): number {
  return [400, 404, 409, 429].includes(gatewayStatus) ? gatewayStatus : 502
}

// แปลงรหัสข้อผิดพลาดของเกตเวย์ (ตารางข้อผิดพลาดในเอกสาร) เป็นข้อความไทย
export function gatewayErrorText(status: number, code: string): string {
  const C: Record<string, string> = {
    invalid_json: 'เกตเวย์อ่านคำขอไม่ได้',
    empty_body: 'คำขอว่างเปล่า',
    invalid_to: 'เบอร์ปลายทางไม่ถูกต้องตามที่เกตเวย์รับ',
    invalid_message: 'ข้อความไม่ถูกต้อง (ว่าง หรือยาวเกิน 1,000 ตัวอักษร)',
    message_too_long: 'ข้อความยาวเกินที่เกตเวย์รับ (ดูจำนวนฉบับสูงสุดที่ตั้งไว้ในแอปเกตเวย์)',
    missing_idempotency_key: 'ไม่มีคีย์กันส่งซ้ำ',
    invalid_idempotency_key: 'คีย์กันส่งซ้ำไม่ถูกรูปแบบ (8–64 ตัว A-Z a-z 0-9 _ -)',
    invalid_sim: 'เลขซิมไม่ถูกต้อง (ใช้ 1 หรือ 2)',
    invalid_id: 'รหัสงานไม่ถูกต้อง',
    invalid_kind: 'ประเภทคำขอไม่ถูกต้อง',
    invalid_path: 'เส้นทางคำขอไม่ถูกต้อง',
    invalid_days: 'จำนวนวันเก็บข้อความไม่ถูกต้อง (ใช้ 7, 30 หรือ 90)',
    invalid_direction: 'ทิศทางข้อความไม่ถูกต้อง (all, in หรือ out)',
    chunked_not_supported: 'เกตเวย์ไม่รับการส่งแบบ chunked',
    body_too_large: 'คำขอใหญ่เกินที่เกตเวย์รับ',
    unauthorized: 'key ของเกตเวย์ไม่ถูกต้อง',
    ip_not_allowed: 'IP นี้ไม่อยู่ในรายการที่เกตเวย์อนุญาตสำหรับ key นี้',
    insufficient_scope: 'key ของเกตเวย์ไม่มีสิทธิ์ทำรายการนี้',
    forbidden: 'เกตเวย์ปฏิเสธการเชื่อมต่อ (ไม่ได้อยู่ใน LAN ของเกตเวย์)',
    not_found: 'ไม่พบรายการ หรือไม่มี endpoint นี้',
    idempotency_key_reused: 'คีย์ส่งซ้ำกับข้อความอื่นที่ไม่ตรงกัน',
    message_still_pending: 'ข้อความยังรอส่งอยู่ ลบไม่ได้',
    rate_limited: 'เรียกเกตเวย์ถี่เกินไป (เกิน 30 ครั้งต่อนาที) ลองใหม่อีกครั้ง',
    daily_limit_reached: 'ถึงโควตาการส่งต่อวันของเกตเวย์แล้ว',
    internal_error: 'เกตเวย์เกิดข้อผิดพลาดภายใน',
  }
  if (code && C[code]) return C[code]
  if (status === 401) return 'key ของเกตเวย์ไม่ถูกต้อง'
  if (status === 403) return 'เกตเวย์ปฏิเสธการเชื่อมต่อ'
  if (status === 404) return 'ไม่พบรายการ หรือไม่มี endpoint นี้ (ตรวจลิงก์)'
  if (status === 409) return 'เกตเวย์ตอบขัดแย้ง ลองใหม่ภายหลัง'
  if (status === 413) return 'คำขอใหญ่เกินที่เกตเวย์รับ'
  if (status === 429) return 'เรียกเกตเวย์ถี่เกินไป ลองใหม่อีกครั้ง'
  return `เกตเวย์ตอบ ${status}`
}
