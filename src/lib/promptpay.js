// PromptPay (Thai QR Payment / EMVCo) · ฟังก์ชันล้วน ไม่ต้องเชื่อมภายนอก
// id: เบอร์มือถือ 10 หลัก (0xxxxxxxxx) | เลขบัตรประชาชน/ภาษี 13 หลัก | e-Wallet 15 หลัก

export const digitsOf = (s) => String(s ?? '').replace(/\D/g, '')

// ชนิดของ id (null = ใช้ไม่ได้)
export function promptPayKind(id) {
  const d = digitsOf(id)
  if (/^0[689]\d{8}$/.test(d)) return 'phone'
  if (/^\d{13}$/.test(d)) return 'national'
  if (/^\d{15}$/.test(d)) return 'ewallet'
  return null
}

// CRC16-CCITT-FALSE (poly 0x1021, init 0xFFFF)
export function crc16(str) {
  let crc = 0xffff
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

const tlv = (tag, value) => `${tag}${String(value.length).padStart(2, '0')}${value}`

// สร้าง payload สำหรับ QR · amount ไม่ใส่ = QR ใช้ซ้ำ (static) ไม่ล็อกยอด
// ref (ไม่บังคับ) = รหัสอ้างอิง 1 (เช่น เลขออร์เดอร์) → แอปธนาคารบางแห่งกรอกให้ในสลิป · สูงสุด 25 ตัวอักษร
export function promptPayPayload(id, amount = null, ref = '') {
  const kind = promptPayKind(id)
  if (!kind) return null
  const d = digitsOf(id)
  const target = kind === 'phone' ? tlv('01', `0066${d.slice(1)}`) : kind === 'national' ? tlv('02', d) : tlv('03', d)
  const amt = amount == null || amount === '' ? null : Math.round(Number(amount) * 100) / 100
  if (amt != null && (!Number.isFinite(amt) || amt <= 0 || amt > 9999999.99)) return null
  const body =
    tlv('00', '01') +
    tlv('01', amt == null ? '11' : '12') +
    tlv('29', tlv('00', 'A000000677010111') + target) +
    tlv('58', 'TH') +
    tlv('53', '764') +
    (amt == null ? '' : tlv('54', amt.toFixed(2))) +
    (ref ? tlv('62', tlv('05', String(ref).replace(/[^A-Za-z0-9-]/g, '').slice(0, 25))) : '') +
    '6304'
  return body + crc16(body)
}

// PromptPay Biller (ชำระผ่านผู้เรียกเก็บเงิน): tag 30 · AID A000000677010112
//   01 = Biller ID ของร้าน (ผู้เรียกเก็บเงิน 15 หลัก) · 02 = Ref 1 = รหัสร้านค้า (ตัวเลข) · 03 = Ref 2 = รหัสอ้างอิง POS/ORD
// โครงนี้ตรงกับ QR ที่ธนาคารรับได้และแสดงเป็น "รหัสร้านค้า" + "รหัสอ้างอิงร้านค้า" (ตัวอย่าง Biller ID 010753600010286 · รหัสร้านค้า 014000000517185 · POS123927229)
export const billerIdOf = (s) => {
  const d = digitsOf(s)
  return /^\d{15}$/.test(d) ? d : ''
}

// รหัสอ้างอิงร้านค้า: POS หรือ ORD ตามด้วยตัวเลข ไม่มีขีด (ตรงกับ shopRefOk ฝั่งเซิร์ฟเวอร์ _shared/slipref.ts)
export const shopRefOk = (v) => /^(POS|ORD)\d{3,17}$/.test(String(v ?? ''))

// รหัสออร์เดอร์/POS แบบมีขีด → รหัสอ้างอิงที่ฝังใน QR (OR-131126-000123 → ORD131126000123) · ตรงกับ refOfCode ฝั่งเซิร์ฟเวอร์
export const shopRefOfCode = (code) =>
  String(code ?? '').trim().toUpperCase().replace(/^OR-/, 'ORD').replace(/^POS-/, 'POS').replace(/-/g, '')

// รหัสร้านค้า (Ref 1): ตัวเลข 1–20 หลัก · ว่าง/ผิดรูป = ไม่ใช่รหัสที่ใช้ได้
export const shopCodeOf = (s) => {
  const d = digitsOf(s)
  return /^\d{1,20}$/.test(d) ? d : ''
}

// QR พร้อมเพย์แบบ Biller · ยอดว่าง = ไม่ล็อกยอด · ข้อมูลไม่ถูกต้อง (Biller ID / รหัสร้านค้า / รหัสอ้างอิง / ยอด) = null
export function promptPayBillerPayload(billerId, amount = null, ref = '', shopCode = '') {
  const id = billerIdOf(billerId)
  const r = String(ref ?? '').trim().toUpperCase()
  const c = shopCodeOf(shopCode)
  if (!id || !c || !shopRefOk(r)) return null
  const amt = amount == null || amount === '' ? null : Math.round(Number(amount) * 100) / 100
  if (amt != null && (!Number.isFinite(amt) || amt <= 0 || amt > 9999999.99)) return null
  const body =
    tlv('00', '01') +
    tlv('01', amt == null ? '11' : '12') +
    tlv('30', tlv('00', 'A000000677010112') + tlv('01', id) + tlv('02', c) + tlv('03', r)) +
    tlv('53', '764') +
    (amt == null ? '' : tlv('54', amt.toFixed(2))) +
    tlv('58', 'TH') +
    '6304'
  return body + crc16(body)
}
