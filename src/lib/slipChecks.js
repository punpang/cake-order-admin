// เครื่องหมายตรวจสลิปเทียบกับออร์เดอร์ (ฟังก์ชันล้วน · ใช้ทั้งแอปและเซิร์ฟเวอร์ผ่านสำเนา schedlib)
// ✓ = ผ่าน · ✗ = ไม่ผ่าน · null = ไม่มีข้อมูลให้ตรวจ
//  - ยอด: ไม่เกินยอดค้างของออร์เดอร์
//  - วัน-เวลาที่ชำระ: ต้องหลังเวลาสร้างออร์เดอร์ (เทียบเป็นนาที · เวลาไทย) · บิล POS ยังข้ามไปก่อน
//  - รหัสร้านค้า: ตรงกับรหัสร้านค้าที่ตั้งไว้ (ยังไม่ตั้ง = ไม่ตรวจ)
//  - รหัสอ้างอิงร้านค้า (Ref 1): ตรงกับรหัสอ้างอิงของออร์เดอร์นี้ (OR-ddmmyy-xxxxxx ↔ ORDddmmyyxxxxxx)
//  - รหัสสุ่ม (Ref 2): ตรงกับรายการแจ้งชำระของออร์เดอร์นี้ และยอดในสลิปเท่ากับยอดของรายการนั้น
const THAI_OFFSET = '+07:00'
const digitsOf = (v) => String(v ?? '').replace(/\D/g, '')
const normRef = (v) => String(v ?? '').toUpperCase().replace(/[\s-]/g, '')

// รหัสอ้างอิงของเลขออร์เดอร์ (แปลงจากเลขเดิม ไม่เก็บเพิ่ม)
export const refOfOrderCode = (code) => String(code || '').replace(/^OR-/, 'ORD').replace(/^POS-/, 'POS').replace(/-/g, '')

// fields = ค่าที่อ่านจากสลิป { amount, paidAt, merchantCode, shopRef, qrRef } · order = { code, createdAt } · balance = ยอดค้างของออร์เดอร์
// request = รายการแจ้งชำระของออร์เดอร์นี้ที่มีรหัสสุ่ม (Ref 2) ตรงกับสลิป { qrRef, amount } · ไม่พบ = null
/**
 * @param {{ fields?: object | null, order?: { code?: string, createdAt?: string | null } | null, configuredMerchantCode?: string, balance?: number | null, request?: { qrRef?: string, amount?: number } | null }} [opts]
 */
export function slipChecksOf({ fields, order = null, configuredMerchantCode = '', balance = null, request = null } = {}) {
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

  // รหัสร้านค้าแสดงให้พนักงานเห็นเท่านั้น (info) · ไม่นับเป็นเงื่อนไขผูก/ยืนยันอัตโนมัติ
  if (!digitsOf(configuredMerchantCode)) out.push({ key: 'merchant', ok: null, text: 'ยังไม่ได้ตั้งรหัสร้านค้า', info: true })
  else if (!digitsOf(f.merchantCode)) out.push({ key: 'merchant', ok: false, text: 'อ่านรหัสร้านค้าในสลิปไม่ได้', info: true })
  else {
    const ok = digitsOf(f.merchantCode) === digitsOf(configuredMerchantCode)
    out.push({ key: 'merchant', ok, text: ok ? 'รหัสร้านค้าตรงกับของร้าน' : 'รหัสร้านค้าในสลิปไม่ตรงกับของร้าน', info: true })
  }

  if (!f.shopRef) out.push({ key: 'shopRef', ok: null, text: 'ไม่มีรหัสอ้างอิงร้านค้าในสลิป' })
  else if (!order?.code) out.push({ key: 'shopRef', ok: null, text: 'ยังไม่มีออร์เดอร์ให้เทียบรหัสอ้างอิง' })
  else {
    const ok = normRef(f.shopRef) === refOfOrderCode(order.code)
    out.push({ key: 'shopRef', ok, text: ok ? 'รหัสอ้างอิงตรงกับออร์เดอร์นี้' : 'รหัสอ้างอิงไม่ตรงกับออร์เดอร์นี้' })
  }

  // รหัสสุ่ม (Ref 2) ต้องตรงกับรายการแจ้งชำระของออร์เดอร์นี้ และยอดในสลิปต้องเท่ากับยอดของรายการนั้น
  if (!f.qrRef) out.push({ key: 'qrRef', ok: null, text: 'ไม่มีรหัสสุ่ม (Ref 2) ในสลิป' })
  else if (!request?.qrRef) out.push({ key: 'qrRef', ok: false, text: 'ไม่พบรายการแจ้งชำระที่มีรหัสสุ่มนี้' })
  else {
    const sameRef = normRef(f.qrRef) === normRef(request.qrRef)
    const sameAmount = f.amount != null && Math.abs(Number(f.amount) - Number(request.amount)) < 0.005
    const ok = sameRef && sameAmount
    out.push({ key: 'qrRef', ok, text: ok ? 'รหัสสุ่มและยอดตรงกับรายการแจ้งชำระ' : 'รหัสสุ่มหรือยอดไม่ตรงกับรายการแจ้งชำระ' })
  }

  return out
}
