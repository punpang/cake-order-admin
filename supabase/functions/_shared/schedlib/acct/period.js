// ช่วงเวลาบัญชี (ฟังก์ชันล้วน) · เดือน 'YYYY-MM'
const pad = (n) => String(n).padStart(2, '0')
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const thisMonth = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
export function monthRange(ym) {
  const [y, m] = ym.split('-').map(Number)
  return { from: `${y}-${pad(m)}-01`, to: ymd(new Date(y, m, 0)) }
}
export function quarterRange(y, q) {
  const m = (q - 1) * 3 + 1
  return { from: `${y}-${pad(m)}-01`, to: ymd(new Date(y, m + 2, 0)) }
}
export const yearRange = (y) => ({ from: `${y}-01-01`, to: `${y}-12-31` })
export const addMonths = (ym, n) => {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 1 + n, 1)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}
export const monthLabel = (ym) => {
  const [y, m] = ym.split('-').map(Number)
  return `${['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'][m - 1]} ${y + 543}`
}
