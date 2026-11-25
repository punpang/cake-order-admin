// ข้อความแจ้งลูกค้าสั่งล่วงหน้า (ฟังก์ชันล้วน) · ใช้ทั้งแอปและ Edge Function ผ่าน schedlib
// ไม่มีรหัสออร์เดอร์ที่เปิดข้อมูลได้เอง ลิงก์ใช้ {LINK} ให้ระบบแทนที่ตอนส่ง (หน้า "ออร์เดอร์ของฉัน" ต้องยืนยัน OTP)
// ข้อความ SMS ไม่เกิน 300 ตัวอักษร

export const EVENTS = ['placed', 'paid', 'reminder1h', 'extend_requested', 'extended', 'cancelled', 'expired', 'shipped', 'delivered', 'balance_due', 'return_requested', 'refunded']
export const SMS_MAX = 300
const money = (n) => (Number(n) || 0).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
const day = (s) => (s ? new Date(`${s}T00:00:00+07:00`).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok' }) : '')
const time = (s) => (s ? new Date(s).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' }) : '')

const T = {
  placed: (c) => `สั่งเค้ก ${c.code} แล้ว ชำระมัดจำ ${money(c.due)} บาท ภายใน ${time(c.payDueAt)} {LINK}`,
  paid: (c) => `รับชำระแล้ว ${c.code} ยอดที่ชำระรวม ${money(c.paid)} บาท ขอบคุณค่ะ`,
  reminder1h: (c) => `เตือนค่ะ ${c.code} ยังค้างชำระ ${money(c.due)} บาท ภายใน 1 ชั่วโมง ${time(c.payDueAt)} {LINK}`,
  extend_requested: (c) => `ได้รับคำขอขยายเวลาชำระ ${c.code} แล้ว ร้านจะแจ้งผลให้ทราบค่ะ {LINK}`,
  extended: (c) => `ร้านขยายเวลาชำระ ${c.code} ถึง ${time(c.payDueAt)} แล้วค่ะ {LINK}`,
  cancelled: (c) => `ยกเลิกออร์เดอร์ ${c.code} แล้วค่ะ${c.refund ? ` คืนเงิน ${money(c.refund)} บาท` : ''} สอบถามได้ที่ร้าน`,
  expired: (c) => `ออร์เดอร์ ${c.code} หมดเวลาชำระและถูกยกเลิกอัตโนมัติ ${c.campaign ? `แคมเปญ ${c.campaign} ` : ''}สั่งใหม่ได้ค่ะ`,
  shipped: (c) => `ส่งพัสดุ ${c.code} แล้ว ขนส่ง ${c.carrier || '-'} เลขพัสดุ ${c.tracking || '-'}`,
  delivered: (c) => `พัสดุ ${c.code} ถึงปลายทางแล้วค่ะ ขอบคุณที่ใช้บริการ`,
  balance_due: (c) => `${c.code} ต้องชำระยอดที่เหลือ ${money(c.due)} บาท ก่อนจัดส่ง {LINK}`,
  return_requested: (c) => `ได้รับคำขอคืนสินค้า ${c.code} แล้ว ร้านจะตรวจและแจ้งผลค่ะ`,
  refunded: (c) => `คืนเงิน ${money(c.refund)} บาท สำหรับ ${c.code} เรียบร้อยแล้วค่ะ`,
}

// ข้อความของเหตุการณ์หนึ่ง · ctx = { code, due, paid, refund, payDueAt, carrier, tracking, campaign }
export function notifyText(event, ctx = {}) {
  const f = T[event]
  if (!f) throw new Error('unknown_event')
  return f({ ...ctx, code: String(ctx.code ?? '') }).replace(/\s+/g, ' ').trim()
}

// ตรวจก่อนส่ง: ความยาว SMS และไม่มีตัวแปรที่ยังไม่ถูกแทนที่
export function smsOk(text) {
  return typeof text === 'string' && text.length <= SMS_MAX && !text.includes('undefined') && !text.includes('NaN')
}
