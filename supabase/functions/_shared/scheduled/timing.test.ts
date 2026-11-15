// ทดสอบการตั้งเวลาแจ้งเตือนอัตโนมัติ: ค่าที่ร้านตั้งไว้มีผลต่อช่วงเวลาที่เตือน · ไม่ตั้ง = ค่าเริ่มต้นเท่าการทำงานเดิม
import { assertEquals } from 'jsr:@std/assert@1'
import { planScheduled } from './plan.ts'
import { accountingPlans } from './accounting.ts'

// deno-lint-ignore no-explicit-any
type Any = any
const at = (s: string) => Date.parse(`${s}+07:00`) // เวลาไทย → มิลลิวินาที
const NOW = at('2026-11-14T18:30') // 14 พ.ย. 18:30 เวลาไทย
const SHOP = { close: '20:00', leadPickup: 60, leadDelivery: 120, birthdayDays: 14, payReminderTime: '09:00' }

const order = (over: Any = {}): Any => ({
  id: 'o1', code: 'OR-1', customerId: 'c1', status: 'awaiting_payment', fulfillment: 'pickup', channel: 'facebook',
  pickupAt: '2026-11-15T10:00', items: [{ id: 'i1', name: 'เค้กช็อกโกแลต', unitPrice: 500, qty: 1, fullPrice: 500 }],
  payments: [], couponsUsed: [], pointsUsed: null, adjustment: { amount: 0, reason: '' }, vat: null, ...over,
})
const CUSTOMER: Any = { id: 'c1', name: 'คุณมะลิ', phone: '0812345678', fbPsid: '', promoOptIn: true, ledger: [], note: '' }
const run = (shop: Any, over: Any = {}) => planScheduled({ nowMs: NOW, shop: { ...SHOP, ...shop }, rules: [], orders: [], customers: [CUSTOMER], sent: new Set(), ...over })
const has = (ps: Any[], key: string) => ps.some((p) => p.key === key)

Deno.test('เตือนนัดรับ: ตามชั่วโมงที่ร้านตั้ง (ไม่ตั้ง = 24 ชม.)', () => {
  const o = order({ pickupAt: '2026-11-15T01:00' }) // เหลือ 6.5 ชม.
  assertEquals(has(run({ pickupRemindHours: 24 }, { orders: [o] }), 'pickup|o1'), true)
  assertEquals(has(run({ pickupRemindHours: 6 }, { orders: [o] }), 'pickup|o1'), false)
  assertEquals(has(run({}, { orders: [o] }), 'pickup|o1'), true)
})

Deno.test('งานใกล้เวลาต้องเสร็จ (ทีม): ตามชั่วโมงที่ร้านตั้ง (ไม่ตั้ง = 2 ชม.) และข้อความแทนค่าชั่วโมง', () => {
  const far = order({ pickupAt: '2026-11-14T23:00' }) // ผลิตเหลือ 3.5 ชม.
  assertEquals(has(run({ dueSoonHours: 2 }, { orders: [far] }), 'due|o1'), false)
  assertEquals(has(run({ dueSoonHours: 4 }, { orders: [far] }), 'due|o1'), true)
  const near = order({ pickupAt: '2026-11-14T21:00' }) // ผลิตเหลือ 1.5 ชม.
  assertEquals(has(run({ dueSoonHours: 1 }, { orders: [near] }), 'due|o1'), false)
  const plan = run({ dueSoonHours: 2 }, { orders: [near] }).find((p) => p.key === 'due|o1')
  assertEquals(plan?.vars?.ชั่วโมง, '2')
})

Deno.test('คะแนนใกล้หมดอายุ: ตามจำนวนวันที่ร้านตั้ง (ไม่ตั้ง = 30 วัน)', () => {
  const lot = { id: 'l1', delta: 50, remaining: 50, expiresAt: '2026-12-10', source: 'order' } // อีก 26 วัน
  const c = { ...CUSTOMER, ledger: [lot] }
  const pts = (shop: Any) => planScheduled({ nowMs: NOW, shop: { ...SHOP, ...shop }, rules: [], orders: [], customers: [c], sent: new Set() })
  assertEquals(has(pts({ pointsExpireDays: 30 }), 'pts|c1|2026-12-10'), true)
  assertEquals(has(pts({ pointsExpireDays: 20 }), 'pts|c1|2026-12-10'), false)
  assertEquals(has(pts({}), 'pts|c1|2026-12-10'), true)
})

Deno.test('งวดผ่อนชำระ: เตือนก่อนครบกำหนดตามจำนวนวันที่ร้านตั้ง (ไม่ตั้ง = 1 วัน)', () => {
  const loan = { id: 'x1', name: 'เงินกู้ร้าน', principal: 12000, ratePct: 0, n: 12, method: 'reducing', firstDue: '2026-11-17', payments: [] }
  const base = { todayStr: '2026-11-14', closedThrough: '', recurring: [], recurringSkips: [], installments: [loan], vatFilings: {}, postedRecurring: [] }
  assertEquals(accountingPlans(base).length, 0) // ครบกำหนดอีก 3 วัน เกิน 1 วัน
  assertEquals(accountingPlans({ ...base, installmentDays: 3 }).length, 1)
})
