// ทดสอบกฎ "เตือนก่อนนัดรับ": ปิดกฎแล้วไม่วางแผนเตือนนัดรับเลย (ไม่ส่งและไม่ขึ้นกระดิ่งลูกค้า)
import { assertEquals } from 'jsr:@std/assert@1'
import { planScheduled } from './plan.ts'

// deno-lint-ignore no-explicit-any
type Any = any
const SHOP: Any = { close: '20:00', leadPickup: 60, leadDelivery: 120, birthdayDays: 14, payReminderTime: '09:00' }
const CUSTOMER: Any = { id: 'c1', name: 'คุณมะลิ', phone: '0812345678', fbPsid: '', lineUserId: '', promoOptIn: true, ledger: [], note: '' }
// 13-11-2569 17:00 เวลาไทย: เหลือไม่ถึง 24 ชม. ก่อนนัด 14-11-2569 16:30 (อยู่ในช่วงเตือน)
const NOW = Date.parse('2026-11-13T17:00+07:00')
const order = (over: Any = {}): Any => ({
  id: 'o1', code: 'OR-131126-000821', customerId: 'c1', status: 'awaiting_payment', fulfillment: 'pickup', channel: 'line',
  pickupAt: '2026-11-14T16:30', items: [{ id: 'i1', name: 'เค้กช็อกโกแลต', unitPrice: 500, qty: 1, fullPrice: 500 }],
  payments: [], history: [], createdAt: '2026-11-13T09:00:00.000Z', ...over,
})
const hasPickup = (rules: Any[]) =>
  planScheduled({ nowMs: NOW, shop: SHOP, rules, orders: [order()], customers: [CUSTOMER], sent: new Set() }).some((p) => p.event === 'pickup_reminder')

Deno.test('กฎเตือนนัดรับปิดอยู่ → ไม่วางแผนเตือนนัดรับเลย', () => {
  assertEquals(hasPickup([{ event: 'pickup_reminder', enabled: false, channels: ['sms'], template: 'x' }]), false)
})

Deno.test('กฎเตือนนัดรับเปิดอยู่หรือยังไม่มีกฎ → ยังวางแผนเตือนตามเวลาเดิม', () => {
  assertEquals(hasPickup([{ event: 'pickup_reminder', enabled: true, channels: ['sms'], template: 'x' }]), true)
  assertEquals(hasPickup([]), true)
})
