// ข้อมูลการ์ดสมาชิกฝั่งลูกค้า (ฟังก์ชันล้วน) · หลอดแสดงวันที่เหลือของสิทธิระดับ และความคืบหน้ายอดสะสมไประดับถัดไป
import { tierLines } from './memberLevels.js'
import { formatPhone } from './format.js'

// ช่วงสิทธิระดับเต็ม (วัน) ใช้เป็นตัวหารของหลอด · ตรงกับค่า downgradeDays เริ่มต้น
export const VALIDITY_WINDOW_DAYS = 365
const DAY = 86400000

// สัดส่วนวันที่เหลือของสิทธิระดับ 0–100 · ไม่มีสิทธิที่ active หรือไม่มีวันที่ = 0
export function validityPct(tier, today = new Date()) {
  if (!tier?.enabled || tier.status !== 'active') return 0
  const end = tier.downgradeAt || tier.activeUntil
  if (!end) return 0
  const endMs = new Date(`${end}T23:59:59+07:00`).getTime()
  if (Number.isNaN(endMs)) return 0
  const left = Math.ceil((endMs - today.getTime()) / DAY)
  return Math.max(0, Math.min(100, Math.round((left / VALIDITY_WINDOW_DAYS) * 100)))
}

// ความคืบหน้ายอดสะสมไประดับถัดไป: สัดส่วน 0–100 และยอดที่ยังขาด (บาท, ปัดขึ้น)
// ระดับสูงสุด (ไม่มี nextMin) → top = true และไม่มียอดขาด
export function progressToNext(tier) {
  const cum = Math.max(0, Number(tier?.cum) || 0)
  const next = Number(tier?.nextMin)
  if (!tier?.enabled || !Number.isFinite(next) || next <= 0) return { top: true, pct: 100, remaining: 0, cum }
  const pct = Math.max(0, Math.min(100, Math.round((cum / next) * 100)))
  const remaining = Math.max(0, Math.ceil(next - cum))
  return { top: false, pct, remaining, cum }
}

// ค่าที่การ์ดด้านหน้าต้องแสดง: เบอร์ที่จัดรูป คะแนนที่มี ชื่อระดับ หลอดวันหมดสิทธิ และความคืบหน้าไประดับถัดไป
export function memberCardView(me, tier, today = new Date()) {
  const points = Math.max(0, Math.floor(Number(me?.points) || 0))
  const hasTier = !!tier?.enabled && !!tier?.levelName
  const progress = hasTier ? progressToNext(tier) : { top: true, pct: 0, remaining: 0, cum: 0 }
  return {
    phone: formatPhone(me?.phone || ''),
    points,
    levelName: hasTier ? tier.levelName : null,
    line: hasTier ? (tierLines(tier)[0] || '') : '',
    validPct: hasTier ? validityPct(tier, today) : 0,
    progress: { ...progress, nextName: tier?.nextName || null },
  }
}
