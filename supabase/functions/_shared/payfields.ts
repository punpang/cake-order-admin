// ฟิลด์การโอนที่ลูกค้าแจ้ง (วัน-เวลาทำรายการ · ธนาคารของผู้โอน · เลขอ้างอิง) และกติกา
// ไฟล์คู่ฝั่งแอป: src/lib/payFields.js (ค่าและข้อความต้องตรงกัน · payfields.test.ts ตรวจเทียบให้อัตโนมัติ)

export type BankEntry = { code: string; name: string; checked: boolean }

// ธนาคารต้นทาง = ธนาคารของผู้โอน (ในสลิปคือรหัสธนาคารที่ส่งเงินออก ไม่ใช่บัญชีของร้าน)
// checked = ยืนยันชื่อ-รหัสจากผลค้นหาที่ระบุรหัสตรงกันแล้ว · checked:false = ยังไม่ได้ตรวจกับทะเบียนของ ธปท.
export const BANKS: BankEntry[] = [
  { code: '002', name: 'ธนาคารกรุงเทพ', checked: true },
  { code: '004', name: 'ธนาคารกสิกรไทย', checked: true },
  { code: '006', name: 'ธนาคารกรุงไทย', checked: false },
  { code: '011', name: 'ธนาคารทหารไทยธนชาต', checked: false },
  { code: '014', name: 'ธนาคารไทยพาณิชย์', checked: false },
  { code: '020', name: 'ธนาคารสแตนดาร์ดชาร์เตอร์ด (ไทย)', checked: true },
  { code: '022', name: 'ธนาคารซีไอเอ็มบีไทย', checked: true },
  { code: '024', name: 'ธนาคารยูโอบี', checked: false },
  { code: '025', name: 'ธนาคารกรุงศรีอยุธยา', checked: false },
  { code: '030', name: 'ธนาคารออมสิน', checked: false },
  { code: '033', name: 'ธนาคารอาคารสงเคราะห์', checked: false },
  { code: '034', name: 'ธนาคารเพื่อการเกษตรและสหกรณ์การเกษตร', checked: false },
  { code: '067', name: 'ธนาคารทิสโก้', checked: true },
  { code: '069', name: 'ธนาคารเกียรตินาคินภัทร', checked: false },
  { code: '070', name: 'ธนาคารไอซีบีซี (ไทย)', checked: true },
  { code: '073', name: 'ธนาคารแลนด์ แอนด์ เฮ้าส์', checked: true },
]

export const bankByCode = (code: unknown): BankEntry | null => BANKS.find((b) => b.code === String(code ?? '')) ?? null

export const PAY_MSG = {
  txn: 'กรอกวัน-เวลาที่ทำรายการให้ถูกต้อง',
  beforeOrder: 'วัน-เวลาชำระต้องไม่น้อยกว่าวัน-เวลาสร้างออร์เดอร์',
  future: 'วัน-เวลาชำระต้องไม่เกินเวลาปัจจุบัน',
  bank: 'เลือกธนาคารของผู้โอน',
  ref: 'กรอกเลขอ้างอิงให้ถูกต้อง (ตัวอักษรหรือตัวเลข 6–40 ตัว)',
  refTaken: 'เลขอ้างอิงนี้เคยถูกใช้แจ้งชำระแล้ว ใช้ซ้ำไม่ได้',
  notSlip: 'รูปนี้เป็น QR รับเงินของร้าน ไม่ใช่สลิปโอนเงิน · แนบสลิปจากแอปธนาคารแทน',
  qrMismatch: 'ธนาคารหรือเลขอ้างอิงไม่ตรงกับ QR ในสลิป · ตรวจแล้วกรอกใหม่',
}

// เลขอ้างอิง: ตัดช่องว่างและขีด แปลงเป็นตัวพิมพ์ใหญ่ (สลิปกับที่กรอกเทียบกันได้)
export const normalizeRef = (s: unknown): string => String(s ?? '').replace(/[\s-]/g, '').toUpperCase()
export const REF_RE = /^[A-Z0-9]{6,40}$/

const TH_MS = 7 * 3600000
// เวลาไทย "YYYY-MM-DDTHH:mm" จากเวลาแบบ ms
export const thaiMinuteOfMs = (ms: number): string => new Date(ms + TH_MS).toISOString().slice(0, 16)

// วันที่ "YYYY-MM-DD" + เวลา "HH:mm" → "YYYY-MM-DDTHH:mm" ถ้าเป็นวัน-เวลาที่มีจริง · ไม่ถูกต้อง → ''
export function txnMinute(date: unknown, time: unknown): string {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date ?? ''))
  const t = /^(\d{2}):(\d{2})$/.exec(String(time ?? ''))
  if (!d || !t) return ''
  const y = Number(d[1]), mo = Number(d[2]), da = Number(d[3]), h = Number(t[1]), mi = Number(t[2])
  if (mo < 1 || mo > 12 || da < 1 || h > 23 || mi > 59) return ''
  const probe = new Date(Date.UTC(y, mo - 1, da))
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== da) return ''
  return `${d[0]}T${t[0]}`
}

// เวลาในข้อมูล → "YYYY-MM-DDTHH:mm" เวลาไทย: ค่า ISO ที่มีโซนแปลงให้ · แบบท้องถิ่นไทยไม่มีโซนตัดเหลือนาที · ไม่รู้จัก → ''
export function thaiMinute(v: unknown): string {
  const s = String(v ?? '')
  if (!s) return ''
  if (/(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(s)) {
    const ms = Date.parse(s)
    return Number.isFinite(ms) ? thaiMinuteOfMs(ms) : ''
  }
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s) ? s.slice(0, 16) : ''
}

// กติกา: วัน-เวลาชำระต้องไม่น้อยกว่าวัน-เวลาสร้างออร์เดอร์ (เทียบเป็นนาทีเวลาไทย) · ไม่รู้ค่าใดค่าหนึ่ง → ไม่ตรวจ
export function notBeforeOrder(paidAt: unknown, createdAt: unknown): boolean {
  const p = thaiMinute(paidAt)
  const c = thaiMinute(createdAt)
  return !p || !c || p >= c
}

// ไม่เกินเวลาปัจจุบัน (ยอมคลาดเคลื่อน 5 นาที)
export function notFuture(paidAt: unknown, nowMs: number = Date.now()): boolean {
  const p = thaiMinute(paidAt)
  return !p || p <= thaiMinuteOfMs(nowMs + 5 * 60000)
}

// เลขอ้างอิงถูกใช้แล้วหรือไม่: มีรายการชำระที่ไม่ได้ยกเลิก ซึ่งมีเลขอ้างอิงเดียวกัน
export function refTaken(payments: unknown, ref: unknown): boolean {
  const r = normalizeRef(ref)
  if (!r || !Array.isArray(payments)) return false
  return payments.some((p: any) => p && p.status !== 'cancelled' && normalizeRef(p.ref) === r)
}

// ตรวจฟิลด์ที่ลูกค้ากรอกหรืออ่านจากสลิป → { error } | { value }
// ยังไม่รวมการตรวจเลขอ้างอิงซ้ำ (ต้องดูข้อมูลออร์เดอร์ทั้งหมด) และยังไม่ตรวจว่าธนาคารอยู่ในรายการ (ค่าจาก QR อาจเป็นรหัสที่ยังไม่รู้จัก)
export function checkCustomerTxn(input: {
  txnDate: unknown; txnTime: unknown; bankCode: unknown; ref: unknown; createdAt?: unknown; nowMs?: number
}): { error: string } | { value: { paidAt: string; bankCode: string; ref: string } } {
  const paidAt = txnMinute(input.txnDate, input.txnTime)
  if (!paidAt) return { error: PAY_MSG.txn }
  if (!notBeforeOrder(paidAt, input.createdAt)) return { error: PAY_MSG.beforeOrder }
  if (!notFuture(paidAt, input.nowMs ?? Date.now())) return { error: PAY_MSG.future }
  // ธนาคารและเลขอ้างอิงไม่บังคับ (ถ้าอ่านจาก QR ในสลิปได้ เซิร์ฟเวอร์ใช้ค่าจาก QR) · ถ้ากรอกมาต้องถูกรูปแบบ
  const bankCode = String(input.bankCode ?? '').trim()
  if (bankCode && !/^\d{3}$/.test(bankCode)) return { error: PAY_MSG.bank }
  const ref = normalizeRef(input.ref)
  if (ref && !REF_RE.test(ref)) return { error: PAY_MSG.ref }
  return { value: { paidAt, bankCode, ref } }
}

// เวลาชำระของสลิปในแชท: ใช้เวลาที่ลูกค้าส่งข้อความ (ใกล้เวลาโอนที่สุดที่ระบบรู้) · ไม่ก่อนวันสร้างออร์เดอร์ · ไม่รู้ → เวลาปัจจุบัน
export function paidAtFromMessage(msgAt: unknown, createdAt: unknown, nowMs: number): string {
  const m = thaiMinute(msgAt)
  return m && notBeforeOrder(m, createdAt) ? m : thaiMinuteOfMs(nowMs)
}
