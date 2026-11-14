// ทดสอบตรรกะยืนยันสลิปอัตโนมัติที่ใช้ร่วมกัน (ฟังก์ชันล้วน): เงื่อนไข 4 ข้อ · นัดรับห่างพอ · ยกเลิกยอดที่แจ้งเดิม
import { assertEquals } from 'jsr:@std/assert@1'
import { accountMatches, autoConfirmDecision, confirmSlipPayment } from './slipautoconfirm.ts'

const SHOP = '014000000517185'
// 11-11-2569 10:00 เวลาไทย · ออร์เดอร์สร้าง 09:00 · นัดรับ 14-11-2569 10:00 (ห่าง 3 วัน)
const NOW = Date.UTC(2026, 10, 11, 3, 0)
const ORDER = { code: 'OR-111126-000010', createdAt: '2026-11-11T02:00:00.000Z', pickupAt: '2026-11-14T10:00' }
const QR_REF = 'K7M3QRT2XBHD' // รหัสสุ่ม (Ref 2) ที่อ่านจากสลิป
const ACCT = '123-4-56789-0' // เลขบัญชีของร้านที่ตั้งไว้
const FIELDS = { amount: 540, paidAt: '2026-11-11T10:00', merchantCode: SHOP, shopRef: 'ORD111126000010', qrRef: QR_REF, receiverAccount: 'xxx-x-x6789-0' }
const QR_REQUEST = { qrRef: QR_REF, amount: 540 } // รายการแจ้งชำระที่ลูกค้าขอ QR ไว้ (รหัสสุ่มและยอดตรงกับสลิป)
const decide = (over: Record<string, unknown> = {}, fields: any = FIELDS) =>
  autoConfirmDecision({ enabled: true, days: 3, fields, order: ORDER, configuredMerchantCode: SHOP, configuredAccounts: [ACCT], balance: 540, nowMs: NOW, request: QR_REQUEST, ...over } as any)

Deno.test('ครบ 5 ข้อ + เปิดไว้ + นัดห่างพอ → ยืนยันได้', () => {
  const d = decide()
  assertEquals([d.ok, d.daysLeft], [true, 3])
  assertEquals(d.checks.map((c) => c.ok), [true, true, true, true, true, true])
})

Deno.test('เงื่อนไข 5: เลขบัญชีผู้รับไม่ตรงบัญชีร้าน → ไม่ยืนยันอัตโนมัติ · อ่านเลขบัญชีไม่ได้ → ไม่ยืนยัน', () => {
  assertEquals(decide({}, { ...FIELDS, receiverAccount: '999-9-99999-9' }).ok, false)
  assertEquals(decide({}, { ...FIELDS, receiverAccount: null }).ok, false)
  assertEquals(decide({ configuredAccounts: [] }).ok, false)
})

Deno.test('เลขบัญชีที่ OCR ปิดบางหลักยังนับว่าตรงได้ถ้าหลักที่เห็นตรง', () => {
  assertEquals(accountMatches('xxx-x-x6789-0', [ACCT]), true)
  assertEquals(accountMatches('xxx-x-x6788-0', [ACCT]), false)
  assertEquals(accountMatches('123-4-56789-0', [ACCT, '0812345678']), true)
})

Deno.test('นัดวันนี้กับตั้ง 0 วัน → ยืนยันได้ · นัดห่างไม่พอ → ไม่ยืนยัน', () => {
  assertEquals(decide({ days: 0, order: { ...ORDER, pickupAt: '2026-11-11T18:00' } }).ok, true)
  const near = decide({ order: { ...ORDER, pickupAt: '2026-11-13T10:00' } })
  assertEquals([near.ok, near.daysLeft], [false, 2])
})

Deno.test('ปิดไว้ / ไม่มีวันนัดรับ / วันนัดผ่านไปแล้ว → ไม่ยืนยัน', () => {
  assertEquals(decide({ enabled: false }).ok, false)
  assertEquals(decide({ order: { ...ORDER, pickupAt: undefined } }).ok, false)
  assertEquals(decide({ order: { ...ORDER, pickupAt: '2026-11-10T10:00' } }).ok, false)
})

Deno.test('เงื่อนไข 1: ยอดในสลิปเกินยอดคงค้าง → ไม่ยืนยัน · ไม่ได้อ่านยอด → ไม่ยืนยัน', () => {
  assertEquals(decide({ balance: 400 }).ok, false)
  assertEquals(decide({}, { ...FIELDS, amount: null }).ok, false)
})

Deno.test('เงื่อนไข 2: วัน-เวลาโอนเท่ากันนาทีกับเวลาสร้างออร์เดอร์ → ไม่ผ่าน · ไม่ได้อ่านวัน-เวลา → ไม่ยืนยัน', () => {
  assertEquals(decide({}, { ...FIELDS, paidAt: '2026-11-11T09:00' }).ok, false)
  assertEquals(decide({}, { ...FIELDS, paidAt: null }).ok, false)
})

Deno.test('รหัสร้านค้าไม่นับเป็นเงื่อนไข: ไม่ตั้ง/ไม่ตรง ก็ยืนยันได้ แต่ยังแสดงเครื่องหมายให้พนักงานเห็น', () => {
  assertEquals(decide({ configuredMerchantCode: '' }).ok, true)
  const r = decide({}, { ...FIELDS, merchantCode: '014000000517186' })
  assertEquals(r.ok, true)
  assertEquals(r.checks.find((c: any) => c.key === 'merchant')?.ok, false)
})

Deno.test('เงื่อนไข 3: รหัสอ้างอิงร้านค้าไม่ตรงกับออร์เดอร์ หรือไม่ได้อ่าน → ไม่ยืนยัน · ไม่ได้อ่านภาพเลย → ไม่ยืนยัน', () => {
  assertEquals(decide({}, { ...FIELDS, shopRef: 'POS123927229' }).ok, false)
  assertEquals(decide({}, { ...FIELDS, shopRef: undefined }).ok, false)
  assertEquals(decide({}, null).ok, false)
})

Deno.test('เงื่อนไข 4: รหัสสุ่ม (Ref 2) ไม่ตรงกับรายการแจ้งชำระ · ไม่พบรายการ · ยอดไม่เท่ากับรายการ · ไม่มีรหัสสุ่มในสลิป → ไม่ยืนยัน', () => {
  assertEquals(decide({ request: { qrRef: 'ZZZZZZZZZZZZ', amount: 540 } }).ok, false)
  assertEquals(decide({ request: null }).ok, false)
  assertEquals(decide({ request: { qrRef: QR_REF, amount: 300 } }).ok, false)
  assertEquals(decide({}, { ...FIELDS, qrRef: undefined }).ok, false)
})

Deno.test('ยืนยันงวดนี้ ยกเลิกเฉพาะยอดที่ร้านแจ้งเดิมที่ยังรออยู่ · ไม่แตะยอดที่ลูกค้าแจ้งเอง ยอดที่ยกเลิกแล้ว หรือยอดที่ยืนยันแล้ว', () => {
  const staff = { id: 'ps1', status: 'reported', customerSubmitted: false, amount: 540 }
  const customer = { id: 'pc1', status: 'reported', customerSubmitted: true, amount: 300 }
  const target = { id: 'pt1', status: 'reported', customerSubmitted: true, amount: 540 }
  const cancelledAlready = { id: 'px', status: 'cancelled', amount: 100 }
  const confirmedAlready = { id: 'pf', status: 'confirmed', amount: 50 }
  const out = confirmSlipPayment([staff, customer, target, cancelledAlready, confirmedAlready], 'pt1', '2026-11-11T03:00:00.000Z')
  assertEquals(out.payments.map((p: any) => p.status), ['cancelled', 'reported', 'confirmed', 'cancelled', 'confirmed'])
  assertEquals([out.payments[0].cancelledBy, out.payments[2].confirmedBy, out.payments[2].confirmedAt], ['auto', 'auto', '2026-11-11T03:00:00.000Z'])
  assertEquals(out.cancelled.map((p: any) => p.id), ['ps1'])
})
