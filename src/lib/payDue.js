// กำหนดชำระ (ฟังก์ชันล้วน) · payment.dueAt = เวลา ISO/ท้องถิ่น "YYYY-MM-DDTHH:mm" ว่าง = ไม่กำหนด
import { pad, toDateStr } from './format'

export const QUICK_DUE = [
  { m: 15, label: '15 นาที' },
  { m: 30, label: '30 นาที' },
  { m: 60, label: '1 ชม.' },
  { m: 180, label: '3 ชม.' },
  { m: 1440, label: '24 ชม.' },
]

// เวลาท้องถิ่นรูป datetime-local หลังจากนี้ minutes นาที (ปัดวินาทีทิ้ง)
export function quickDue(minutes, from = new Date()) {
  const d = new Date(from.getTime() + Math.max(0, Number(minutes) || 0) * 60000)
  return `${toDateStr(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const ms = (s) => (s ? new Date(s).getTime() : NaN)

// none = ไม่กำหนด/ไม่ใช่งวดที่รอชำระ · upcoming = ยังไม่ถึง · overdue = เลยกำหนด (ยังไม่ได้ขยาย)
export function dueState(p, now = new Date()) {
  if (!p || p.status !== 'reported' || !p.dueAt) return 'none'
  const t = ms(p.dueAt)
  if (Number.isNaN(t)) return 'none'
  return t < now.getTime() ? 'overdue' : 'upcoming'
}

// ข้อความเหลือเวลา เช่น "เหลือ 25 นาที" · "เกินกำหนด 2 ชม."
export function remainingText(p, now = new Date()) {
  const st = dueState(p, now)
  if (st === 'none') return ''
  const diff = Math.abs(ms(p.dueAt) - now.getTime())
  const min = Math.max(1, Math.round(diff / 60000))
  const txt = min < 60 ? `${min} นาที` : min < 1440 ? `${Math.floor(min / 60)} ชม.${min % 60 ? ` ${min % 60} นาที` : ''}` : `${Math.floor(min / 1440)} วัน`
  return st === 'overdue' ? `เกินกำหนด ${txt}` : `เหลือ ${txt}`
}

// งวดที่เลยกำหนดของออร์เดอร์ (ออร์เดอร์ที่ยกเลิก/ร่าง/ส่งมอบแล้วไม่นับ)
export const overduePayments = (order, now = new Date()) =>
  ['draft', 'cancelled', 'delivered'].includes(order.status) ? [] : (order.payments || []).filter((p) => dueState(p, now) === 'overdue')

export const hasOverdue = (order, now = new Date()) => overduePayments(order, now).length > 0
// ขอขยายเวลาที่รออยู่
export const pendingExtension = (order) => (order.payments || []).find((p) => p.status === 'reported' && p.extension?.status === 'pending') || null

// สรุปกำหนดชำระของออร์เดอร์ (งวดที่ใกล้ที่สุด เลยกำหนดก่อน) → null | { dueAt, state, text }
export function orderDue(order, now = new Date()) {
  if (['draft', 'cancelled', 'delivered'].includes(order.status)) return null
  const rows = (order.payments || []).filter((p) => dueState(p, now) !== 'none').sort((a, b) => ms(a.dueAt) - ms(b.dueAt))
  const first = rows.find((p) => dueState(p, now) === 'overdue') || rows[0]
  return first ? { dueAt: first.dueAt, state: dueState(first, now), text: remainingText(first, now) } : null
}
