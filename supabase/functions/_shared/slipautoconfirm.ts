// ยืนยันสลิปอัตโนมัติ: ฟังก์ชันล้วน (ไม่แตะฐานข้อมูล) ใช้ร่วมกันทั้งสลิปในแชท (slipjob) และสลิปจากหน้าออร์เดอร์ (customer-order)
// เงื่อนไข (ครบทั้ง 4 ข้อเป็น ✓ · อ่านจากภาพสลิปแล้วเทียบกับออร์เดอร์):
//   1) จำนวนไม่เกินยอดคงค้าง  2) วัน-เวลาโอนมากกว่าเวลาสร้างออร์เดอร์ (ถึงนาที)
//   3) รหัสร้านค้า (Ref 1) ตรงกับที่ตั้งไว้ (ยังไม่ตั้ง = ไม่ผ่าน)  4) รหัสอ้างอิงร้านค้า (Ref 2 = POS/ORD) ตรงกับรหัสออร์เดอร์
// และเปิดไว้ (config slipQr.autoConfirm) · นัดรับห่างจากวันนี้ (ตามปฏิทินเวลาไทย) อย่างน้อยตามจำนวนวันที่ร้านตั้ง
import { slipChecksOf } from './schedlib/slipChecks.js'
import { daysUntilPickup } from './slip.ts'

export type SlipCheck = { key: string; ok: boolean | null; text: string }

export function autoConfirmDecision(input: {
  enabled: boolean
  days: number
  fields: any
  order: { code: string; createdAt?: unknown; pickupAt?: unknown }
  configuredMerchantCode: string
  balance: number
  nowMs: number
}): { ok: boolean; daysLeft: number | null; checks: SlipCheck[] } {
  const checks = slipChecksOf({
    fields: input.fields,
    order: { code: input.order.code, createdAt: input.order.createdAt as string | null },
    configuredMerchantCode: input.configuredMerchantCode,
    balance: input.balance,
  }) as SlipCheck[]
  const daysLeft = daysUntilPickup(input.order.pickupAt, input.nowMs)
  const ok = input.enabled && checks.every((c) => c.ok === true) && daysLeft !== null && daysLeft >= input.days
  return { ok, daysLeft, checks }
}

// ยืนยันงวดนี้อัตโนมัติ และยกเลิกยอดที่ร้านแจ้งเดิมที่ยังรออยู่ของออร์เดอร์ (ยอดที่ลูกค้าแจ้งเองไม่แตะ · งวดนี้ไม่ถูกยกเลิก)
export function confirmSlipPayment(payments: any[], paymentId: string, nowIso: string): { payments: any[]; cancelled: any[] } {
  const list: any[] = Array.isArray(payments) ? payments : []
  const stale = (p: any) => p?.status === 'reported' && p?.customerSubmitted !== true && p?.id !== paymentId
  const cancelled = list.filter(stale)
  const next = list.map((p: any) => {
    if (p?.id === paymentId) return { ...p, status: 'confirmed', confirmedBy: 'auto', confirmedAt: nowIso }
    if (stale(p)) return { ...p, status: 'cancelled', cancelledAt: nowIso, cancelledBy: 'auto' }
    return p
  })
  return { payments: next, cancelled }
}
