// ตัวเลข: หลักพันมีจุลภาค · เงินทศนิยม 2 ตำแหน่งเสมอ (1,410.00 ฿)
const mf = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const qf = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 2 })
export const qty = (n) => qf.format(Number(n) || 0)
export const num = qty
export const money = (n) => `${mf.format(Number(n) || 0)} ฿`

// เบอร์โทร: เก็บตัวเลขล้วน (สูงสุด 10 หลัก) แสดง xxx-xxx-xxxx · เบอร์บ้านกรุงเทพ 02 (9 หลัก) = 02-xxx-xxxx
export const phoneDigits = (s) => String(s ?? '').replace(/\D/g, '').slice(0, 10)
// เบอร์ที่ใช้ได้ (บังคับของลูกค้า): ขึ้นต้น 0 ยาว 9–10 หลัก
export const phoneValid = (s) => /^0\d{8,9}$/.test(phoneDigits(s))
export function formatPhone(s) {
  const d = phoneDigits(s)
  const a = d.length === 9 && d.startsWith('02') ? 2 : 3
  if (d.length <= a) return d
  if (d.length <= a + 3) return `${d.slice(0, a)}-${d.slice(a)}`
  return `${d.slice(0, a)}-${d.slice(a, a + 3)}-${d.slice(a + 3)}`
}

// วันที่ dd-mm-yyyy (ปี พ.ศ.) · เวลา HH:MM
const DOW = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.']
// 'YYYY-MM-DD' (ไม่มีเวลา) ถือเป็นวันที่ตามเครื่อง ไม่ใช่ UTC
const toDate = (s) => (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00`) : new Date(s))
const dmy = (d) => `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear() + 543}`
const hm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

export const dateOnly = (s) => (s ? dmy(toDate(s)) : '-')
export const dateTime = (s) => (s ? `${dmy(toDate(s))} ${hm(toDate(s))}` : '-')
export const timeOnly = (s) => (s ? hm(toDate(s)) : '-')

export const pad = (n) => String(n).padStart(2, '0')

// 'YYYY-MM-DD' ตามเวลาเครื่อง
export const toDateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

// หัววัน: "วันนี้ 02-11-2569" / "พรุ่งนี้ …" / "เมื่อวาน …" / อื่น ๆ "พ. 04-11-2569"
export function dayLabel(s) {
  if (!s) return '-'
  const day = s.slice(0, 10)
  const d = new Date()
  const today = toDateStr(d)
  d.setDate(d.getDate() + 1)
  const tomorrow = toDateStr(d)
  d.setDate(d.getDate() - 2)
  const yesterday = toDateStr(d)
  const label = day === today ? 'วันนี้' : day === tomorrow ? 'พรุ่งนี้' : day === yesterday ? 'เมื่อวาน' : DOW[toDate(day).getDay()]
  return `${label} ${dateOnly(day)}`
}

// รหัสออเดอร์ที่แสดงให้คนเห็น: OR-ddmmyy-xxxxxx → ORDddmmyyxxxxxx (ตรงกับเลขบนสลิป) · รูปแบบอื่นคงเดิม
export const orderNo = (code) => String(code ?? '').replace(/^OR-(\d{6})-(\d+)$/i, 'ORD$1$2')
