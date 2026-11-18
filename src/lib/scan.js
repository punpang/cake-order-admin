// รหัสสแกนของคูปอง (บาร์โค้ด Code128 · เครื่องสแกน USB ส่งค่ามาเหมือนพิมพ์ แล้วกด Enter)
// ค่าที่ใส่ในบาร์โค้ดคือรหัสคูปองตรง ๆ (ตัวอักษรและตัวเลขล้วน จึงอ่านได้ทุกเครื่อง)
export const COUPON_SCAN_RE = /^cp[0-9a-z]{1,60}$/

export const couponScanValue = (c) => String(c?.id ?? '')

// คืนคูปองที่ตรงกับค่าที่สแกน หรือ null (ค่าว่าง/รูปแบบผิด/ไม่พบ)
export function resolveCouponScan(raw, coupons = []) {
  const v = String(raw ?? '').trim()
  if (!COUPON_SCAN_RE.test(v)) return null
  return coupons.find((c) => c.id === v) || null
}
