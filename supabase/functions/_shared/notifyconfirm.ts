// แจ้งเตือนรับเงินจากถุงเงิน → จับคู่งวดชำระของออร์เดอร์ (ฟังก์ชันล้วน + เขียนออร์เดอร์แบบเทียบ updated_at)
// เงื่อนไขจับคู่: รหัสสุ่ม (Ref2 = qrRef) ตรงกับรายการที่ยังไม่ยืนยัน (ลูกค้าแนบสลิปแล้วหรือยังก็ได้) และยอดในแจ้งเตือนเท่ากับยอดของรายการนั้น
// รหัสเดียวกันเก็บไว้รายการเดียว (sameref.ts) → สลิปมาก่อนหรือหลังแจ้งเตือนถุงเงินก็จับเข้ารายการเดิม
// ยืนยันอัตโนมัติ: เปิดไว้ และวันนัดรับห่างจากเวลาที่รับเงินอย่างน้อยตามจำนวนวันที่ตั้ง (ครบจำนวนวัน = ผ่าน)
// นัดรับใกล้กว่านั้น → ทำเครื่องหมาย "ผ่านการตรวจสอบแล้ว" และให้พนักงานกดยืนยันเอง
import { confirmSlipPayment } from './slipautoconfirm.ts'
import { daysUntilPickup } from './slip.ts'
import { sameRefPayment } from './sameref.ts'
import { balanceOf } from './schedlib/orderCreate.js'

export type NotifyDecision = { match: boolean; auto: boolean; daysLeft: number | null; reason: string }

const r2 = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100

export function notifyDecision(input: {
  payment: any | null
  amount: number | null
  receivedMs: number
  pickupAt: unknown
  autoOn: boolean
  days: number
}): NotifyDecision {
  const p = input.payment
  if (!p) return { match: false, auto: false, daysLeft: null, reason: 'ไม่พบรายการชำระที่รอตรวจของรหัสนี้' }
  if (p.status !== 'reported') return { match: false, auto: false, daysLeft: null, reason: 'รายการนี้ยืนยันหรือยกเลิกไปแล้ว' }
  if (input.amount == null || r2(input.amount) !== r2(p.amount)) return { match: false, auto: false, daysLeft: null, reason: 'ยอดในแจ้งเตือนไม่ตรงกับยอดรายการ' }
  const daysLeft = daysUntilPickup(input.pickupAt, input.receivedMs)
  const auto = input.autoOn && daysLeft !== null && daysLeft >= input.days
  if (auto) return { match: true, auto: true, daysLeft, reason: 'ยืนยันอัตโนมัติ' }
  if (!input.autoOn) return { match: true, auto: false, daysLeft, reason: 'ปิดการยืนยันอัตโนมัติไว้' }
  if (daysLeft === null) return { match: true, auto: false, daysLeft, reason: 'ไม่มีวันนัดรับ' }
  return { match: true, auto: false, daysLeft, reason: `นัดรับใกล้กว่า ${input.days} วัน` }
}

// ใช้แจ้งเตือนถุงเงิน 1 รายการกับออร์เดอร์ที่มีงวดรหัสนี้ · ลองเขียนใหม่เมื่อชนกับการแก้ไขอื่น
export async function applyNotifyPayment(sb: any, opts: { ref: string; amount: number | null; receivedMs: number; autoOn: boolean; days: number; nowIso: string }): Promise<{ done: boolean; code?: string; auto?: boolean; reason: string }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await sb.from('punpang_orders').select('id,code,status,fulfillment,data,updated_at').contains('data', { payments: [{ qrRef: opts.ref }] }).limit(2)
    if (r?.error) return { done: false, reason: 'อ่านออร์เดอร์ไม่สำเร็จ' }
    const rows: any[] = r?.data || []
    if (!rows.length) return { done: false, reason: 'ไม่พบออร์เดอร์ของรหัสนี้' }
    if (rows.length > 1) return { done: false, reason: 'รหัสนี้พบมากกว่าหนึ่งออร์เดอร์' }
    const row = rows[0]
    const d = row.data || {}
    const payments: any[] = Array.isArray(d.payments) ? d.payments : []
    const p = sameRefPayment(payments, opts.ref)
    const dec = notifyDecision({ payment: p, amount: opts.amount, receivedMs: opts.receivedMs, pickupAt: d.pickupAt, autoOn: opts.autoOn, days: opts.days })
    if (!dec.match) return { done: true, code: row.code, reason: dec.reason }
    let list: any[] = payments
    let cancelled: any[] = []
    if (dec.auto) {
      const c = confirmSlipPayment(payments, p.id, opts.nowIso)
      list = c.payments
      cancelled = c.cancelled
    } else {
      list = payments.map((x: any) => (x?.id === p.id ? { ...x, receiptVerified: true, receiptVerifiedAt: opts.nowIso, receiptRef: opts.ref } : x))
    }
    const amountText = r2(opts.amount).toFixed(2)
    const history = [
      ...(Array.isArray(d.history) ? d.history : []),
      { at: opts.nowIso, text: dec.auto ? `รับแจ้งเตือนถุงเงิน ยอด ${amountText} · ยืนยันชำระอัตโนมัติ (นัดรับห่าง ${dec.daysLeft} วัน · ยังไม่ได้ตรวจกับธนาคาร)` : `รับแจ้งเตือนถุงเงิน ยอด ${amountText} · ผ่านการตรวจสอบแล้ว รอพนักงานยืนยัน (${dec.reason})`, by: 'auto' },
      ...(cancelled.length ? [{ at: opts.nowIso, text: `ยกเลิกยอดที่แจ้งเดิม ${cancelled.length} รายการ เพราะยืนยันชำระอัตโนมัติแล้ว`, by: 'auto' }] : []),
    ]
    const next = { ...d, payments: list, history }
    const status = dec.auto
      ? (['awaiting_payment', 'payment_reported'].includes(row.status) ? 'payment_confirmed' : row.status)
      : (row.status === 'awaiting_payment' ? 'payment_reported' : row.status)
    const up = await sb.from('punpang_orders').update({ data: next, status, balance: balanceOf({ ...next, fulfillment: row.fulfillment }) }).eq('id', row.id).eq('updated_at', row.updated_at).select('id')
    if (up?.error) return { done: false, reason: 'บันทึกออร์เดอร์ไม่สำเร็จ' }
    if ((up?.data || []).length) return { done: true, code: row.code, auto: dec.auto, reason: dec.reason }
  }
  return { done: false, reason: 'ออร์เดอร์ถูกแก้พร้อมกันหลายครั้ง' }
}
