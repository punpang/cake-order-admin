// ข้อความแจ้งลูกค้าสั่งล่วงหน้า (ฟังก์ชันล้วน) · ใช้ทั้งแอปและ Edge Function ผ่าน schedlib
// ไม่มีรหัสออร์เดอร์ที่เปิดข้อมูลได้เอง ลิงก์ใช้ {LINK} ให้ระบบแทนที่ตอนส่ง (หน้า "ออร์เดอร์ของฉัน" ต้องยืนยัน OTP)
// ข้อความ SMS ไม่เกิน 300 ตัวอักษร

export const EVENTS = ['placed', 'paid', 'reminder1h', 'extend_requested', 'extended', 'cancelled', 'expired', 'shipped', 'delivered', 'balance_due', 'return_requested', 'refunded']
export const SMS_MAX = 300
const money = (n) => (Number(n) || 0).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
const day = (s) => (s ? new Date(`${s}T00:00:00+07:00`).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok' }) : '')
const time = (s) => (s ? new Date(s).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' }) : '')

const T = {
  placed: (c) => `ขอบคุณที่เลือกสั่งสินค้ากับเราค่ะ ออเดอร์ ${c.code} ได้รับการยืนยันแล้ว กรุณาชำระมัดจำ ${money(c.due)} บาท ภายใน ${time(c.payDueAt)} ที่ ${'{LINK}'} ขอบพระคุณค่ะ`,
  paid: (c) => `ขอบพระคุณค่ะ ร้านได้รับการชำระเงินสำหรับออเดอร์ ${c.code} เรียบร้อยแล้ว ยอดที่ชำระรวม ${money(c.paid)} บาท`,
  reminder1h: (c) => `เรียนแจ้งเตือนค่ะ ออเดอร์ ${c.code} ยังมียอดคงค้าง ${money(c.due)} บาท กรุณาชำระภายใน ${time(c.payDueAt)} เพื่อรักษาการจองของท่าน ${'{LINK}'} ขอบพระคุณค่ะ`,
  extend_requested: (c) => `ร้านได้รับคำขอเลื่อนเวลาชำระของออเดอร์ ${c.code} แล้วค่ะ ทางร้านจะพิจารณาและแจ้งผลให้ทราบโดยเร็ว ${'{LINK}'}`,
  extended: (c) => `ร้านอนุมัติการเลื่อนเวลาชำระของออเดอร์ ${c.code} ถึง ${time(c.payDueAt)} เรียบร้อยแล้วค่ะ ${'{LINK}'} ขอบพระคุณค่ะ`,
  cancelled: (c) => `ขออภัยค่ะ ออเดอร์ ${c.code} ได้รับการยกเลิกแล้ว${c.refund ? ` ทางร้านจะดำเนินการคืนเงิน ${money(c.refund)} บาท` : ''} หากมีข้อสงสัย ยินดีให้ความช่วยเหลือค่ะ`,
  expired: (c) => `ออเดอร์ ${c.code} ถูกยกเลิกอัตโนมัติ เนื่องจากเกินกำหนดการชำระเงิน หากประสงค์จะสั่งซื้ออีกครั้ง ยินดีให้บริการเสมอค่ะ`,
  shipped: (c) => `ร้านได้จัดส่งออเดอร์ ${c.code} เรียบร้อยแล้วค่ะ ขนส่ง ${c.carrier || '-'} เลขพัสดุ ${c.tracking || '-'} ขอบพระคุณที่ไว้วางใจค่ะ`,
  delivered: (c) => `ออเดอร์ ${c.code} จัดส่งถึงปลายทางเรียบร้อยแล้วค่ะ ขอบพระคุณที่ไว้วางใจเลือกใช้บริการค่ะ`,
  balance_due: (c) => `ออเดอร์ ${c.code} มียอดคงเหลือ ${money(c.due)} บาท กรุณาชำระก่อนการจัดส่งค่ะ ${'{LINK}'} ขอบพระคุณค่ะ`,
  return_requested: (c) => `ร้านได้รับคำขอคืนสินค้าของออเดอร์ ${c.code} แล้วค่ะ ทีมงานจะตรวจสอบและแจ้งผลให้ทราบค่ะ`,
  refunded: (c) => `ร้านดำเนินการคืนเงิน ${money(c.refund)} บาท สำหรับออเดอร์ ${c.code} เรียบร้อยแล้วค่ะ ขอบพระคุณที่เข้าใจค่ะ`,
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
