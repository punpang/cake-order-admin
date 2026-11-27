// ข้อมูลการ์ดสมาชิกฝั่งลูกค้า (ฟังก์ชันล้วน) · ไม่มียอดสะสม · หลอดแสดงวันที่เหลือของสิทธิระดับเท่านั้น
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

// ค่าที่การ์ดด้านหน้าต้องแสดง: เบอร์ที่จัดรูป คะแนนที่มี ชื่อระดับ และหลอดวันหมดสิทธิ
export function memberCardView(me, tier, today = new Date()) {
  const points = Math.max(0, Math.floor(Number(me?.points) || 0))
  const hasTier = !!tier?.enabled && !!tier?.levelName
  return {
    phone: formatPhone(me?.phone || ''),
    points,
    levelName: hasTier ? tier.levelName : null,
    line: hasTier ? (tierLines(tier)[0] || '') : '',
    validPct: hasTier ? validityPct(tier, today) : 0,
  }
}
