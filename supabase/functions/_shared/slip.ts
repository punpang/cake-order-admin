// สลิปโอนเงินของธนาคารไทย: ฟังก์ชันล้วน ไม่เรียกภายนอก (ใช้ได้ทั้ง Deno และ Node)
// QR บนสลิปคือ "Slip Verify Mini-QR" ของ Thai QR Payment: โครง TLV แบบ EMVCo แต่ใช้ tag ราก 00 (แม่แบบ) / 51 (ประเทศ TH) / 91 (CRC)
// ข้างในมีเพียงรหัสธนาคารผู้ส่ง (sub 01) และเลขอ้างอิงรายการ (sub 02) — ไม่มียอดเงินและผู้รับ
// จึงยืนยันได้เฉพาะ "รูปแบบถูกต้องตามมาตรฐาน" ส่วนยอดเงินที่เข้าจริงต้องตรวจกับธนาคารหรือพนักงานเสมอ
// QR พร้อมเพย์ของร้าน (EMVCo merchant QR: tag 00 = "01", มี tag 63 เป็น CRC) ไม่ใช่สลิป → จัดเป็น payment_qr แล้วไม่จับคู่
// โครงสร้างอ้างอิงจาก @thai-qr-payment/payload (slip-verify.ts) และทดสอบเทียบผลกับไลบรารีนั้น

export type ThaiQr =
  | { kind: 'slip'; sendingBank: string; transRef: string }
  | { kind: 'payment_qr'; aid: string }
  | { kind: 'other' }

const SLIP_HEADER = '9104' // tag 91 ความยาว 04 (CRC 4 หลัก)
const MAX_TEXT = 512

// CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF) ตามที่ EMVCo กำหนด · ตรงกับ src/lib/promptpay.js
export function crc16Ccitt(input: string): string {
  let acc = 0xffff
  for (let i = 0; i < input.length; i++) {
    acc ^= (input.charCodeAt(i) & 0xff) << 8
    for (let b = 0; b < 8; b++) acc = acc & 0x8000 ? ((acc << 1) ^ 0x1021) & 0xffff : (acc << 1) & 0xffff
  }
  return acc.toString(16).toUpperCase().padStart(4, '0')
}

// อ่าน TLV ทั้งสตริง (IILL + ค่า) · โยน SyntaxError เมื่อโครงผิดหรือ tag ซ้ำ
export function parseTlv(input: string): Map<string, string> {
  const out = new Map<string, string>()
  let i = 0
  while (i < input.length) {
    if (i + 4 > input.length) throw new SyntaxError('truncated TLV header')
    const tag = input.slice(i, i + 2)
    const lenText = input.slice(i + 2, i + 4)
    if (!/^\d{2}$/.test(lenText)) throw new SyntaxError('bad TLV length')
    const start = i + 4
    const end = start + Number(lenText)
    if (end > input.length) throw new SyntaxError('TLV value overruns input')
    if (out.has(tag)) throw new SyntaxError(`duplicate tag ${tag}`)
    out.set(tag, input.slice(start, end))
    i = end
  }
  return out
}

// อ่านเนื้อของสลิป (ก่อน tag 91) · คืน null ถ้าไม่ใช่ slip-verify ที่ถูกโครง
function readSlipBody(body: string): { sendingBank: string; transRef: string } | null {
  let root: Map<string, string>
  let sub: Map<string, string>
  try {
    root = parseTlv(body)
    const template = root.get('00')
    if (template == null) return null
    sub = parseTlv(template)
  } catch {
    return null
  }
  if (sub.get('00') !== '000001') return null // API type ของ slip-verify
  if (root.get('51') !== 'TH') return null
  const bank = sub.get('01') ?? ''
  const ref = sub.get('02') ?? ''
  if (!/^\d{3}$/.test(bank)) return null
  // เลขอ้างอิงของบางธนาคาร (เช่น กรุงไทย) เป็นรูปแบบ UUID มีขีด · ขีดถูกตัดตอนเทียบในฐานข้อมูล (normalizeRef)
  if (!/^[A-Za-z0-9-]{6,40}$/.test(ref)) return null
  return { sendingBank: bank, transRef: ref }
}

// ตรวจ CRC จากท้ายสตริง: tag 91 อยู่ท้ายสุด ดังนั้น "9104" ต้องอยู่ห่างจากท้าย 5–8 ตัวอักษร
// ลองทุกตำแหน่งที่เป็นไปได้ (กัน transRef ที่มี "9104" ปนอยู่) · ยอมให้ CRC ที่ธนาคารส่งมาสั้นกว่า 4 หลัก (เติม 0 ข้างหน้า)
function parseSlip(text: string): { sendingBank: string; transRef: string } | null {
  for (let h = Math.max(0, text.length - 8); h <= text.length - 5; h++) {
    if (!text.startsWith(SLIP_HEADER, h)) continue
    const tail = text.slice(h + 4)
    if (!/^[0-9A-F]{1,4}$/.test(tail)) continue
    if (tail.padStart(4, '0') !== crc16Ccitt(text.slice(0, h + 4))) continue
    return readSlipBody(text.slice(0, h))
  }
  return null
}

// QR พร้อมเพย์/บัญชีธนาคาร (EMVCo MPM): tag 00 = "01", tag 58 = TH, tag 63 = CRC ที่คำนวณถึง "6304" · คืน AID ที่ขึ้นต้น A000000677
function parseMerchantAid(text: string): string | null {
  const i = text.lastIndexOf('6304')
  if (i < 0 || text.length !== i + 8) return null
  if (text.slice(i + 4) !== crc16Ccitt(text.slice(0, i + 4))) return null
  let root: Map<string, string>
  try {
    root = parseTlv(text.slice(0, i))
  } catch {
    return null
  }
  if (root.get('00') !== '01' || root.get('58') !== 'TH') return null
  for (const [tag, value] of root) {
    const n = Number(tag)
    if (n < 26 || n > 51) continue
    try {
      const aid = parseTlv(value).get('00') ?? ''
      if (aid.startsWith('A000000677')) return aid
    } catch {
      /* ข้ามเทมเพลตที่ผิดรูป */
    }
  }
  return null
}

// จำแนก QR ที่อ่านได้จากรูป · slip = สลิปโอนเงินที่รูปแบบถูกต้อง · payment_qr = QR รับเงินของร้าน (ไม่ใช่สลิป)
export function classifyThaiQr(raw: unknown): ThaiQr {
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (text.length < 12 || text.length > MAX_TEXT) return { kind: 'other' }
  const slip = parseSlip(text)
  if (slip) return { kind: 'slip', ...slip }
  const aid = parseMerchantAid(text)
  if (aid) return { kind: 'payment_qr', aid }
  return { kind: 'other' }
}

// คีย์กันสลิปซ้ำ: รหัสธนาคาร + เลขอ้างอิง (ตัวพิมพ์ใหญ่ เพื่อกันการเปลี่ยนตัวพิมพ์หลบการตรวจ)
export const slipKeyOf = (sendingBank: string, transRef: string) => `${sendingBank}:${transRef.toUpperCase()}`

// ออร์เดอร์ที่คุยกันล่าสุดในแชท = orderId ของข้อความที่ "ใหม่สุด" ที่มีการอ้างอิงออร์เดอร์ (null = ไม่มี)
export function latestOrderId(messages: unknown): string | null {
  const list = Array.isArray(messages) ? messages : []
  for (let i = list.length - 1; i >= 0; i--) {
    const id = (list[i] as any)?.orderId
    if (typeof id === 'string' && id) return id
  }
  return null
}

// ยอดรวม/ค้างชำระ: ต้องตรงกับ orderTotals ในแอป (src/lib/pricing.js) และ totals ใน customer-order
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
export function orderTotals(o: any): { total: number; paid: number; balance: number } {
  const items: any[] = Array.isArray(o?.items) ? o.items : []
  const subtotal = items.reduce((s, i) => s + (Number(i.unitPrice) || 0) * (Number(i.qty) || 0), 0)
  const shipFee = o?.fulfillment === 'delivery' ? Number(o.shippingFee) || 0 : 0
  const shipping = shipFee - (o?.shipPromo?.free ? shipFee : 0)
  const adjustment = Number(o?.adjustment?.amount) || 0
  const pointsDiscount = Number(o?.pointsUsed?.amount) || 0
  const couponDiscount = (Array.isArray(o?.couponsUsed) ? o.couponsUsed : []).reduce((s: number, c: any) => s + (Number(c.amount) || 0), 0)
  const gross = subtotal + shipping + adjustment - pointsDiscount - couponDiscount
  const rate = Number(o?.vat?.rate) || 0
  const exclusive = rate > 0 && o?.vat?.mode === 'exclusive'
  const vatAdd = exclusive ? r2((Math.max(gross, 0) * rate) / 100) : 0
  const total = gross + vatAdd
  const payments: any[] = Array.isArray(o?.payments) ? o.payments : []
  const paid = payments.filter((p) => p?.status === 'confirmed').reduce((s, p) => s + (Number(p.amount) || 0), 0)
  return { total, paid, balance: total - paid }
}

// ยอดที่ลูกค้าแจ้งเองและรอตรวจอยู่แล้ว (ไม่ให้แนบสลิปซ้อนจนยอดเกินคงค้าง)
export const pendingSumOf = (o: any): number =>
  r2((Array.isArray(o?.payments) ? o.payments : []).filter((p: any) => p?.status === 'reported' && p?.customerSubmitted).reduce((s: number, p: any) => s + (Number(p.amount) || 0), 0))

export type AttachPlan = { ok: true; amount: number } | { ok: false; reason: 'order_inactive' | 'order_paid' | 'pending_exists' }

// ตัดสินว่าแนบสลิปเข้าออร์เดอร์นี้ได้หรือไม่ · ยอดที่ตั้งไว้ = ยอดคงค้างที่ยังไม่มีรอตรวจ (สลิป QR ไม่มียอดเงิน พนักงานแก้ยอดตามสลิปได้)
export function planAttach(order: { status?: string; data?: any }): AttachPlan {
  if (order.status === 'draft' || order.status === 'cancelled') return { ok: false, reason: 'order_inactive' }
  const t = orderTotals(order.data)
  if (t.balance <= 0.004) return { ok: false, reason: 'order_paid' }
  const room = r2(t.balance - pendingSumOf(order.data))
  if (room <= 0.004) return { ok: false, reason: 'pending_exists' }
  return { ok: true, amount: room }
}

export const SLIP_NOTE = 'สลิปจากแชท (QR) · จับคู่อัตโนมัติ · ยังไม่ได้ตรวจยอดกับธนาคาร (ตรวจยอดในสลิปก่อนยืนยัน)'

// ยอดชำระตามรูปแบบเดียวกับที่ customer-order สร้าง (แหล่งแนบ = customer)
export function buildSlipPayment(p: {
  id: string; code: string; amount: number; slipRef: string; slipKey: string; paidAt: string; nowIso: string
  bankCode: string; bankName: string | null; ref: string
}) {
  return {
    id: p.id, code: p.code, requested: p.amount, amount: p.amount, method: 'โอนเงิน', paidAt: p.paidAt, slip: p.slipRef, note: SLIP_NOTE,
    dueAt: '', extension: null, status: 'reported', source: 'customer', customerSubmitted: true, submittedAt: p.nowIso, createdAt: p.nowIso,
    reportedBy: 'customer', confirmedBy: null, slipKey: p.slipKey,
    bankCode: p.bankCode, bankName: p.bankName, ref: p.ref, refSource: 'qr',
  }
}
