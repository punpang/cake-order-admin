// เรียก RPC ของระดับสมาชิกฝั่งพนักงาน/ผู้จัดการ (migration 20261122110200) ผ่าน pointsHook · ไม่มีตัวเรียก (โหมดจำลอง) = ค่าปิด
import { pointsHook } from '../data/store'

// ป้ายระดับของลูกค้าที่ POS (ไม่มียอดสะสม) · โหมดปิด/ไม่มีสิทธิ์/ผิดพลาด = enabled false
export async function staffCardRemote(customerId) {
  if (!pointsHook.call || !customerId) return { enabled: false }
  const r = await pointsHook.call('punpang_member_staff_card', { p_customer: customerId }, { customer: customerId })
  return r?.error ? { enabled: false } : r
}

// ตัวอย่างตัวคูณของบิลก่อนชำระ · applied = true เฉพาะโหมดใช้จริง · ผิดพลาด = ตัวคูณ 1
export async function quoteRemote(customerId, base, vatRate) {
  if (!pointsHook.call || !customerId) return { applied: false, mult: 1 }
  const r = await pointsHook.call('punpang_member_quote', { p_customer: customerId, p_base: base, p_vat_rate: vatRate }, { customer: customerId })
  return r?.error ? { applied: false, mult: 1, error: r.error } : r
}

// รายงานโหมดทดลอง/ใช้จริง (ผู้จัดการเท่านั้น) · redeem = สัดส่วนแต้มที่ลูกค้าแลกจริง (0–1)
export async function reportRemote(days = 30, redeem = 0.4) {
  if (!pointsHook.call) return { error: 'offline' }
  return pointsHook.call('punpang_member_report', { p_days: days, p_redeem: redeem }, {})
}
