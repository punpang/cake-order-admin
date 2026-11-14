// รูปที่ลูกค้าแนบในแชทเว็บ/แอป: ตรวจชนิดและขนาด · เก็บใต้โฟลเดอร์ของลูกค้า · ทะเบียนใน punpang_kv (collection chatPhoto) เพื่อลบเมื่อครบกำหนด
import { isR2Ref, keyOfR2Ref } from './filesvc.ts'

export const CHAT_PHOTO_MAX_BYTES = 2 * 1024 * 1024
export const CHAT_PHOTO_MAX_PER_MESSAGE = 5
export const CHAT_PHOTO_DAYS = 90
export const CHAT_PHOTO_KV = 'chatPhoto'
export const CHAT_PHOTO_UPLOAD_MAX = 30 // รูปที่อัปโหลดได้ต่อลูกค้าใน 10 นาที (กันการยิงรัว)

export const photoPrefixOf = (customerId: string) => `webchat/${customerId}`

// ชนิดรูปจากลายเซ็นต้นไฟล์ (PNG / JPEG / WEBP) · ไม่ใช่รูปที่รองรับ = null
export function sniffPhoto(b: Uint8Array): { type: string; ext: string } | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { type: 'image/png', ext: 'png' }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { type: 'image/jpeg', ext: 'jpg' }
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return { type: 'image/webp', ext: 'webp' }
  return null
}

// data URL (base64) → bytes · ตรวจรูปแบบ ขนาดก่อนถอดรหัส และชนิดรูปจริง
export function decodePhotoDataUrl(s: unknown): { bytes: Uint8Array; type: string; ext: string } | { error: string } {
  const m = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(s ?? ''))
  if (!m) return { error: 'แนบรูปได้เฉพาะ PNG / JPG / WEBP' }
  if (Math.floor((m[2].length * 3) / 4) > CHAT_PHOTO_MAX_BYTES + 4) return { error: 'รูปใหญ่เกินไป (ไม่เกิน 2 MB)' }
  let bytes: Uint8Array
  try { bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0)) } catch { return { error: 'ไฟล์รูปไม่ถูกต้อง' } }
  if (bytes.length > CHAT_PHOTO_MAX_BYTES) return { error: 'รูปใหญ่เกินไป (ไม่เกิน 2 MB)' }
  const kind = sniffPhoto(bytes)
  if (!kind) return { error: 'ไฟล์ไม่ใช่รูปภาพที่รองรับ (PNG / JPG / WEBP)' }
  return { bytes, type: kind.type, ext: kind.ext }
}

// คีย์ที่ต้องอยู่ในโฟลเดอร์ของลูกค้าคนนั้นเท่านั้น (กันการแนบไฟล์ของลูกค้าอื่น หรือไฟล์ของพนักงาน)
export function photoKeyOwned(key: string, customerId: string): boolean {
  return key.startsWith(`${photoPrefixOf(customerId)}/`) && /^[A-Za-z0-9/_.-]+$/.test(key) && !key.includes('..')
}

// ลิงก์รูปในข้อความ (r2://private/<key>) → คีย์ · ไม่ใช่รูปของระบบนี้ = null
export function photoKeyOf(ref: unknown): string | null {
  if (!isR2Ref(ref)) return null
  const k = keyOfR2Ref(ref)
  return k || null
}

// รายการรูปที่ลูกค้าแนบมาตอนส่งข้อความ: ไม่เกินจำนวนที่กำหนด และต้องเป็นของลูกค้าคนนี้
export function photoRefsOf(raw: unknown, customerId: string): { refs: string[] } | { error: string } {
  if (raw == null) return { refs: [] }
  if (!Array.isArray(raw)) return { error: 'รูปที่แนบไม่ถูกต้อง' }
  if (raw.length > CHAT_PHOTO_MAX_PER_MESSAGE) return { error: `แนบรูปได้ไม่เกิน ${CHAT_PHOTO_MAX_PER_MESSAGE} รูปต่อข้อความ` }
  const refs: string[] = []
  for (const r of raw) {
    const key = photoKeyOf(r)
    if (!key || !photoKeyOwned(key, customerId)) return { error: 'รูปที่แนบไม่ถูกต้อง กรุณาแนบใหม่' }
    if (!refs.includes(String(r))) refs.push(String(r))
  }
  return { refs }
}

// อายุของรายการ (ISO) เกินกำหนดหรือไม่ · เวลาอ่านไม่ได้ถือว่าเกินกำหนด (ลบได้ปลอดภัยกว่า)
export function isExpiredAt(at: unknown, nowMs: number, days = CHAT_PHOTO_DAYS): boolean {
  const t = new Date(String(at ?? '')).getTime()
  if (!Number.isFinite(t)) return true
  return nowMs - t > days * 86400e3
}
