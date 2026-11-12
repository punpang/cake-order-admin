// สลิปในแชท (โหมดแมนนวล): กติกาการรับชำระจากสลิปกับออร์เดอร์ · ฟังก์ชันล้วน ไม่แตะ db/Vue (ทดสอบด้วย node src/lib/slipBind.test.mjs)
// ยอดที่ผูกได้ = ยอดคงค้าง − ยอดที่ลูกค้าแจ้งเองและยังรอตรวจ (ตรงกับ planAttach / pendingSumOf ฝั่งเซิร์ฟเวอร์ใน supabase/functions/_shared/slip.ts)
import { PAY_MSG, notBeforeOrder, notFuture, thaiMinute } from './payFields.js'

// หมายเหตุของรายการชำระที่พนักงานรับชำระจากสลิปในแชท (ระบุว่าพนักงานเป็นคนรับ และยังไม่ได้ตรวจยอดกับธนาคาร)
export const SLIP_RECEIVE_NOTE = 'สลิปจากแชท (QR) · พนักงานรับชำระจากสลิป · ยังไม่ได้ตรวจยอดกับธนาคาร (ตรวจยอดในสลิปก่อนยืนยัน)'

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100

// ยอดที่ลูกค้าแจ้งเองและยังรอตรวจอยู่แล้ว (ยอดที่พนักงานแจ้งเอง หรือที่ยืนยัน/ยกเลิกแล้วไม่นับ)
export function pendingCustomerTotal(payments) {
  const list = Array.isArray(payments) ? payments : []
  return r2(list.filter((p) => p?.status === 'reported' && p?.customerSubmitted).reduce((s, p) => s + (Number(p.amount) || 0), 0))
}

// ยอดที่ผูกสลิปใหม่ได้ · 0 = ผูกไม่ได้ (ชำระครบแล้ว หรือมียอดรอตรวจอยู่แล้ว)
export function slipRoom(balance, payments) {
  const room = r2((Number(balance) || 0) - pendingCustomerTotal(payments))
  return room > 0.004 ? room : 0
}

// ตัวเลือกออร์เดอร์ของสลิปที่รอผูก: ออร์เดอร์ที่แนะนำ (ที่คุยล่าสุด) ก่อน แล้วออร์เดอร์อื่นของลูกค้ารายเดียวกัน
// ข้ามร่างและยกเลิก รวมถึงออร์เดอร์หน้าร้าน (POS) เพราะไม่ได้รับชำระผ่านแชท
export function slipChoices({ suggestedId = null, orders = [], customerId = null } = {}) {
  const open = (o) => !!o && o.channel !== 'pos' && o.status !== 'draft' && o.status !== 'cancelled'
  const list = (Array.isArray(orders) ? orders : []).filter(open)
  const suggested = suggestedId ? list.find((o) => o.id === suggestedId) || null : null
  const others = customerId ? list.filter((o) => o.id !== suggestedId && o.customerId === customerId) : []
  return { suggested, others }
}

// เทียบสลิปกับออร์เดอร์ก่อนรับชำระ (ฟังก์ชันล้วน): ยอด + เวลาโอนเทียบกับงวดที่ร้านแจ้งชำระและยังรอตรวจ → รายการ [{ ok, text }]
export function slipMatchChecks({ amount, paidAt, payments = [] }) {
  const amt = r2(amount)
  if (!(amt > 0)) return []
  const list = Array.isArray(payments) ? payments : []
  const hit = list.find((p) => p?.status === 'reported' && r2(p.requested ?? p.amount) === amt) || null
  const out = [hit
    ? { ok: true, text: 'ยอดตรงกับยอดที่ร้านแจ้งชำระ' }
    : { ok: false, text: 'ยอดไม่ตรงกับยอดที่ร้านแจ้งชำระที่รอตรวจ' }]
  const t = thaiMinute(paidAt)
  const due = hit?.dueAt ? thaiMinute(hit.dueAt) : ''
  if (t && due) out.push(t <= due ? { ok: true, text: 'โอนก่อนกำหนดชำระ' } : { ok: false, text: 'โอนเลยกำหนดชำระแล้ว' })
  return out
}

// กติกาก่อนผูกสลิป → ข้อความผิดพลาด หรือ '' เมื่อผ่าน (ลำดับการตรวจเหมือนหน้าชำระเงินของลูกค้า)
// refUsed = เลขอ้างอิงของสลิปถูกใช้แล้วในรายการชำระที่ไม่ได้ยกเลิกของออร์เดอร์ใดก็ได้ (ผู้เรียกคำนวณจากข้อมูลทั้งหมด)
export function slipBindError({ slip, orderInactive = false, room, amount, paidAt, createdAt, refUsed = false, nowMs = Date.now() }) {
  if (slip?.status !== 'manual' || !slip.slipRef) return 'สลิปนี้ไม่ได้รอรับชำระ'
  if (orderInactive) return 'ออร์เดอร์นี้รับยอดจากสลิปไม่ได้'
  if (!(room > 0)) return 'ออร์เดอร์นี้ชำระครบแล้ว หรือมียอดรอตรวจอยู่แล้ว'
  if (!(amount > 0)) return 'กรอกยอดเงิน'
  if (amount > room + 0.004) return 'ยอดเกินยอดที่รับได้ (หักยอดที่ลูกค้าแจ้งรอตรวจแล้ว)'
  if (!thaiMinute(paidAt)) return PAY_MSG.txn
  if (!notBeforeOrder(paidAt, createdAt)) return PAY_MSG.beforeOrder
  if (!notFuture(paidAt, nowMs)) return PAY_MSG.future
  if (!slip.ref) return PAY_MSG.ref
  if (refUsed) return PAY_MSG.refTaken
  return ''
}
