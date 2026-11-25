// ข้อความแจ้งลูกค้าสั่งล่วงหน้า (ฟังก์ชันล้วน) · ใช้ทั้งแอปและ Edge Function ผ่าน schedlib
// ไม่มีรหัสออร์เดอร์ที่เปิดข้อมูลได้เอง ลิงก์ใช้ {LINK} ให้ระบบแทนที่ตอนส่ง (หน้า "ออร์เดอร์ของฉัน" ต้องยืนยัน OTP)
// ข้อความ SMS ไม่เกิน 300 ตัวอักษร

export const EVENTS = ['placed', 'paid', 'reminder1h', 'extend_requested', 'extended', 'cancelled', 'expired', 'shipped', 'delivered', 'balance_due', 'return_requested', 'refunded']
export const SMS_MAX = 300
const money = (n) => (Number(n) || 0).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
const day = (s) => (s ? new Date(`${s}T00:00:00+07:00`).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok' }) : '')
const time = (s) => (s ? new Date(s).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' }) : '')

const T = {
  placed: (c) => `ขอบคุณที่สั่งสินค้าค่ะ ออเดอร์ ${c.code} ได้รับแล้ว กรุณาชำระมัดจำ ${money(c.due)} บาท ภายใน ${time(c.payDueAt)} ${'{LINK}'} ขอบคุณค่ะ`,
  paid: (c) => `ขอบคุณค่ะ ร้านได้รับการชำระเงินสำหรับออเดอร์ ${c.code} เรียบร้อยแล้ว ยอดที่ชำระรวม ${money(c.paid)} บาท`,
  reminder1h: (c) => `สวัสดีค่ะ ขอเรียนแจ้งว่าออเดอร์ ${c.code} ยังชำระไม่ครบ ยอดค้าง ${money(c.due)} บาท กรุณาชำระภายใน ${time(c.payDueAt)} ${'{LINK}'} ขอบคุณค่ะ`,
  extend_requested: (c) => `ขอบคุณที่แจ้งค่ะ ร้านได้รับคำขอขยายเวลาชำระของออเดอร์ ${c.code} แล้ว ทางร้านจะแจ้งผลให้ทราบเร็วที่สุดค่ะ ${'{LINK}'}`,
  extended: (c) => `ร้านขยายเวลาชำระออเดอร์ ${c.code} ให้ถึง ${time(c.payDueAt)} เรียบร้อยแล้วค่ะ ${'{LINK}'} ขอบคุณที่ให้ความร่วมมือค่ะ`,
  cancelled: (c) => `ขออภัยค่ะ ออเดอร์ ${c.code} ถูกยกเลิกแล้ว${c.refund ? ` ร้านจะคืนเงิน ${money(c.refund)} บาท` : ''} หากมีข้อสงสัยสอบถามได้ที่ร้านค่ะ`,
  expired: (c) => `ขออภัยค่ะ ออเดอร์ ${c.code} ถูกยกเลิกอัตโนมัติ เนื่องจากเลยเวลาชำระแล้ว หากสนใจ ยินดีให้สั่งใหม่เสมอค่ะ`,
  shipped: (c) => `ร้านจัดส่งออเดอร์ ${c.code} แล้วค่ะ ขนส่ง ${c.carrier || '-'} เลขพัสดุ ${c.tracking || '-'} ขอบคุณที่ไว้วางใจค่ะ`,
  delivered: (c) => `ออเดอร์ ${c.code} ถึงปลายทางเรียบร้อยแล้วค่ะ หวังว่าจะถูกใจนะคะ ขอบคุณที่อุดหนุนร้านค่ะ`,
  balance_due: (c) => `สวัสดีค่ะ ออเดอร์ ${c.code} ต้องชำระยอดที่เหลือ ${money(c.due)} บาท ก่อนจัดส่งค่ะ ${'{LINK}'} ขอบคุณค่ะ`,
  return_requested: (c) => `ขอบคุณที่แจ้งค่ะ ร้านได้รับคำขอคืนสินค้าของออเดอร์ ${c.code} แล้ว ทีมงานจะตรวจสอบและแจ้งผลให้ทราบค่ะ`,
  refunded: (c) => `ร้านคืนเงิน ${money(c.refund)} บาท สำหรับออเดอร์ ${c.code} เรียบร้อยแล้วค่ะ ขออภัยในความไม่สะดวก และขอบคุณที่เข้าใจค่ะ`,
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
