const nf = new Intl.NumberFormat('th-TH')

export const money = (n) => `${nf.format(Math.round(Number(n) || 0))} ฿`

export const dateTime = (s) =>
  s ? new Date(s).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }) : '-'

export const dateOnly = (s) =>
  s ? new Date(s).toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short' }) : '-'

export const pad = (n) => String(n).padStart(2, '0')

// 'YYYY-MM-DD' ตามเวลาเครื่อง
export const toDateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
