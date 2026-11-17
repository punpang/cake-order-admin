// กรอบเวลาที่ลูกค้าขอ/แก้ใบกำกับภาษีเอง (ฟังก์ชันล้วน)
// กติกา: ภายใน 5 วันหลังชำระครบ และไม่เกินวันที่ 5 ของเดือนถัดไปจากเดือนที่ชำระ (เลือกวันที่มาถึงก่อน) · นับถึงสิ้นวันสุดท้าย
const pad = (n) => String(n).padStart(2, '0')
const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const WINDOW_DAYS = 5
export const WINDOW_CAP_DAY = 5
// paid = 'YYYY-MM-DD' (หรือ ISO) · คืนวันสุดท้ายที่ยังขอ/แก้ได้ 'YYYY-MM-DD' หรือ '' ถ้าวันที่ไม่ถูกต้อง
export function invoiceDeadline(paid) {
  const s = String(paid || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return ''
  const [y, m, d] = s.split('-').map(Number)
  const plus = new Date(y, m - 1, d + WINDOW_DAYS)
  const cap = new Date(y, m, WINDOW_CAP_DAY)
  return fmt(plus <= cap ? plus : cap)
}
export const invoiceWindowOpen = (paid, today) => { const dl = invoiceDeadline(paid); return !!dl && String(today).slice(0, 10) <= dl }
