// คูปองลดเป็นบาทที่ลูกค้าสร้างเองจากคะแนน (ฟังก์ชันล้วน ใช้ทั้งหน้าลูกค้าและเทสต์)
// กติกา (ตรงกับ punpang_cust_make_coupon ฝั่งเซิร์ฟเวอร์): ขั้นต่ำ 10 บาท เป็นทวีคูณของ 10 · ไม่จำกัดเพดาน
// คะแนนที่ใช้ = มูลค่า ÷ มูลค่าต่อ 1 คะแนน ต้องลงตัวพอดี (ไม่ลงตัวไม่ให้แลก) · อายุ 15 วันนับจากวันที่สร้าง
export const POINTS_COUPON = { min: 10, step: 10, days: 15 }
export const POINTS_COUPON_MSG = {
  invalid: `มูลค่าต้องเป็นทวีคูณของ ${POINTS_COUPON.step} บาท (ขั้นต่ำ ${POINTS_COUPON.min} บาท)`,
  not_divisible: 'มูลค่านี้แปลงเป็นคะแนนไม่ลงตัว กรุณาเลือกมูลค่าอื่น',
  insufficient: 'คะแนนไม่พอ',
}
const EPS = 1e-9

// คืน { ok, points, reason } · reason ว่างเมื่อผ่าน · ไม่ผ่านให้ใช้ POINTS_COUPON_MSG[reason]
export function pointsCouponQuote(amount, pointValue, balance) {
  const a = Number(amount)
  if (!Number.isFinite(a) || a < POINTS_COUPON.min || a % POINTS_COUPON.step !== 0) return { ok: false, points: 0, reason: 'invalid' }
  const pv = Number(pointValue) > 0 ? Number(pointValue) : 1
  const raw = a / pv
  const points = Math.round(raw)
  if (Math.abs(raw - points) > EPS) return { ok: false, points: 0, reason: 'not_divisible' }
  if (points > (Number(balance) || 0)) return { ok: false, points, reason: 'insufficient' }
  return { ok: true, points, reason: '' }
}
