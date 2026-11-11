// ทดสอบตรรกะสลิป (ฟังก์ชันล้วน): รูปแบบ QR · การจับคู่ออร์เดอร์ล่าสุด · ยอดคงค้างและการกันแนบซ้ำ
import { assertEquals } from 'jsr:@std/assert@1'
import { classifyThaiQr, crc16Ccitt, latestOrderId, orderTotals, planAttach, slipKeyOf, buildSlipPayment, parseTlv } from './slip.ts'

// ค่าอ้างอิงจาก @thai-qr-payment/payload (buildSlipVerify) — เทียบผลในไลบรารีอ้างอิงแล้ว
const SLIP_SCB = '004000060000010103014021900021231231212000115102TH910483B8'
const SLIP_KBANK = '0037000600000101030040216A1B2C3D4E5F6G7H85102TH9104DE9E'
const PROMPTPAY_540 = '00020101021229370016A000000677010111011300668123456785802TH53037645406540.0063048A50'

Deno.test('CRC-16/CCITT-FALSE ตรงกับค่าอ้างอิง', () => {
  assertEquals(crc16Ccitt('123456789'), '29B1')
  assertEquals(crc16Ccitt(''), 'FFFF')
})

Deno.test('สลิปธนาคารที่รูปแบบถูกต้อง → slip พร้อมรหัสธนาคารและเลขอ้างอิง', () => {
  assertEquals(classifyThaiQr(SLIP_SCB), { kind: 'slip', sendingBank: '014', transRef: '0002123123121200011' })
  assertEquals(classifyThaiQr(SLIP_KBANK), { kind: 'slip', sendingBank: '004', transRef: 'A1B2C3D4E5F6G7H8' })
})

Deno.test('เลขอ้างอิงมีขีด (รูปแบบ UUID ของกรุงไทย) → slip และคงขีดไว้ในค่าที่อ่านได้', () => {
  const uuidRef = '69120826-6f05-4e68-ba32-83ac8d182102'
  const sub = `0006000001` + `0103006` + `02${String(uuidRef.length).padStart(2, '0')}${uuidRef}`
  const root = `00${String(sub.length).padStart(2, '0')}${sub}` + '5102TH' + '9104'
  const qr = root + crc16Ccitt(root)
  assertEquals(classifyThaiQr(qr), { kind: 'slip', sendingBank: '006', transRef: uuidRef })
})

Deno.test('สลิปที่ถูกแก้ไขแม้ตัวเดียว → ไม่ใช่สลิป', () => {
  const tampered = SLIP_SCB.slice(0, 30) + (SLIP_SCB[30] === '1' ? '2' : '1') + SLIP_SCB.slice(31)
  assertEquals(classifyThaiQr(tampered).kind, 'other')
})

// สร้างสลิปด้วยตัวเองในเทสต์ (โครงเดียวกับ buildSlipVerify ของไลบรารีอ้างอิง)
const tlv = (t: string, v: string) => t + String(v.length).padStart(2, '0') + v
function slipWith(bank: string, ref: string): string {
  const body = tlv('00', tlv('00', '000001') + tlv('01', bank) + tlv('02', ref)) + tlv('51', 'TH')
  const seed = body + '9104'
  return seed + crc16Ccitt(seed)
}

Deno.test('CRC ที่ธนาคารตัดเลข 0 ข้างหน้าทิ้ง: เติม 0 คืนแล้วตรวจได้ (พฤติกรรมเดียวกับไลบรารีอ้างอิง)', () => {
  // หาเลขอ้างอิงที่ CRC ขึ้นต้นด้วย 0 (ตัวอย่างนี้กำหนดผลแน่นอนเสมอ)
  let ref = ''
  let full = ''
  for (let i = 0; i < 500; i++) {
    ref = `REF${String(i).padStart(4, '0')}`
    full = slipWith('014', ref)
    if (full.slice(-4).startsWith('0')) break
  }
  assertEquals(full.slice(-4)[0], '0')
  assertEquals(classifyThaiQr(full), { kind: 'slip', sendingBank: '014', transRef: ref })
  const truncated = full.slice(0, -4) + full.slice(-3) // ตัด 0 ตัวแรกของ CRC ออก
  assertEquals(classifyThaiQr(truncated), { kind: 'slip', sendingBank: '014', transRef: ref })
})

Deno.test('CRC ที่ขาดเกินกว่าเลข 0 นำหน้า (ค่าไม่ตรง) → ไม่รับ', () => {
  assertEquals(classifyThaiQr(SLIP_SCB.slice(0, -2)).kind, 'other')
})

Deno.test('CRC เป็นตัวพิมพ์เล็กหรือไม่ตรง → ไม่รับ (มาตรฐานใช้ตัวพิมพ์ใหญ่)', () => {
  assertEquals(classifyThaiQr(SLIP_SCB.slice(0, -4) + SLIP_SCB.slice(-4).toLowerCase()).kind, 'other')
})

Deno.test('QR พร้อมเพย์ของร้าน → payment_qr (ไม่ใช่สลิป)', () => {
  assertEquals(classifyThaiQr(PROMPTPAY_540), { kind: 'payment_qr', aid: 'A000000677010111' })
})

Deno.test('ข้อความทั่วไป / ว่าง / ยาวเกินไป → other', () => {
  for (const t of ['', 'สวัสดีค่ะ', 'https://example.com/slip?id=123456', '0000', 'A'.repeat(600)]) assertEquals(classifyThaiQr(t).kind, 'other')
  assertEquals(classifyThaiQr(undefined).kind, 'other')
})

Deno.test('parseTlv: tag ซ้ำและความยาวเกินถือว่าผิดรูป', () => {
  let threw = 0
  for (const bad of ['0001A0002B', '0005AB', '00020101' + '0002AB']) {
    try { parseTlv(bad) } catch { threw++ }
  }
  assertEquals(threw, 3)
})

Deno.test('latestOrderId: เลือกออร์เดอร์จากข้อความใหม่สุดที่อ้างอิงออร์เดอร์', () => {
  const msgs = [
    { id: 'a', orderId: 'o1' },
    { id: 'b', orderId: null },
    { id: 'c', orderId: 'o2' },
    { id: 'd', from: 'customer' },
  ]
  assertEquals(latestOrderId(msgs), 'o2')
  assertEquals(latestOrderId([{ id: 'x' }]), null)
  assertEquals(latestOrderId(undefined), null)
})

const order = (over: Record<string, unknown> = {}) => ({ status: 'awaiting_payment', data: { items: [{ unitPrice: 300, qty: 2 }], payments: [], ...over } })

Deno.test('orderTotals: ยอดรวม/ชำระแล้ว/คงค้างตามกติกาเดิม (ลดราคา, VAT แยก, ยืนยันแล้วเท่านั้นที่นับเป็นชำระ)', () => {
  const o = {
    items: [{ unitPrice: 100, qty: 3 }], fulfillment: 'delivery', shippingFee: 50, shipPromo: { free: true },
    adjustment: { amount: -20 }, couponsUsed: [{ amount: 10 }], vat: { rate: 7, mode: 'exclusive' },
    payments: [{ status: 'confirmed', amount: 100 }, { status: 'reported', amount: 999 }],
  }
  // gross = 300 + 0 (ส่งฟรี) - 20 - 10 = 270 · VAT 7% = 18.9 · total 288.9 · paid 100 · balance 188.9
  const t = orderTotals(o)
  assertEquals(Math.round(t.total * 100) / 100, 288.9)
  assertEquals(t.paid, 100)
  assertEquals(Math.round(t.balance * 100) / 100, 188.9)
})

Deno.test('planAttach: แนบได้เมื่อมียอดคงค้างและยังไม่มีรอตรวจ', () => {
  assertEquals(planAttach(order()), { ok: true, amount: 600 })
})

Deno.test('planAttach: ออร์เดอร์ยกเลิก/ร่าง, ชำระครบ, มียอดรอตรวจอยู่แล้ว → ไม่แนบ', () => {
  assertEquals(planAttach({ status: 'cancelled', data: order().data }), { ok: false, reason: 'order_inactive' })
  assertEquals(planAttach({ status: 'draft', data: order().data }), { ok: false, reason: 'order_inactive' })
  assertEquals(planAttach(order({ payments: [{ status: 'confirmed', amount: 600 }] })), { ok: false, reason: 'order_paid' })
  assertEquals(planAttach(order({ payments: [{ status: 'reported', customerSubmitted: true, amount: 600 }] })), { ok: false, reason: 'pending_exists' })
})

Deno.test('planAttach: ยอดรอตรวจบางส่วน → ตั้งยอดเป็นส่วนที่เหลือ', () => {
  assertEquals(planAttach(order({ payments: [{ status: 'reported', customerSubmitted: true, amount: 200 }] })), { ok: true, amount: 400 })
})

Deno.test('slipKeyOf: ไม่สนตัวพิมพ์ของเลขอ้างอิง (กันการหลบการกันซ้ำ)', () => {
  assertEquals(slipKeyOf('004', 'a1b2c3'), slipKeyOf('004', 'A1B2C3'))
  assertEquals(slipKeyOf('004', 'A1B2C3'), '004:A1B2C3')
})

Deno.test('buildSlipPayment: รูปแบบเดียวกับยอดที่ลูกค้าแจ้งจากหน้าออร์เดอร์', () => {
  const p = buildSlipPayment({ id: 'payX', code: 'PAY-111126-00001', amount: 600, slipRef: 'sb://punpang-slips/OR1/a.jpg', slipKey: '004:A1', paidAt: '2026-11-11T10:00', nowIso: '2026-11-11T03:00:00.000Z', bankCode: '004', bankName: 'ธนาคารกสิกรไทย', ref: 'A1' })
  assertEquals(p.status, 'reported')
  assertEquals(p.source, 'customer')
  assertEquals(p.customerSubmitted, true)
  assertEquals(p.method, 'โอนเงิน')
  assertEquals(p.requested, 600)
  assertEquals(p.amount, 600)
  assertEquals(p.slip, 'sb://punpang-slips/OR1/a.jpg')
  assertEquals(p.slipKey, '004:A1')
  assertEquals(p.extension, null)
  assertEquals([p.bankCode, p.bankName, p.ref, p.refSource], ['004', 'ธนาคารกสิกรไทย', 'A1', 'qr'])
})
