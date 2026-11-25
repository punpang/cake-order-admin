// ข้อความแจ้งลูกค้าสั่งล่วงหน้า (ฟังก์ชันล้วน) · ใช้ทั้งแอปและ Edge Function ผ่าน schedlib
// ไม่มีรหัสออร์เดอร์ที่เปิดข้อมูลได้เอง ลิงก์ใช้ {LINK} ให้ระบบแทนที่ตอนส่ง (หน้า "ออร์เดอร์ของฉัน" ต้องยืนยัน OTP)
// ข้อความ SMS ไม่เกิน 300 ตัวอักษร

export const EVENTS = ['placed', 'paid', 'reminder1h', 'extend_requested', 'extended', 'cancelled', 'expired', 'shipped', 'delivered', 'balance_due', 'return_requested', 'refunded']
export const SMS_MAX = 300
const money = (n) => (Number(n) || 0).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
const day = (s) => (s ? new Date(`${s}T00:00:00+07:00`).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok' }) : '')
const time = (s) => (s ? new Date(s).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' }) : '')

const T = {
  placed: (c) => `ขอบคุณนะคะ ได้รับออเดอร์ ${c.code} แล้ว รบกวนชำระมัดจำ ${money(c.due)} บาท ภายใน ${time(c.payDueAt)} ตามลิงก์นี้ ${'{LINK}'}`,
  paid: (c) => `ได้รับเงินแล้วค่ะ ออเดอร์ ${c.code} ชำระรวม ${money(c.paid)} บาท ขอบคุณนะคะ`,
  reminder1h: (c) => `ใกล้ถึงเวลาแล้วนะคะ ออเดอร์ ${c.code} ยังค้าง ${money(c.due)} บาท รบกวนชำระภายใน ${time(c.payDueAt)} ${'{LINK}'}`,
  extend_requested: (c) => `ได้รับเรื่องขอเลื่อนเวลาชำระของออเดอร์ ${c.code} แล้วค่ะ เดี๋ยวทางร้านดูให้และแจ้งกลับนะคะ ${'{LINK}'}`,
  extended: (c) => `เลื่อนเวลาชำระออเดอร์ ${c.code} ให้ถึง ${time(c.payDueAt)} แล้วค่ะ ${'{LINK}'}`,
  cancelled: (c) => `ขออภัยนะคะ ออเดอร์ ${c.code} ยกเลิกแล้ว${c.refund ? ` ทางร้านจะคืนเงิน ${money(c.refund)} บาทให้นะคะ` : ''} มีอะไรถามได้เลยค่ะ`,
  expired: (c) => `ออเดอร์ ${c.code} เลยเวลาชำระไปแล้วค่ะ ระบบเลยยกเลิกให้อัตโนมัติ ถ้ายังอยากได้ สั่งใหม่ได้เลยนะคะ`,
  shipped: (c) => `ส่งออเดอร์ ${c.code} ให้แล้วค่ะ ขนส่ง ${c.carrier || '-'} เลขพัสดุ ${c.tracking || '-'} รับของด้วยนะคะ`,
  delivered: (c) => `ออเดอร์ ${c.code} ส่งถึงที่หมายแล้วค่ะ ขอบคุณที่อุดหนุนนะคะ`,
  balance_due: (c) => `ออเดอร์ ${c.code} ยังเหลืออีก ${money(c.due)} บาท รบกวนชำระก่อนส่งของนะคะ ${'{LINK}'}`,
  return_requested: (c) => `ได้รับเรื่องคืนสินค้าของออเดอร์ ${c.code} แล้วค่ะ ทางร้านจะตรวจแล้วแจ้งกลับนะคะ`,
  refunded: (c) => `คืนเงิน ${money(c.refund)} บาทสำหรับออเดอร์ ${c.code} เรียบร้อยแล้วค่ะ ขอบคุณที่เข้าใจนะคะ`,
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
