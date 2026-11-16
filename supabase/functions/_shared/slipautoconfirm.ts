// ยืนยันสลิปอัตโนมัติ: ฟังก์ชันล้วน (ไม่แตะฐานข้อมูล) ใช้ร่วมกันทั้งสลิปในแชท (slipjob) และสลิปจากหน้าออร์เดอร์ (customer-order)
// เงื่อนไข (ครบทั้ง 4 ข้อเป็น ✓ · อ่านจากภาพสลิปแล้วเทียบกับออร์เดอร์และรายการแจ้งชำระ):
//   1) จำนวนไม่เกินยอดคงค้าง  2) วัน-เวลาโอนมากกว่าเวลาสร้างออร์เดอร์ (ถึงนาที)
//   3) รหัสอ้างอิงร้านค้า (Ref 1 = POS/ORD) ตรงกับรหัสออร์เดอร์  4) รหัสสุ่ม (Ref 2) ตรงกับรายการแจ้งชำระของออร์เดอร์นั้น และยอดเท่ากับรายการนั้น
//   5) เลขบัญชีผู้รับบนสลิปตรงกับบัญชีของร้าน (ไม่ตรง/อ่านไม่ได้ = ไม่ยืนยันอัตโนมัติ · พนักงานยังผูกออเดอร์เองได้)
// รหัสร้านค้าแสดงให้พนักงานดูเท่านั้น ไม่นับเป็นเงื่อนไข
// และเปิดไว้ (config slipQr.autoConfirm) · นัดรับห่างจากวันนี้ (ตามปฏิทินเวลาไทย) อย่างน้อยตามจำนวนวันที่ร้านตั้ง
import { slipChecksOf } from './schedlib/slipChecks.js'
import { daysUntilPickup } from './slip.ts'

// สวิตช์ยืนยันชำระอัตโนมัติจาก "รูปสลิปที่ลูกค้าส่ง" (หน้าออร์เดอร์และแชท) · ปิดถาวรตามการตัดสินใจ (2026-11-16)
// ปิด = รูปสลิปไม่ยืนยันชำระเอง รอพนักงาน · การยืนยันจากแจ้งเตือนรับเงินของแอพถุงเงิน (tungngern-receiver → notifyconfirm.ts) ไม่ใช้สวิตช์นี้ ยังทำงานตาม config/slipQr.autoConfirm
// เปิดใหม่ได้ก็ต่อเมื่อมีการตรวจยอดกับธนาคาร/ผู้ให้บริการตรวจสลิปแล้ว และเจ้าของอนุมัติ
export const IMAGE_AUTO_CONFIRM = false

export type SlipCheck = { key: string; ok: boolean | null; text: string; info?: boolean }

// เลขบัญชีของร้านที่ตั้งไว้ (บัญชีธนาคารใช้เลขบัญชี · พร้อมเพย์ใช้เลขที่ตั้งไว้) จาก config/shop
export function configuredAccountsOf(shop: any): string[] {
  const list = Array.isArray(shop?.payment?.accounts) ? shop.payment.accounts : []
  return list.map((a: any) => String((a?.kind === 'bank' ? a?.accountNo : a?.promptpayId) ?? '')).filter((s: string) => /\d/.test(s))
}

// เลขบัญชีผู้รับบนสลิป (OCR อาจปิดบางหลักด้วย x/X/*) ต้องตรงกับบัญชีของร้านทุกหลักที่เห็น · ไม่มีค่า หรือไม่มีบัญชีที่ตั้งไว้ = ไม่ผ่าน
export function accountMatches(read: unknown, configured: string[]): boolean {
  const r = String(read ?? '').replace(/[^0-9xX*]/g, '')
  if (!/\d/.test(r)) return false
  return configured.some((c) => {
    const d = String(c ?? '').replace(/\D/g, '')
    if (d.length !== r.length) return false
    for (let i = 0; i < d.length; i++) {
      if (/[xX*]/.test(r[i])) continue
      if (r[i] !== d[i]) return false
    }
    return true
  })
}

export function accountCheckOf(read: unknown, configured: string[]): SlipCheck {
  const ok = accountMatches(read, configured)
  const text = ok ? 'เลขบัญชีผู้รับตรงกับบัญชีของร้าน'
    : !configured.length ? 'ยังไม่ได้ตั้งบัญชีของร้าน'
    : /\d/.test(String(read ?? '')) ? 'เลขบัญชีผู้รับไม่ตรงกับบัญชีของร้าน'
    : 'อ่านเลขบัญชีผู้รับจากสลิปไม่ได้'
  return { key: 'account', ok, text }
}

export function autoConfirmDecision(input: {
  enabled: boolean
  days: number
  fields: any
  order: { code: string; createdAt?: unknown; pickupAt?: unknown }
  configuredMerchantCode: string
  // เลขบัญชีของร้าน (ข้อ 5): เลขบัญชีผู้รับบนสลิปต้องตรง · ไม่ตรง/อ่านไม่ได้ = ไม่ยืนยันอัตโนมัติ
  configuredAccounts?: string[]
  balance: number
  nowMs: number
  // รายการแจ้งชำระที่รหัสสุ่ม (Ref 2) ตรงกับสลิป · ไม่พบ = null (ข้อ 4 ไม่ผ่าน)
  request?: { qrRef?: string; amount?: number } | null
}): { ok: boolean; daysLeft: number | null; checks: SlipCheck[] } {
  const checks = slipChecksOf({
    fields: input.fields,
    order: { code: input.order.code, createdAt: input.order.createdAt as string | null },
    configuredMerchantCode: input.configuredMerchantCode,
    balance: input.balance,
    request: input.request ?? null,
  }) as SlipCheck[]
  checks.push(accountCheckOf(input.fields?.receiverAccount, input.configuredAccounts ?? []))
  const daysLeft = daysUntilPickup(input.order.pickupAt, input.nowMs)
  const ok = input.enabled && checks.filter((c) => !c.info).every((c) => c.ok === true) && daysLeft !== null && daysLeft >= input.days
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
