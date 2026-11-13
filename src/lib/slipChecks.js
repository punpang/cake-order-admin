// เครื่องหมายตรวจสลิปเทียบกับออร์เดอร์ (ฟังก์ชันล้วน · ใช้ทั้งแอปและเซิร์ฟเวอร์ผ่านสำเนา schedlib)
// ✓ = ผ่าน · ✗ = ไม่ผ่าน · null = ไม่มีข้อมูลให้ตรวจ
//  - ยอด: ไม่เกินยอดค้างของออร์เดอร์
//  - วัน-เวลาที่ชำระ: ต้องหลังเวลาสร้างออร์เดอร์ (เทียบเป็นนาที · เวลาไทย) · บิล POS ยังข้ามไปก่อน
//  - รหัสร้านค้า (Ref 1): ตรงกับรหัสร้านค้าที่ตั้งไว้ (ยังไม่ตั้ง = ไม่ตรวจ)
//  - รหัสอ้างอิงร้านค้า (Ref 2 = POS/ORD): ตรงกับรหัสอ้างอิงของออร์เดอร์นี้ (OR-ddmmyy-xxxxxx ↔ ORDddmmyyxxxxxx)
const THAI_OFFSET = '+07:00'
const digitsOf = (v) => String(v ?? '').replace(/\D/g, '')
const normRef = (v) => String(v ?? '').toUpperCase().replace(/[\s-]/g, '')

// รหัสอ้างอิงของเลขออร์เดอร์ (แปลงจากเลขเดิม ไม่เก็บเพิ่ม)
export const refOfOrderCode = (code) => String(code || '').replace(/^OR-/, 'ORD').replace(/^POS-/, 'POS').replace(/-/g, '')

// fields = ค่าที่อ่านจากสลิป { amount, paidAt, merchantCode, shopRef } · order = { code, createdAt } · balance = ยอดค้างของออร์เดอร์
/**
 * @param {{ fields?: object | null, order?: { code?: string, createdAt?: string | null } | null, configuredMerchantCode?: string, balance?: number | null }} [opts]
 */
export function slipChecksOf({ fields, order = null, configuredMerchantCode = '', balance = null } = {}) {
  const f = fields || {}
  const out = []

  if (f.amount == null) out.push({ key: 'amount', ok: null, text: 'ไม่ได้อ่านยอดจากสลิป' })
  else if (balance == null) out.push({ key: 'amount', ok: null, text: 'ยังไม่มียอดค้างให้เทียบ' })
  else {
    const ok = f.amount > 0 && f.amount <= balance + 0.004
    out.push({ key: 'amount', ok, text: ok ? 'ยอดไม่เกินยอดค้าง' : 'ยอดเกินยอดค้างของออร์เดอร์' })
  }

  const paidMs = f.paidAt ? Date.parse(`${f.paidAt}${THAI_OFFSET}`) : NaN
  const createdMs = order?.createdAt ? Date.parse(order.createdAt) : NaN
  if (!Number.isFinite(paidMs)) out.push({ key: 'paidAt', ok: null, text: 'ไม่ได้อ่านวัน-เวลาจากสลิป' })
  else if (!Number.isFinite(createdMs)) out.push({ key: 'paidAt', ok: null, text: 'ยังไม่มีเวลาสร้างออร์เดอร์ให้เทียบ' })
  else {
    const ok = Math.floor(paidMs / 60000) > Math.floor(createdMs / 60000)
    out.push({ key: 'paidAt', ok, text: ok ? 'โอนหลังเวลาสร้างออร์เดอร์' : 'โอนก่อนเวลาสร้างออร์เดอร์' })
  }

  if (!digitsOf(configuredMerchantCode)) out.push({ key: 'merchant', ok: null, text: 'ยังไม่ได้ตั้งรหัสร้านค้า' })
  else if (!digitsOf(f.merchantCode)) out.push({ key: 'merchant', ok: false, text: 'อ่านรหัสร้านค้าในสลิปไม่ได้' })
  else {
    const ok = digitsOf(f.merchantCode) === digitsOf(configuredMerchantCode)
    out.push({ key: 'merchant', ok, text: ok ? 'รหัสร้านค้าตรงกับของร้าน' : 'รหัสร้านค้าในสลิปไม่ตรงกับของร้าน' })
  }

  if (!f.shopRef) out.push({ key: 'shopRef', ok: null, text: 'ไม่มีรหัสอ้างอิงร้านค้าในสลิป' })
  else if (!order?.code) out.push({ key: 'shopRef', ok: null, text: 'ยังไม่มีออร์เดอร์ให้เทียบรหัสอ้างอิง' })
  else {
    const ok = normRef(f.shopRef) === refOfOrderCode(order.code)
    out.push({ key: 'shopRef', ok, text: ok ? 'รหัสอ้างอิงตรงกับออร์เดอร์นี้' : 'รหัสอ้างอิงไม่ตรงกับออร์เดอร์นี้' })
  }

  return out
}
