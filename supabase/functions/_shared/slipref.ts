// รหัสอ้างอิงร้านค้าบนสลิป (ORD / POS) และรหัสร้านค้าผู้รับชำระ · ฟังก์ชันล้วน ทดสอบได้
// รหัสอ้างอิงแปลงจากเลขเดิมในระบบ (ไม่เก็บเพิ่ม): OR-ddmmyy-xxxxxx ↔ ORDddmmyyxxxxxx · POS-ddmmyy-xxxxx ↔ POSddmmyyxxxxx

// รหัสอ้างอิงของเลขเดิม (รูปแบบที่ร้านให้ลูกค้าใช้อ้างอิง)
export const refOfCode = (code: string): string => String(code || '').replace(/^OR-/, 'ORD').replace(/^POS-/, 'POS').replace(/-/g, '')

// ตัดช่องว่างและขีด เป็นตัวพิมพ์ใหญ่
export function normalizeShopRef(v: unknown): string {
  return String(v ?? '').toUpperCase().replace(/[\s-]/g, '')
}
// รูปแบบรหัสอ้างอิงที่รับ: POS หรือ ORD ตามด้วยตัวเลข
export const shopRefOk = (v: string): boolean => /^(POS|ORD)\d{3,}$/.test(v)

// รหัสอ้างอิงบนสลิป → เลขเดิมในระบบ · รูปแบบไม่ตรงกับเลขในระบบ = null
export function codeOfRef(ref: unknown): string | null {
  const s = normalizeShopRef(ref)
  const o = s.match(/^ORD(\d{6})(\d{6})$/)
  if (o) return `OR-${o[1]}-${o[2]}`
  const p = s.match(/^POS(\d{6})(\d{5})$/)
  if (p) return `POS-${p[1]}-${p[2]}`
  return null
}

// รหัสร้านค้า: เก็บเฉพาะตัวเลข
export const digitsOf = (v: unknown): string => String(v ?? '').replace(/\D/g, '')

// ติดธงเมื่อตั้งรหัสร้านค้าไว้แล้ว และรหัสที่อ่านได้ไม่ตรง (หรืออ่านไม่ได้) · ยังไม่ตั้งรหัส = ไม่ตรวจ
export function merchantMismatch(configured: unknown, read: unknown): boolean {
  const want = digitsOf(configured)
  if (!want) return false
  return digitsOf(read) !== want
}

// รหัสร้านค้าที่อ่านได้ใช้ไม่ได้ (ทิ้งเป็นค่าว่าง) เมื่อ
// - ซ้ำกับเลขบัญชีผู้รับ (ตัวอ่านมักสลับสองค่านี้)
// - เป็นตัวเลขจากรหัสอ้างอิงร้านค้า เช่น POS123927229 → 123927229
export function merchantCodeOk(mc: string, receiverAccount: unknown, shopRef: string): boolean {
  if (mc.length < 6) return false
  if (digitsOf(receiverAccount) === mc) return false
  const refDigits = digitsOf(shopRef)
  if (refDigits && refDigits.includes(mc)) return false
  return true
}

// ค่าจากคำตอบของตัวอ่าน (merchant_code / shop_ref) · ใส่คีย์เฉพาะเมื่อผ่านเกณฑ์ (ผลเดิมรูปร่างไม่เปลี่ยน)
export function readShopFields(obj: any, receiverAccount?: string | null): { merchantCode?: string; shopRef?: string } {
  const mc = digitsOf(obj?.merchant_code)
  const sr = normalizeShopRef(obj?.shop_ref)
  const shopRef = shopRefOk(sr) ? sr : ''
  const merchantCode = merchantCodeOk(mc, receiverAccount, shopRef) ? mc : ''
  return { ...(merchantCode ? { merchantCode } : {}), ...(shopRef ? { shopRef } : {}) }
}

// ค่าที่เก็บในแคชและชุดเทรน: เฉพาะคีย์ที่มีค่า
export function shopPartOf(f: { merchantCode?: unknown; shopRef?: unknown } | null | undefined): { merchantCode?: string; shopRef?: string } {
  const mc = digitsOf(f?.merchantCode)
  const sr = normalizeShopRef(f?.shopRef)
  return { ...(mc ? { merchantCode: mc } : {}), ...(sr ? { shopRef: sr } : {}) }
}
