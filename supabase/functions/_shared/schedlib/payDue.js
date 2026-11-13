// กำหนดชำระ (ฟังก์ชันล้วน) · payment.dueAt = เวลา ISO/ท้องถิ่น "YYYY-MM-DDTHH:mm" ว่าง = ไม่กำหนด
import { pad, toDateStr } from './format.js'

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

// ---------- ตัวเลือกกำหนดชำระตามเวลานัด ----------
const p2 = (n) => String(n).padStart(2, '0')
const toLocal = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`
export const isHHmm = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s || ''))

// คำเรียกวันของเวลา (วันนี้/เมื่อวาน/พรุ่งนี้/dd/mm) ใช้ในข้อความเหตุผล
function dayWord(iso, now) {
  const a = new Date(iso.slice(0, 10) + 'T00:00')
  const b = new Date(toLocal(now).slice(0, 10) + 'T00:00')
  const diff = Math.round((a - b) / 86400000)
  if (diff === 0) return 'วันนี้'
  if (diff === -1) return 'เมื่อวาน'
  if (diff === 1) return 'พรุ่งนี้'
  return `${p2(a.getDate())}/${p2(a.getMonth() + 1)}`
}

// ตรวจเวลาที่คำนวณได้: ต้องอยู่หลังตอนนี้ · คืน { dueAt, disabled, reason }
export function dueCheck(dueAt, now = new Date()) {
  if (!dueAt || Number.isNaN(new Date(dueAt).getTime())) return { dueAt: '', disabled: true, reason: 'คำนวณเวลาไม่ได้ (ไม่มีวันเวลานัด)' }
  if (new Date(dueAt).getTime() <= now.getTime()) return { dueAt, disabled: true, reason: `${dueAt.slice(11, 16)} ${dayWord(dueAt, now)} ผ่านไปแล้ว` }
  return { dueAt, disabled: false, reason: '' }
}

// ก่อนเวลานัด N ชั่วโมง
export function dueBeforePickup(pickupAt, hours, now = new Date()) {
  const h = Number(hours)
  const t = new Date(pickupAt)
  if (!(h > 0) || Number.isNaN(t.getTime())) return dueCheck('', now)
  return dueCheck(toLocal(new Date(t.getTime() - h * 3600000)), now)
}

// ล่วงหน้า N วัน ก่อนเวลา HH:mm (นับจากวันนัด)
export function dueDaysBefore(pickupAt, days, atTime = '12:00', now = new Date()) {
  const d = Number(days)
  const t = new Date(pickupAt)
  if (!(d >= 0) || !isHHmm(atTime) || Number.isNaN(t.getTime())) return dueCheck('', now)
  const x = new Date(t.getFullYear(), t.getMonth(), t.getDate() - d, Number(atTime.slice(0, 2)), Number(atTime.slice(3)))
  return dueCheck(toLocal(x), now)
}

// งวดที่ลูกค้าแนบสลิปเองและรอร้านตรวจสอบ
export const customerPending = (order) => (order.payments || []).filter((p) => p.status === 'reported' && p.customerSubmitted)
