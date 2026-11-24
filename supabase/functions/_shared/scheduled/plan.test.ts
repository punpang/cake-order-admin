// ทดสอบแผนงานตามเวลาฝั่งเซิร์ฟเวอร์: เวลาไทย · เตือนนัด/ชำระ/ทีม/วันเกิด/คะแนน · กันส่งซ้ำ · การเรนเดอร์
import { assert, assertEquals } from 'jsr:@std/assert@1'
import {
  channelTplOf, customerAddr, customerTargets, effectiveChannels, escapeVars, instantOf, orderVars, plainText, planScheduled, renderFor, wallNow, CUSTOMER_CHANNEL_ORDER,
} from './plan.ts'

// deno-lint-ignore no-explicit-any
type Any = any
const at = (s: string) => Date.parse(`${s}+07:00`) // เวลาไทย → มิลลิวินาที
const SHOP = { close: '20:00', leadPickup: 60, leadDelivery: 120, birthdayDays: 14, payReminderTime: '09:00' }
const NOW = at('2026-11-14T18:30') // 14 พ.ย. 18:30 เวลาไทย

const order = (over: Any = {}): Any => ({
  id: 'o1', code: 'OR-1', customerId: 'c1', status: 'awaiting_payment', fulfillment: 'pickup', channel: 'facebook',
  pickupAt: '2026-11-15T10:00', items: [{ id: 'i1', name: 'เค้กช็อกโกแลต', unitPrice: 500, qty: 1, fullPrice: 500 }],
  payments: [], couponsUsed: [], pointsUsed: null, adjustment: { amount: 0, reason: '' }, vat: null, ...over,
})
const CUSTOMER: Any = { id: 'c1', name: 'คุณมะลิ', phone: '0812345678', fbPsid: '1669442389773370', promoOptIn: true, ledger: [], note: '' }
const run = (over: Any = {}) => planScheduled({ nowMs: NOW, shop: SHOP, rules: [], orders: [], customers: [CUSTOMER], sent: new Set(), ...over })
const keys = (ps: Any[]) => ps.map((p) => p.key)

Deno.test('เวลาติดผนังของกรุงเทพอ่านได้ตรงเวลาไทยไม่ว่าเซิร์ฟเวอร์ตั้งโซนใด', () => {
  const w = wallNow(Date.parse('2026-11-14T11:30:00Z')) // = 18:30 ไทย
  assertEquals([w.getHours(), w.getMinutes(), w.getDate()], [18, 30, 14])
  assertEquals(instantOf('2026-11-14T18:30'), at('2026-11-14T18:30'))
  assertEquals(instantOf('2026-11-14'), Date.parse('2026-11-14T00:00+07:00'))
  assert(Number.isNaN(instantOf('')))
})

Deno.test('ใกล้เวลาต้องเสร็จ (ทีม): นัด − เวลาผลิต ภายใน 2 ชม.', () => {
  const confirmed = { status: 'order_confirmed' }
  const soon = run({ orders: [order({ ...confirmed, pickupAt: '2026-11-14T21:00' })] }).find((p) => p.key === 'due|o1')
  assertEquals(soon?.kind, 'team')
  assertEquals(soon?.event, 'team_due_soon')
  assert(!run({ orders: [order({ ...confirmed, pickupAt: '2026-11-14T23:00' })] }).some((p) => p.key === 'due|o1')) // เหลือ 3.5 ชม.
})

Deno.test('ใกล้เวลาต้องเสร็จ: ไม่แจ้งงานที่ยังไม่ยืนยันสั่งซื้อ (ยังไม่ชำระ / แจ้งยอดแล้ว)', () => {
  for (const status of ['awaiting_payment', 'payment_reported', 'draft']) {
    const ps = run({ orders: [order({ status, pickupAt: '2026-11-14T21:00' })] })
    assert(!ps.some((p) => p.key === 'due|o1'), `ไม่ควรแจ้งที่สถานะ ${status}`)
  }
})

Deno.test('เตือนชำระ: หลัง payReminderTime และนัดพรุ่งนี้ ยังไม่ชำระ และแจ้งยอดแล้ว', () => {
  const reported = [{ id: 'p1', status: 'reported', source: 'staff', requested: 500, amount: 500, method: 'โอนเงิน', dueAt: '2026-11-14T20:00' }]
  const at0930 = at('2026-11-14T09:30')
  const plan = planScheduled({ nowMs: at0930, shop: SHOP, rules: [], orders: [order({ pickupAt: '2026-11-15T11:00', payments: reported })], customers: [CUSTOMER], sent: new Set() }).find((p) => p.event === 'payment_reminder')
  assertEquals(plan?.key, 'payrem|o1|2026-11-15')
  assert(plan?.vars.ชำระก่อน.includes('20:00'))
  // ก่อน 09:00 ไม่เตือน
  assertEquals(planScheduled({ nowMs: at('2026-11-14T08:30'), shop: SHOP, rules: [], orders: [order({ pickupAt: '2026-11-15T11:00', payments: reported })], customers: [CUSTOMER], sent: new Set() }).some((p) => p.event === 'payment_reminder'), false)
  // ลูกค้าแจ้งโอนแล้ว (รอตรวจ) ไม่เตือน
  const slip = [{ ...reported[0], source: 'customer', slip: 'r2://private/x.jpg' }]
  assertEquals(planScheduled({ nowMs: at0930, shop: SHOP, rules: [], orders: [order({ pickupAt: '2026-11-15T11:00', payments: slip })], customers: [CUSTOMER], sent: new Set() }).some((p) => p.event === 'payment_reminder'), false)
})

Deno.test('งวดชำระเลยกำหนด → แจ้งทีม (ตามเวลาไทย) และไม่แจ้งงวดที่ยังไม่ถึง', () => {
  const late = [{ id: 'p1', status: 'reported', source: 'staff', requested: 500, amount: 500, dueAt: '2026-11-14T10:00' }]
  const ok = [{ ...late[0], dueAt: '2026-11-14T20:00' }]
  assert(run({ orders: [order({ payments: late })] }).some((p) => p.key === 'overdue|p1|2026-11-14T10:00' && p.kind === 'team'))
  assertEquals(run({ orders: [order({ payments: ok })] }).some((p) => p.event === 'team_pay_overdue'), false)
})

Deno.test('วันเกิดภายในจำนวนวันที่ตั้งไว้ → แจ้งลูกค้า (ครั้งเดียวต่อปี)', () => {
  const near = order({ birthday: { name: 'แม่', md: '11-15' }, pickupAt: '2026-11-20T10:00' })
  const far = order({ id: 'o2', birthday: { name: 'พ่อ', md: '12-31' }, pickupAt: '2026-11-21T10:00' })
  const ks = keys(run({ orders: [near, far] }))
  assert(ks.includes('bd|c1|แม่|11-15|2026'))
  assert(!ks.some((k) => k.includes('พ่อ')))
})

Deno.test('คะแนนใกล้หมดอายุ (ภายใน 30 วัน) → แจ้งลูกค้า', () => {
  const cust = { ...CUSTOMER, ledger: [{ id: 'l1', at: '2026-06-01', delta: 120, remaining: 120, expiresAt: '2026-12-01' }] }
  const p = run({ customers: [cust] }).find((x) => x.event === 'points_expiring')
  assertEquals(p?.key, 'pts|c1|2026-12-01')
  assertEquals(p?.vars.คะแนน, '120')
})

Deno.test('กันส่งซ้ำ: คีย์ที่ส่งแล้วไม่ถูกวางแผนซ้ำ', () => {
  assertEquals(keys(run({ orders: [order({ pickupAt: '2026-11-14T21:00' })], sent: new Set(['due|o1']) })).includes('due|o1'), false)
})

Deno.test('ข้อความ: เทมเพลต, ลิงก์ต่อท้าย (SMS), ตัดอีโมจิ, escape ของทีม', () => {
  const rule = { event: 'shipping', channels: ['facebook', 'sms'], template: 'ออร์เดอร์ {เลขออร์เดอร์} ออกจัดส่งแล้วค่ะ\nกำหนดถึง {วันนัด} เวลา {เวลานัด}', enabled: true }
  const v = orderVars(order(), {}, SHOP, CUSTOMER)
  const text = 'ออร์เดอร์ OR-1 ออกจัดส่งแล้วค่ะ\nกำหนดถึง 15-11-2569 เวลา 10:00'
  assertEquals(renderFor(rule, 'sms', v, '').text, text)
  assertEquals(renderFor(rule, 'facebook', v, '').text, text)
  assertEquals(renderFor(rule, 'sms', v, 'https://x.test/#/o/T').text, text + '\nดูออร์เดอร์: https://x.test/#/o/T')
  assertEquals(channelTplOf(rule, 'sms'), rule.template)
  assertEquals(plainText('📍 ตรวจ ━━'), 'ตรวจ')
  assertEquals(escapeVars({ a: '<b> & c' }).a, '&lt;b&gt; &amp; c')
})

Deno.test('ช่องทาง: ปิดช่องหรือไม่มีข้อมูลติดต่อ → ไม่ส่งช่องนั้น', () => {
  const rule = { event: 'birthday', channels: ['facebook'], template: 'สุขสันต์', enabled: true }
  const allowed = effectiveChannels(rule, CUSTOMER, order())
  const integrations = { facebook: { enabled: true }, sms: { enabled: true } }
  const ct = customerTargets as Any // ฟังก์ชันจาก JS (ไม่มีชนิด)
  const targets: string[] = ct({ order: CUSTOMER_CHANNEL_ORDER, allowed, integrations, addressOf: (k: string) => customerAddr(CUSTOMER, k), marketing: true })
  assertEquals(targets, ['facebook']) // การตลาดส่งช่องแรกที่ใช้ได้ช่องเดียว
})
