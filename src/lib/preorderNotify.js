// ข้อความแจ้งลูกค้าสั่งล่วงหน้า (ฟังก์ชันล้วน) · ใช้ทั้งแอปและ Edge Function ผ่าน schedlib
// ไม่มีรหัสออร์เดอร์ที่เปิดข้อมูลได้เอง ลิงก์ใช้ {LINK} ให้ระบบแทนที่ตอนส่ง (หน้า "ออร์เดอร์ของฉัน" ต้องยืนยัน OTP)
// ข้อความ SMS ไม่เกิน 300 ตัวอักษร

export const EVENTS = ['placed', 'paid', 'reminder1h', 'extend_requested', 'extended', 'cancelled', 'expired', 'shipped', 'delivered', 'balance_due', 'return_requested', 'refunded']
export const SMS_MAX = 300
const money = (n) => (Number(n) || 0).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
const day = (s) => (s ? new Date(`${s}T00:00:00+07:00`).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok' }) : '')
const time = (s) => (s ? new Date(s).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' }) : '')

const T = {
  placed: (c) => `ขอขอบพระคุณที่ใช้บริการ ทางร้านได้รับคำสั่งซื้อ ${c.code} แล้ว กรุณาชำระมัดจำ ${money(c.due)} บาท ภายใน ${time(c.payDueAt)} ที่ ${'{LINK}'} ขอบพระคุณค่ะ`,
  paid: (c) => `ทางร้านได้รับการชำระเงินสำหรับคำสั่งซื้อ ${c.code} เรียบร้อยแล้ว ยอดชำระรวม ${money(c.paid)} บาท ขอบพระคุณค่ะ`,
  reminder1h: (c) => `ขอแจ้งเตือนว่าคำสั่งซื้อ ${c.code} ยังมียอดค้างชำระ ${money(c.due)} บาท กรุณาชำระภายใน ${time(c.payDueAt)} ${'{LINK}'} ขอบพระคุณค่ะ`,
  extend_requested: (c) => `ทางร้านได้รับคำขอเลื่อนเวลาชำระของคำสั่งซื้อ ${c.code} แล้วค่ะ จะแจ้งผลให้ทราบโดยเร็วที่สุด ${'{LINK}'}`,
  extended: (c) => `ทางร้านอนุมัติการเลื่อนเวลาชำระของคำสั่งซื้อ ${c.code} เป็น ${time(c.payDueAt)} เรียบร้อยแล้วค่ะ ${'{LINK}'}`,
  cancelled: (c) => `ขออภัยค่ะ คำสั่งซื้อ ${c.code} ได้รับการยกเลิกแล้ว${c.refund ? ` ทางร้านจะดำเนินการคืนเงิน ${money(c.refund)} บาท` : ''} หากมีข้อสงสัยกรุณาติดต่อร้านค่ะ`,
  expired: (c) => `คำสั่งซื้อ ${c.code} ถูกยกเลิกอัตโนมัติ เนื่องจากเกินกำหนดการชำระเงิน หากประสงค์จะสั่งซื้ออีกครั้ง ยินดีให้บริการค่ะ`,
  shipped: (c) => `ทางร้านได้จัดส่งคำสั่งซื้อ ${c.code} แล้วค่ะ ขนส่ง ${c.carrier || '-'} เลขพัสดุ ${c.tracking || '-'}`,
  delivered: (c) => `คำสั่งซื้อ ${c.code} ได้จัดส่งถึงปลายทางเรียบร้อยแล้วค่ะ ขอบพระคุณที่ไว้วางใจใช้บริการค่ะ`,
  balance_due: (c) => `คำสั่งซื้อ ${c.code} มียอดคงเหลือ ${money(c.due)} บาท กรุณาชำระก่อนการจัดส่ง ${'{LINK}'} ขอบพระคุณค่ะ`,
  return_requested: (c) => `ทางร้านได้รับคำขอคืนสินค้าของคำสั่งซื้อ ${c.code} แล้วค่ะ ทีมงานจะตรวจสอบและแจ้งผลให้ทราบค่ะ`,
  refunded: (c) => `ทางร้านได้ดำเนินการคืนเงิน ${money(c.refund)} บาท สำหรับคำสั่งซื้อ ${c.code} เรียบร้อยแล้วค่ะ ขอบพระคุณค่ะ`,
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
