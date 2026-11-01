// วันเกิด (เก็บเป็น 'MM-DD' ไม่มีปี)
import { pad, toDateStr } from './format'

export const MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
const MAX_DAY = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

export const daysInMonth = (m) => MAX_DAY[(Number(m) || 1) - 1]

// ฟอร์ม { name, day, month } → { name, md } | null, error = ข้อความผิดพลาด
export function parseBirthday(f) {
  const day = Number(f?.day) || 0
  const month = Number(f?.month) || 0
  const name = (f?.name || '').trim()
  if (!day && !month) return name ? { error: 'เลือกวันและเดือนเกิด' } : { value: null }
  if (!day || !month) return { error: 'เลือกวันและเดือนเกิดให้ครบ' }
  if (day > daysInMonth(month)) return { error: 'วันเกิดไม่ถูกต้อง' }
  return { value: { name, md: `${pad(month)}-${pad(day)}` } }
}

export const toForm = (b) => (b?.md ? { name: b.name || '', day: Number(b.md.slice(3, 5)), month: Number(b.md.slice(0, 2)) } : { name: '', day: '', month: '' })

export const mdLabel = (md) => (md ? `${Number(md.slice(3, 5))} ${MONTHS[Number(md.slice(0, 2)) - 1]}` : '-')

// วันเกิดครั้งถัดไป (นับวันนี้ด้วย) → 'YYYY-MM-DD' ถ้า 29 ก.พ. ในปีที่ไม่มี ใช้ 28 ก.พ.
export function nextBirthday(md, from = new Date()) {
  const today = toDateStr(from)
  const at = (y) => {
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
    return `${y}-${md === '02-29' && !leap ? '02-28' : md}`
  }
  const y = from.getFullYear()
  return at(y) >= today ? at(y) : at(y + 1)
}

// จำนวนวันจาก a ถึง b ('YYYY-MM-DD')
export const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00`) - new Date(`${a}T00:00`)) / 86400000)
