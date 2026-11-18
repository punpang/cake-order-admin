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

// รหัสสมาชิก (ค่าสุ่ม 32 ตัว hex เก็บใน customer.scanCode) สำหรับบาร์โค้ดให้พนักงานสแกนที่ POS
export const MEMBER_SCAN_RE = /^[0-9a-f]{32}$/

export function newMemberScanCode() {
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
}

// คืนลูกค้าที่มีรหัสสมาชิกตรงกับค่าที่สแกน (ไม่รวมบัญชีที่ลบหรือปิดใช้งาน) หรือ null
export function resolveMemberScan(raw, customers = []) {
  const v = String(raw ?? '').trim()
  if (!MEMBER_SCAN_RE.test(v)) return null
  return customers.find((c) => c.scanCode === v && !c.deleted && c.active !== false) || null
}
