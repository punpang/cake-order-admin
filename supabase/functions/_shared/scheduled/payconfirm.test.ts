// ทดสอบแผนแจ้งลูกค้าเมื่อระบบยืนยันสลิปอัตโนมัติ: เฉพาะงวดที่ระบบยืนยันเองภายใน 24 ชม. · ส่งครั้งเดียวต่องวด
import { assertEquals } from 'jsr:@std/assert@1'
import { planScheduled } from './plan.ts'

// deno-lint-ignore no-explicit-any
type Any = any
const SHOP: Any = { close: '20:00', leadPickup: 60, leadDelivery: 120, birthdayDays: 14, payReminderTime: '09:00' }
const CUSTOMER: Any = { id: 'c1', name: 'คุณมะลิ', phone: '0812345678', fbPsid: '1669442389773370', promoOptIn: true, ledger: [], note: '' }
const RULES: Any[] = [{ event: 'payment_confirmed', enabled: true, channels: ['facebook', 'sms'], template: 'ยืนยันชำระ {ยอดที่ชำระ} แล้วค่ะ ออร์เดอร์ {เลขออร์เดอร์}' }]
// 11-11-2569 10:00 เวลาไทย
const NOW = Date.parse('2026-11-11T10:00+07:00')
const payment = (over: Any = {}): Any => ({
  id: 'p1', code: 'PAY-111126-00001', requested: 540, amount: 540, status: 'confirmed', confirmedBy: 'auto',
  confirmedAt: '2026-11-11T02:59:00.000Z', customerSubmitted: true, source: 'customer', ...over,
})
const order = (over: Any = {}): Any => ({
  id: 'o1', code: 'OR-111126-000010', customerId: 'c1', status: 'payment_confirmed', fulfillment: 'pickup', channel: 'facebook',
  pickupAt: '2026-11-14T10:00', items: [{ id: 'i1', name: 'เค้กช็อกโกแลต', unitPrice: 540, qty: 1, fullPrice: 540 }],
  payments: [payment()], history: [], createdAt: '2026-11-11T02:00:00.000Z', ...over,
})
const payPlans = (orders: Any[], sent: string[] = []) =>
  planScheduled({ nowMs: NOW, shop: SHOP, rules: RULES, orders, customers: [CUSTOMER], sent: new Set(sent) }).filter((p) => p.event === 'payment_confirmed')

Deno.test('ยืนยันอัตโนมัติภายใน 24 ชม. → วางแผนแจ้งลูกค้า "ยืนยันชำระ" ครั้งเดียวต่องวด', () => {
  const ps = payPlans([order()])
  assertEquals(ps.map((p) => p.key), ['payconf|p1'])
  assertEquals([ps[0].kind, ps[0].customer?.id, ps[0].orderId], ['customer', 'c1', 'o1'])
  assertEquals(ps[0].vars.ยอดที่ชำระ.includes('540'), true)
})

Deno.test('ยืนยันโดยพนักงาน หรือยืนยันอัตโนมัตินานกว่า 24 ชม. → ไม่แจ้งลูกค้าซ้ำ', () => {
  assertEquals(payPlans([order({ payments: [payment({ confirmedBy: 'admin' })] })]).length, 0)
  assertEquals(payPlans([order({ payments: [payment({ confirmedAt: '2026-11-09T02:00:00.000Z' })] })]).length, 0)
})

Deno.test('ส่งไปแล้ว (มีคีย์ในรายการส่งแล้ว) → ไม่วางแผนซ้ำ', () => {
  assertEquals(payPlans([order()], ['payconf|p1']).length, 0)
})

Deno.test('งวดที่แจ้งลูกค้าไปแล้วตอนยืนยัน (autoNotified) → ไม่วางแผนซ้ำ', () => {
  assertEquals(payPlans([order({ payments: [payment({ autoNotified: true })] })]).length, 0)
})
