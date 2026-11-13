// รับแจ้งเตือนการโอนจากแอปส่งต่อ (SMS Gateway) → จับคู่กับ QR หน้าร้าน (POS) · ฟังก์ชันล้วน ไม่เรียกภายนอก
// ลายเซ็น: X-Gateway-Signature = "sha256=" + HMAC-SHA256(secret, `${ts}.${body}`) เป็นเลขฐานสิบหกตัวพิมพ์เล็ก
// ยอดเงินอ่านจากข้อความ "คุณได้รับเงิน 1.00 บาท จาก ..." เท่านั้น (รูปแบบเดียวที่มีตัวอย่าง) · ข้อความรูปแบบอื่นข้ามไป

const enc = new TextEncoder()
const hexOf = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')

export function safeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

// ตรวจลายเซ็นกับ body ดิบทุกไบต์ และตรวจ timestamp ไม่เกิน 5 นาที (วินาที unix)
export async function verifyGatewaySignature(secret: string, ts: string, body: string, sigHeader: string, nowSec: number): Promise<boolean> {
  if (!secret || secret.length < 16 || !/^\d+$/.test(ts)) return false
  if (Math.abs(nowSec - Number(ts)) > 300) return false
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = hexOf(await crypto.subtle.sign('HMAC', key, enc.encode(`${ts}.${body}`)))
  return safeEq(sigHeader, `sha256=${mac}`)
}

// ยอดเงินรับเข้า: ต้องขึ้นต้นด้วย "คุณได้รับเงิน" และตามด้วยจำนวน "บาท" · คืน null ถ้าไม่ใช่รูปแบบนี้
export function parseManeeAmount(text: string): number | null {
  const m = /คุณได้รับเงิน\s*([\d,]+(?:\.\d{1,2})?)\s*บาท/.exec(String(text ?? ''))
  if (!m) return null
  const n = Number(m[1].replace(/,/g, ''))
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null
}

// แอปแม่มณี: ตรงชื่อ (แสดงในเครื่อง) หรือ package ที่ตั้งไว้ใน MANEE_APP_IDS (คั่นด้วยจุลภาค)
export function isManeeApp(app: string, appName: string, extraIds = ''): boolean {
  const ids = extraIds.split(',').map((s) => s.trim()).filter(Boolean)
  if (ids.includes(app)) return true
  return /แม่มณี/.test(appName) || /แม่มณี/.test(app)
}

export type ManeeTransfer = { id: string; amount: number; receivedAtMs: number }
export type QrWindow = { amount: number; createdAtMs: number; expiresAtMs: number }

// รายการโอนที่ตรงกับ QR: ยอดเท่ากัน และเวลารับแจ้งเตือนอยู่หลังเวลาสร้าง QR และไม่เกินเวลาหมดอายุ
// คืนทุกรายการที่ตรง (พนักงานเลือกเอง) เรียงจากใกล้เวลาสร้าง QR ที่สุด
export function matchTransfers(transfers: ManeeTransfer[], qr: QrWindow): ManeeTransfer[] {
  return transfers
    .filter((t) => Math.abs(t.amount - qr.amount) < 0.005 && t.receivedAtMs > qr.createdAtMs && t.receivedAtMs <= qr.expiresAtMs)
    .sort((a, b) => a.receivedAtMs - b.receivedAtMs)
}
