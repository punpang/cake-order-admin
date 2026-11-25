// ข้อความแจ้งลูกค้าสั่งล่วงหน้า (ฟังก์ชันล้วน) · ใช้ทั้งแอปและ Edge Function ผ่าน schedlib
// ไม่มีรหัสออร์เดอร์ที่เปิดข้อมูลได้เอง ลิงก์ใช้ {LINK} ให้ระบบแทนที่ตอนส่ง (หน้า "ออร์เดอร์ของฉัน" ต้องยืนยัน OTP)
// ข้อความ SMS ไม่เกิน 300 ตัวอักษร

export const EVENTS = ['placed', 'paid', 'reminder1h', 'extend_requested', 'extended', 'cancelled', 'expired', 'shipped', 'delivered', 'balance_due', 'return_requested', 'refunded']
export const SMS_MAX = 300
const money = (n) => (Number(n) || 0).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
const day = (s) => (s ? new Date(`${s}T00:00:00+07:00`).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok' }) : '')
const time = (s) => (s ? new Date(s).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' }) : '')

const T = {
  placed: (c) => `ได้รับออเดอร์ ${c.code} แล้วค่ะ กรุณาชำระมัดจำ ${money(c.due)} บาท ภายใน ${time(c.payDueAt)} ที่ ${'{LINK}'} ขอบคุณค่ะ`,
  paid: (c) => `ได้รับเงินแล้วค่ะ ออเดอร์ ${c.code} ชำระรวม ${money(c.paid)} บาท ขอบคุณค่ะ`,
  reminder1h: (c) => `ออเดอร์ ${c.code} ยังค้างชำระ ${money(c.due)} บาท กรุณาชำระภายใน ${time(c.payDueAt)} ${'{LINK}'} ขอบคุณค่ะ`,
  extend_requested: (c) => `รับคำขอเลื่อนเวลาชำระของออเดอร์ ${c.code} แล้วค่ะ ร้านจะแจ้งผลโดยเร็วที่สุด ${'{LINK}'}`,
  extended: (c) => `ร้านเลื่อนเวลาชำระออเดอร์ ${c.code} เป็น ${time(c.payDueAt)} แล้วค่ะ ${'{LINK}'}`,
  cancelled: (c) => `ออเดอร์ ${c.code} ถูกยกเลิกแล้วค่ะ${c.refund ? ` ร้านจะคืนเงิน ${money(c.refund)} บาท` : ''} มีข้อสงสัยสอบถามร้านได้เลยค่ะ`,
  expired: (c) => `ออเดอร์ ${c.code} ถูกยกเลิกอัตโนมัติ เพราะเลยเวลาชำระแล้วค่ะ สั่งใหม่ได้เลยค่ะ`,
  shipped: (c) => `ออเดอร์ ${c.code} ส่งแล้วค่ะ ขนส่ง ${c.carrier || '-'} เลขพัสดุ ${c.tracking || '-'}`,
  delivered: (c) => `ออเดอร์ ${c.code} ส่งถึงแล้วค่ะ ขอบคุณที่อุดหนุนค่ะ`,
  balance_due: (c) => `ออเดอร์ ${c.code} ยังเหลือ ${money(c.due)} บาท กรุณาชำระก่อนจัดส่ง ${'{LINK}'} ขอบคุณค่ะ`,
  return_requested: (c) => `รับคำขอคืนสินค้าของออเดอร์ ${c.code} แล้วค่ะ ทีมงานจะตรวจสอบและแจ้งผลค่ะ`,
  refunded: (c) => `ร้านคืนเงิน ${money(c.refund)} บาท สำหรับออเดอร์ ${c.code} แล้วค่ะ ขอบคุณค่ะ`,
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
