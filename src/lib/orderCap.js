// จำกัดจำนวนออเดอร์ต่อวัน (นับตามวันที่นัดรับ/จัดส่ง) · 0 = ไม่จำกัด
// ไม่นับออเดอร์ที่ยกเลิกและร่าง (ยังไม่ส่งจริง)
import { toDateStr } from './format.js'

const NOT_COUNTED = ['cancelled', 'draft']

// วันที่ของออเดอร์ (YYYY-MM-DD ตามเวลาเครื่อง) · ค่าเสีย → ''
export const capDayKey = (iso) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : toDateStr(d)
}

// จำนวนออเดอร์ที่นัดรับ/ส่งในวันนั้น
export function ordersOnDay(orders, dayKey) {
  if (!dayKey) return 0
  return (orders || []).filter((o) => o && !NOT_COUNTED.includes(o.status) && capDayKey(o.pickupAt) === dayKey).length
}

// สถานะความจุของวัน: capped = มีการจำกัด · full = ครบแล้ว · left = เหลือรับได้กี่ออเดอร์
export function capState(cap, count) {
  const c = Math.max(0, Math.round(Number(cap) || 0))
  if (!c) return { capped: false, full: false, left: Infinity }
  const left = Math.max(0, c - (Number(count) || 0))
  return { capped: true, full: left === 0, left }
}

export const capFullMsg = (cap) => `วันนี้รับออเดอร์เต็มแล้ว (ครบ ${cap} ออเดอร์) กรุณาเลือกวันอื่นค่ะ`
