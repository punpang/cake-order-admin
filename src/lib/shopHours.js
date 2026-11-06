// วัน-เวลาปิดร้าน (ฟังก์ชันล้วน) · closures = { weekly: [วันในสัปดาห์ 0=อา], ranges: [{ id, from, to, reason }], hours: [{ id, days: [dow] | [] (ทุกวัน), from: 'HH:mm', to: 'HH:mm', reason }] }
// ปิดข้ามเที่ยงคืนไม่รองรับ (from ต้องน้อยกว่า to) — ถ้าปิดข้ามคืนให้ใช้ช่วงวัน
import { dateOnly } from './format'

const pad = (n) => String(n).padStart(2, '0')
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
const YMD = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
const toMin = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5))
export const DOW_NAMES = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์']
export const MAX_ROWS = 100
export const emptyClosures = () => ({ weekly: [], ranges: [], hours: [] })

const validDate = (s) => YMD.test(s) && ymd(new Date(`${s}T00:00`)) === s // กันวันที่ที่ไม่มีจริง เช่น 2026-02-30
const txt = (v, n) => String(v ?? '').trim().slice(0, n)

// ล้าง/ตรวจค่า → { value } | { error }
export function cleanClosures(input) {
  const c = input && typeof input === 'object' ? input : {}
  const weekly = [...new Set((Array.isArray(c.weekly) ? c.weekly : []).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort((a, b) => a - b)
  const ranges = []
  for (const r of Array.isArray(c.ranges) ? c.ranges : []) {
    const from = String(r?.from ?? '')
    const to = String(r?.to ?? '') || from
    if (!validDate(from) || !validDate(to)) return { error: 'วันที่ปิดร้านไม่ถูกต้อง' }
    if (to < from) return { error: 'วันสิ้นสุดต้องไม่ก่อนวันเริ่ม' }
    ranges.push({ id: txt(r.id, 40) || `r${ranges.length + 1}${Date.now()}`, from, to, reason: txt(r.reason, 80) })
  }
  const hours = []
  for (const h of Array.isArray(c.hours) ? c.hours : []) {
    const from = String(h?.from ?? '')
    const to = String(h?.to ?? '')
    if (!HHMM.test(from) || !HHMM.test(to)) return { error: 'เวลาปิดร้านไม่ถูกต้อง (HH:mm)' }
    if (toMin(from) >= toMin(to)) return { error: 'เวลาเริ่มปิดต้องน้อยกว่าเวลาสิ้นสุด' }
    const days = [...new Set((Array.isArray(h.days) ? h.days : []).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort((a, b) => a - b)
    hours.push({ id: txt(h.id, 40) || `h${hours.length + 1}${Date.now()}`, days: days.length === 7 ? [] : days, from, to, reason: txt(h.reason, 80) })
  }
  if (ranges.length > MAX_ROWS || hours.length > MAX_ROWS) return { error: `ตั้งได้ไม่เกิน ${MAX_ROWS} รายการต่อประเภท` }
  return { value: { weekly: weekly.length === 7 ? [0, 1, 2, 3, 4, 5, 6] : weekly, ranges, hours } }
}

// ปิดเต็มวันไหม (ประจำสัปดาห์/ช่วงวัน) → null | { kind, reason }
export function dayClosed(shop, dateStr) {
  const c = shop.closures
  if (!c) return null
  const dow = new Date(`${dateStr}T00:00`).getDay()
  if (c.weekly?.includes(dow)) return { kind: 'weekly', reason: `ปิดทุกวัน${DOW_NAMES[dow]}` }
  const r = (c.ranges || []).find((x) => dateStr >= x.from && dateStr <= x.to)
  if (r) return { kind: 'range', reason: r.reason || 'วันหยุดร้าน' }
  return null
}
// ปิดเวลานี้ไหม (เฉพาะที่ตั้งไว้) → null | { kind, reason }
export function closureAt(shop, date) {
  const d = dayClosed(shop, ymd(date))
  if (d) return d
  const m = date.getHours() * 60 + date.getMinutes()
  const dow = date.getDay()
  const h = (shop.closures?.hours || []).find((x) => (!x.days.length || x.days.includes(dow)) && m >= toMin(x.from) && m < toMin(x.to))
  return h ? { kind: 'hours', reason: h.reason || `ปิดช่วง ${h.from}–${h.to} น.` } : null
}
// ปิดตอนนี้ไหม รวมนอกเวลาเปิด-ปิดประจำวัน (shop.open/close)
export function isClosedNow(shop, date = new Date()) {
  const c = closureAt(shop, date)
  if (c) return c
  const m = date.getHours() * 60 + date.getMinutes()
  if (m < toMin(shop.open) || m >= toMin(shop.close)) return { kind: 'outside', reason: 'นอกเวลาทำการ' }
  return null
}
// ช่องนัด (วัน + HH:mm) ตรงช่วงปิดไหม → null | { kind, reason }
export const slotClosed = (shop, dateStr, hhmm) => closureAt(shop, new Date(`${dateStr}T${hhmm}`))
// นัดรับ/ส่ง (YYYY-MM-DDTHH:mm) ตรงช่วงปิดไหม
export const pickupClosed = (shop, pickupAt) => (pickupAt && !Number.isNaN(new Date(pickupAt).getTime()) ? closureAt(shop, new Date(pickupAt)) : null)

// เวลาเปิดครั้งถัดไป (ข้ามวันปิด/ช่วงปิด) · ไม่เจอใน 400 วัน = null
export function nextOpen(shop, from = new Date()) {
  const step = 5
  for (let k = 0; k < 400; k++) {
    const day = new Date(from.getFullYear(), from.getMonth(), from.getDate() + k)
    if (dayClosed(shop, ymd(day))) continue
    const start = toMin(shop.open)
    const end = toMin(shop.close)
    const nowM = k === 0 ? from.getHours() * 60 + from.getMinutes() : 0
    for (let m = Math.max(start, nowM); m < end; m += step) {
      const t = new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(m / 60), m % 60)
      if (!closureAt(shop, t)) return t
    }
  }
  return null
}

// ข้อความอธิบาย
export function describeClosures(c) {
  const out = []
  if (c?.weekly?.length) out.push(c.weekly.length === 7 ? 'ปิดทุกวัน' : `ปิดทุกวัน${c.weekly.map((d) => DOW_NAMES[d]).join(' ')}`)
  for (const r of c?.ranges || []) out.push(`ปิด ${r.from === r.to ? dateOnly(r.from) : `${dateOnly(r.from)}–${dateOnly(r.to)}`}${r.reason ? ` (${r.reason})` : ''}`)
  for (const h of c?.hours || []) out.push(`ปิด ${h.from}–${h.to} น.${h.days.length ? ` ${h.days.map((d) => DOW_NAMES[d]).join(' ')}` : ' ทุกวัน'}${h.reason ? ` (${h.reason})` : ''}`)
  return out
}
