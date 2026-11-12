// แยกค่าจากข้อความที่ Tesseract อ่านได้จากภาพสลิปธนาคาร (ฟังก์ชันล้วน ไม่มี API ภายนอก)
// ค่าที่อ่านไม่มั่นใจจะเป็น null และ review ระบุว่าฟิลด์ไหนพนักงานต้องตรวจ
// เลขบัญชีผู้รับ/ชื่อผู้รับ ถือว่าต้องตรวจเสมอ เพราะ OCR อ่านตัวเลขบางตัวผิดได้ (เช่น 4797 → 4707)

export type SlipText = {
  amount: number | null
  paidAt: string | null // "YYYY-MM-DDTHH:mm" เวลาไทย
  receiverName: string | null
  receiverAccount: string | null // เลขที่ปรากฏบนสลิป (มักถูกปิดบาง)
  review: Array<'amount' | 'paidAt' | 'receiverName' | 'receiverAccount'>
}

const MONTHS: Record<string, number> = {
  'ม.ค.': 1, 'ก.พ.': 2, 'มี.ค.': 3, 'เม.ย.': 4, 'พ.ค.': 5, 'มิ.ย.': 6,
  'ก.ค.': 7, 'ส.ค.': 8, 'ก.ย.': 9, 'ต.ค.': 10, 'พ.ย.': 11, 'ธ.ค.': 12,
}
const pad = (n: number) => String(n).padStart(2, '0')

// วัน-เวลาทำรายการ เช่น "13 พ.ย. 2569 - 01:28" หรือ "12 พ.ย. 69 11:52" (ปี พ.ศ. 2 หลัก = 25xx)
export function parseThaiDateTime(text: string): string | null {
  // วันที่: OCR มักอ่านเลข 1 เป็น l/I/| และ 0 เป็น O/o จึงแก้ตัวอักษรที่หน้าตาคล้ายตัวเลขก่อนแปลงวัน
  const m = text.match(/([0-9lI|iOo]{1,2})\s*(ม\.ค\.|ก\.พ\.|มี\.ค\.|เม\.ย\.|พ\.ค\.|มิ\.ย\.|ก\.ค\.|ส\.ค\.|ก\.ย\.|ต\.ค\.|พ\.ย\.|ธ\.ค\.)\s*(\d{4}|\d{2})\s*[-–]?\s*(\d{1,2}):(\d{2})/)
  if (!m) return null
  const day = Number(m[1].replace(/[lI|i]/g, '1').replace(/[Oo]/g, '0'))
  const month = MONTHS[m[2]]
  let year = Number(m[3])
  if (year < 100) year += 2500
  const be = year >= 2500 ? year - 543 : year
  const hh = Number(m[4])
  const mm = Number(m[5])
  if (day < 1 || day > 31 || hh > 23 || mm > 59) return null
  const d = new Date(Date.UTC(be, month - 1, day))
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null
  return `${be}-${pad(month)}-${pad(day)}T${pad(hh)}:${pad(mm)}`
}

// จำนวนเงิน: บรรทัดที่มี "เงิน" (ไม่ใช่ค่าธรรมเนียม) ตัวเลขแรกในบรรทัด · ผิดช่วง = null
export function parseAmount(text: string): number | null {
  for (const line of text.split('\n')) {
    if (!/เงิน/.test(line) || /ธรรมเนียม/.test(line)) continue
    const m = line.match(/(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{1,2}))?/)
    if (!m) continue
    const n = Number(`${m[1].replace(/,/g, '')}${m[2] ? `.${m[2]}` : ''}`)
    if (Number.isFinite(n) && n > 0 && n <= 10_000_000) return Math.round(n * 100) / 100
  }
  return null
}

// บรรทัดหลัง "ไปยัง" = ผู้รับ: ชื่อ (บรรทัดแรก) และเลขบัญชี/พร้อมเพย์ (บรรทัดที่มีตัวเลขอย่างน้อย 3 ตัว)
export function parseReceiver(text: string): { name: string | null; account: string | null } {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  const start = lines.findIndex((l) => /ไปยัง|To\b/.test(l))
  if (start < 0) return { name: null, account: null }
  const rest = lines.slice(start + 1, start + 5)
  const name = rest.find((l) => /[ก-๙A-Za-z]{2,}/.test(l) && !/พร้อมเพย์|บัญชี|จำนวน|ค่าธรรมเนียม|รหัส/.test(l)) ?? null
  const accLine = rest.find((l) => (l.match(/\d/g) || []).length >= 3 || /[Xx*]{2,}/.test(l)) ?? ''
  const acc = accLine.match(/[Xx*\d][Xx*\d\- ]{2,}[Xx*\d]/)
  return { name, account: acc ? acc[0].replace(/\s+/g, ' ').trim() : null }
}

export function parseSlipText(text: string): SlipText {
  const amount = parseAmount(text)
  const paidAt = parseThaiDateTime(text)
  const r = parseReceiver(text)
  const review: SlipText['review'] = []
  if (amount == null) review.push('amount')
  if (paidAt == null) review.push('paidAt')
  review.push('receiverName', 'receiverAccount')
  return { amount, paidAt, receiverName: r.name, receiverAccount: r.account, review }
}
