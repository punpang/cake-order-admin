const nf = new Intl.NumberFormat('th-TH')

const qf = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 2 })
export const qty = (n) => qf.format(Number(n) || 0)

export const money = (n) => `${nf.format(Math.round(Number(n) || 0))} ฿`

export const dateTime = (s) =>
  s ? new Date(s).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }) : '-'

export const dateOnly = (s) =>
  s ? new Date(s).toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short' }) : '-'

export const timeOnly = (s) =>
  s ? new Date(s).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : '-'

export const pad = (n) => String(n).padStart(2, '0')

// 'YYYY-MM-DD' ตามเวลาเครื่อง
export const toDateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

// วันนี้ / พรุ่งนี้ / เมื่อวาน / วันที่
export function dayLabel(s) {
  if (!s) return '-'
  const day = s.slice(0, 10)
  const d = new Date()
  const today = toDateStr(d)
  d.setDate(d.getDate() + 1)
  const tomorrow = toDateStr(d)
  d.setDate(d.getDate() - 2)
  const yesterday = toDateStr(d)
  if (day === today) return 'วันนี้'
  if (day === tomorrow) return 'พรุ่งนี้'
  if (day === yesterday) return 'เมื่อวาน'
  return dateOnly(s)
}
