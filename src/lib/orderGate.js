// ด่านตรวจออร์เดอร์เสี่ยงก่อนยืนยันชำระ/ส่งมอบ (รอบ 2026-11-15 · ตัวเลือก B)
// ตรงกับ supabase/migrations/20261115110000_punpang_order_gate.sql: ออร์เดอร์ตรง (ไม่ใช่บิลหน้าร้าน) ที่ผลตรวจล่าสุดมีรายการ high
// และยังไม่มีผู้จัดการตรวจหลังผลตรวจนั้น → เปลี่ยนเป็นยืนยันชำระ/ส่งมอบไม่ได้ · ไฟล์นี้เป็นตรรกะบริสุทธิ์ (ไม่เรียกเครือข่าย)
export const GATED_STATUSES = ['payment_confirmed', 'delivered']
export const GATE_MESSAGE = 'ออร์เดอร์นี้มีรายการเสี่ยง ต้องให้ผู้จัดการตรวจก่อนยืนยันชำระหรือส่งมอบ'

// state = ค่าที่ RPC punpang_order_gate คืน: null | { hold, checkedAt, flags, reviewedAt }
// reviewedAt มีค่าเฉพาะเมื่อผู้จัดการตรวจหลังผลตรวจล่าสุด (ฐานข้อมูลคำนวณให้แล้ว)
export function gateOf(state) {
  const hold = !!state?.hold
  const reviewed = !!state?.reviewedAt
  return {
    hold,
    reviewed,
    blocked: hold && !reviewed,
    checkedAt: state?.checkedAt ?? null,
    flags: (Array.isArray(state?.flags) ? state.flags : []).filter((f) => f && f.severity !== 'info'),
  }
}

// จะเปลี่ยนไปสถานะ next แล้วถูกบล็อกไหม · บิลหน้าร้านไม่เข้าด่าน · สถานะเดิมเท่ากันไม่ถือเป็นการเปลี่ยน
export function gateBlocks(order, next, gate) {
  if (!gate?.blocked || !order) return false
  if (order.channel === 'pos') return false
  if (!GATED_STATUSES.includes(next)) return false
  return order.status !== next
}
