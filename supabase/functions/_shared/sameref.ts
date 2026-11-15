// รายการเดียวต่อรหัสสุ่ม (Ref 2): แจ้งเตือนถุงเงินกับสลิปที่มี Ref 2 เดียวกันต้องเก็บไว้ที่รายการเดียวกัน ไม่ว่าอันไหนมาก่อน
// ฟังก์ชันล้วน (ไม่แตะฐานข้อมูล) ใช้ร่วมกันทั้งแจ้งเตือนถุงเงิน (notifyconfirm) สลิปในแชท (slipjob) และสลิปจากหน้าออร์เดอร์ (customer-order)

// หารายการของรหัสสุ่มนี้ (ไม่นับที่ยกเลิก) · มีหลายรายการ → ยึดรายการรอตรวจก่อน แล้วค่อยรายการที่ยืนยันแล้ว
export function sameRefPayment(payments: unknown, qrRef: unknown): any | null {
  const code = String(qrRef ?? '')
  if (!code) return null
  const list: any[] = (Array.isArray(payments) ? payments : []).filter((p: any) => p?.qrRef === code && p?.status !== 'cancelled')
  return list.find((p: any) => p.status === 'reported') ?? list.find((p: any) => p.status === 'confirmed') ?? null
}

// เก็บข้อมูลสลิปไว้ที่รายการที่ยืนยันแล้ว (ยังไม่มีสลิป) · ไม่เปลี่ยนสถานะ ยอด หรือรายการอื่น · วัน-เวลาชำระเดิมไม่ถูกทับ
// คืน null เมื่อรายการนั้นไม่ใช่ "ยืนยันแล้วและยังไม่มีสลิป" (ผู้เรียกต้องไม่เขียนข้อมูลต่อ)
export function mergeSlipIntoConfirmed(payments: unknown, paymentId: string, patch: Record<string, unknown>, nowIso: string): any[] | null {
  const list: any[] = Array.isArray(payments) ? payments : []
  const target = list.find((p: any) => p?.id === paymentId)
  if (!target || target.status !== 'confirmed' || target.slip) return null
  return list.map((p: any) => {
    if (p?.id !== paymentId) return p
    const clean = Object.fromEntries(Object.entries(patch).filter(([k, v]) => v !== undefined && !(k === 'paidAt' && p.paidAt)))
    return { ...p, ...clean, slipMergedAt: nowIso }
  })
}
