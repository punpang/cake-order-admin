// แยกวัน-เวลาทำรายการจากข้อความสลิปธนาคาร (ฟังก์ชันล้วน ไม่มี API ภายนอก) · ใช้กับผลอ่านจาก Workers AI
// วัน-เวลาที่อ่านไม่ได้เป็น null · ค่าคาดการณ์ (เดือนอ่านไม่ออก) ผู้เรียกต้องให้พนักงานตรวจ

const MONTHS: Record<string, number> = {
  'ม.ค.': 1, 'ก.พ.': 2, 'มี.ค.': 3, 'เม.ย.': 4, 'พ.ค.': 5, 'มิ.ย.': 6,
  'ก.ค.': 7, 'ส.ค.': 8, 'ก.ย.': 9, 'ต.ค.': 10, 'พ.ย.': 11, 'ธ.ค.': 12,
}
const pad = (n: number) => String(n).padStart(2, '0')

// วัน-เวลาทำรายการ เช่น "13 พ.ย. 2569 - 01:28" หรือ "12 พ.ย. 69 11:52" (ปี พ.ศ. 2 หลัก = 25xx)
// OCR มักอ่านเลข 1 เป็น l/I/| และ 0 เป็น O/o · สระลอยหลังจุด ("พ.ุย.") ถูกตัดทิ้งก่อนอ่านเดือน
const DAY = '([0-9lI|iOo]{1,2})'
const fixDay = (v: string) => Number(v.replace(/[lI|i]/g, '1').replace(/[Oo]/g, '0'))
const build = (y: number, month: number, day: number, hh: number, mm: number): string | null => {
  if (day < 1 || day > 31 || hh > 23 || mm > 59) return null
  const d = new Date(Date.UTC(y, month - 1, day))
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null
  return `${y}-${pad(month)}-${pad(day)}T${pad(hh)}:${pad(mm)}`
}
const ceYear = (v: string) => { let y = Number(v); if (y < 100) y += 2500; return y >= 2500 ? y - 543 : y }
export function parseThaiDateTime(text: string): string | null {
  const t = text.replace(/\.[ัิ-ฺ็-๎]+/g, '.')
  const m = t.match(new RegExp(`${DAY}\\s*(ม\\.ค\\.|ก\\.พ\\.|มี\\.ค\\.|เม\\.ย\\.|พ\\.ค\\.|มิ\\.ย\\.|ก\\.ค\\.|ส\\.ค\\.|ก\\.ย\\.|ต\\.ค\\.|พ\\.ย\\.|ธ\\.ค\\.)\\s*(\\d{4}|\\d{2})\\s*[-–,]?\\s*(\\d{1,2}):(\\d{2})`))
  if (!m) return null
  return build(ceYear(m[3]), MONTHS[m[2]], fixDay(m[1]), Number(m[4]), Number(m[5]))
}
// เดือนอ่านไม่ออก (เช่น "11 we. 69 15:49") แต่วัน ปี เวลา ครบ → เลือกเดือนล่าสุดที่ไม่เกินเวลาปัจจุบัน (สลิปที่ส่งมามักเพิ่งโอน)
// เป็นค่าคาดการณ์ · ผู้เรียกต้องให้พนักงานตรวจ
export function inferThaiDateTime(text: string, nowMs = Date.now()): string | null {
  const m = text.match(new RegExp(`(?:^|\\n)\\s*(?:\\S{1,3}\\s+)?${DAY}\\s+\\S{1,6}\\s+(\\d{4}|\\d{2})\\s*[-–,]?\\s*(\\d{1,2}):(\\d{2})`))
  if (!m) return null
  const y = ceYear(m[2])
  const now = new Date(nowMs + 7 * 3600_000) // เวลาไทย
  if (y !== now.getUTCFullYear() && y !== now.getUTCFullYear() - 1) return null
  const nowKey = now.toISOString().slice(0, 16)
  for (let month = 12; month >= 1; month--) {
    const v = build(y, month, fixDay(m[1]), Number(m[3]), Number(m[4]))
    if (v && v <= nowKey) return v
  }
  return null
}
