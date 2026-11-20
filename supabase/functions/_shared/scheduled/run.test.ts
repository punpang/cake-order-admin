// ทดสอบฝั่ง IO ของการส่งตามเวลา ด้วยไคลเอนต์จำลอง (ไม่มีการเรียกเครือข่าย): คิวข้อความ · กระดิ่ง · แชท · กันส่งซ้ำ · ปิดกฎ/ปิดการตลาด
import { assertEquals } from 'jsr:@std/assert@1'
import { execPlan, runPlans, type Ctx } from './run.ts'
import type { Plan } from './plan.ts'

// deno-lint-ignore no-explicit-any
type Any = any

// ไคลเอนต์จำลองของ punpang_records / punpang_chats: บันทึก insert/update และตอบ select แบบเรียบง่าย
function fakeSb(chats: Any[] = [], accounts: Any[] = []) {
  const inserts: { table: string; row: Any }[] = []
  const updates: { table: string; patch: Any }[] = []
  const seen = new Set<string>()
  const from = (table: string): Any => {
    const q: Any = {
      eq() { return q },
      select() { return q },
      maybeSingle() {
        const row = table === 'punpang_chats' ? chats[0] ?? null : table === 'punpang_customer_auth' ? accounts[0] ?? null : null
        return Promise.resolve({ data: row, error: null })
      },
      insert(row: Any) {
        const key = `${table}|${row.collection ?? ''}|${row.id ?? ''}`
        if (table === 'punpang_records' && seen.has(key)) return Promise.resolve({ error: { message: 'duplicate key' } })
        seen.add(key)
        inserts.push({ table, row })
        return Promise.resolve({ error: null })
      },
      update(patch: Any) {
        updates.push({ table, patch })
        const u: Any = { eq() { return u }, select() { return Promise.resolve({ data: [{ id: 'x' }], error: null }) } }
        return u
      },
    }
    return q
  }
  return { from, inserts, updates }
}

const NOW = Date.parse('2026-11-14T18:30+07:00')
const SHOP = { close: '20:00', leadPickup: 60, leadDelivery: 120, birthdayDays: 14, payReminderTime: '09:00' }
const INTEG = { facebook: { enabled: true }, sms: { enabled: true }, telegram: { enabled: true } }
const RULES = [
  { event: 'pickup_reminder', channels: ['facebook', 'sms'], template: 'เตือนนัด{ส่งมอบ}ออร์เดอร์ {เลขออร์เดอร์} วันที่ {วันนัด} เวลา {เวลานัด}', enabled: true },
  { event: 'points_expiring', channels: ['facebook'], template: '{ชื่อลูกค้า} มี {คะแนน} คะแนนใกล้หมดอายุ', enabled: true },
  { event: 'team_due_soon', channels: ['telegram'], template: '[ใกล้เวลา] {เลขออร์เดอร์} ต้องเสร็จภายใน 2 ชม.', enabled: true },
  { event: 'pickup_off', channels: ['facebook'], template: 'x', enabled: false },
]
const ORDER: Any = {
  id: 'o1', code: 'OR-1', customerId: 'c1', status: 'awaiting_payment', fulfillment: 'pickup', channel: 'facebook', pickupAt: '2026-11-15T10:00',
  items: [{ id: 'i1', name: 'เค้ก', unitPrice: 500, qty: 1 }], payments: [], couponsUsed: [], pointsUsed: null, adjustment: { amount: 0, reason: '' }, vat: null,
}
const CUST: Any = { id: 'c1', name: 'คุณมะลิ', phone: '0812345678', fbPsid: '1669442389773370', promoOptIn: true, ledger: [], note: '' }

function ctxOf(sb: Any, over: Partial<Ctx> = {}): Ctx {
  return { sb, nowMs: NOW, rules: RULES, integrations: INTEG, chats: [], fb: null, gw: null, tg: null, siteUrl: 'https://site.test', ...over }
}
const plan = (over: Partial<Plan>): Plan => ({ key: 'k', kind: 'customer', event: 'pickup_reminder', orderId: 'o1', order: ORDER, customer: CUST, vars: { ชื่อลูกค้า: 'คุณมะลิ', เลขออร์เดอร์: 'OR-1', วันนัด: '15-11-2569', เวลานัด: '10:00', ส่งมอบ: 'รับ' }, ...over })
const outbox = (sb: Any) => sb.inserts.filter((i: Any) => i.table === 'punpang_records' && i.row.collection === 'outbox').map((i: Any) => i.row.data)
const bells = (sb: Any) => sb.inserts.filter((i: Any) => i.table === 'punpang_records' && i.row.collection === 'bell').map((i: Any) => i.row.data)

Deno.test('Facebook ไม่มีแชท → คิวล้มเหลว + กระดิ่งให้พนักงานตามเอง (และมีกระดิ่งลูกค้า)', async () => {
  const sb = fakeSb([])
  await execPlan(ctxOf(sb, { rules: [RULES[0]], integrations: { ...INTEG, sms: { enabled: false } } }), plan({}))
  const ob = outbox(sb)
  assertEquals(ob.length, 1)
  assertEquals([ob[0].channel, ob[0].status, ob[0].error], ['facebook', 'failed', 'ลูกค้ายังไม่มีแชท Facebook ที่ผูกไว้'])
  const bs = bells(sb)
  assertEquals(bs.some((b: Any) => b.audience === 'staff' && b.event === 'notify_failed'), true)
  assertEquals(bs.some((b: Any) => b.audience === 'customer' && b.event === 'pickup_reminder' && b.customerId === 'c1'), true)
  assertEquals(sb.inserts.some((i: Any) => i.row.collection === 'orderLinks'), true) // ลิงก์ดูออร์เดอร์
})

Deno.test('SMS ยังไม่ตั้งค่าเกตเวย์ → คิวล้มเหลว + กระดิ่งเตือน', async () => {
  const sb = fakeSb([])
  await execPlan(ctxOf(sb, { rules: [{ ...RULES[0], channels: ['sms'] }] }), plan({}))
  const ob = outbox(sb)
  assertEquals([ob[0].channel, ob[0].status, ob[0].error], ['sms', 'failed', 'ยังไม่ได้ตั้งค่าเกตเวย์ SMS ของร้าน'])
  assertEquals(bells(sb).some((b: Any) => b.event === 'notify_failed' && String(b.text).includes('ส่ง SMS ไม่สำเร็จ')), true)
})

Deno.test('แชท Facebook อยู่ในช่อง 24 ชม. แต่ยังไม่ตั้ง Page → ต่อข้อความในแชทพร้อมผลส่งล้มเหลว', async () => {
  const chat = { id: 'ch1', channel: 'facebook', external_id: CUST.fbPsid, customer_id: 'c1', data: { lastInboundAt: new Date(NOW - 3600e3).toISOString(), messages: [] }, updated_at: '2026-11-14T10:00:00Z' }
  const sb = fakeSb([chat])
  await execPlan(ctxOf(sb, { rules: [{ ...RULES[0], channels: ['facebook'] }], chats: [chat] }), plan({}))
  const up: Any = sb.updates.find((u: Any) => u.table === 'punpang_chats')
  assertEquals(up !== undefined, true)
  const msg = up.patch.data.messages[0]
  assertEquals([msg.from, msg.by, msg.delivery, msg.deliveryError], ['staff', 'ระบบ', 'failed', 'ยังไม่ได้เชื่อม Facebook Page'])
  assertEquals(outbox(sb)[0].status, 'failed')
})

Deno.test('แชท Facebook นอกช่อง 24 ชม. → ไม่ส่ง บันทึกเหตุผลในข้อความ', async () => {
  const chat = { id: 'ch1', channel: 'facebook', external_id: CUST.fbPsid, customer_id: 'c1', data: { lastInboundAt: new Date(NOW - 30 * 3600e3).toISOString(), messages: [] }, updated_at: '2026-11-13T10:00:00Z' }
  const sb = fakeSb([chat])
  await execPlan(ctxOf(sb, { rules: [{ ...RULES[0], channels: ['facebook'] }], chats: [chat] }), plan({}))
  const msg: Any = (sb.updates.find((u: Any) => u.table === 'punpang_chats') as Any).patch.data.messages[0]
  assertEquals(msg.deliveryError, 'เกิน 24 ชั่วโมงหลังลูกค้าทักล่าสุด ส่งทาง Messenger ไม่ได้')
})

Deno.test('กฎถูกปิด → ไม่มีคิวข้อความ (กระดิ่งยังขึ้นตามแอป)', async () => {
  const sb = fakeSb([])
  await execPlan(ctxOf(sb, { rules: [{ ...RULES[0], enabled: false }] }), plan({}))
  assertEquals(outbox(sb).length, 0)
  assertEquals(bells(sb).length >= 1, true)
})

Deno.test('ลูกค้าไม่รับข่าวสาร → ไม่ส่งและไม่ขึ้นกระดิ่งเมื่อเป็นข้อความการตลาด', async () => {
  const sb = fakeSb([])
  const cust = { ...CUST, promoOptIn: false }
  await execPlan(ctxOf(sb), plan({ event: 'points_expiring', order: null, orderId: null, customer: cust, vars: { ชื่อลูกค้า: 'คุณมะลิ', คะแนน: '120' } }))
  assertEquals(outbox(sb).length, 0)
  assertEquals(bells(sb).length, 0)
})

// ข้อความการตลาดต้องมี promoOptIn === true และเวลายินยอม · ข้อมูลเดิมที่ไม่มีคีย์หรือไม่มีเวลาต้องไม่ถูกนับเป็นความยินยอม
const MKT_VARS = { ชื่อลูกค้า: 'คุณมะลิ', คะแนน: '120' }
Deno.test('ลูกค้าไม่มีคีย์ความยินยอม (ข้อมูลเดิม) → ไม่ส่งและไม่ขึ้นกระดิ่งเมื่อเป็นข้อความการตลาด', async () => {
  const sb = fakeSb([])
  const cust: Any = { ...CUST }
  delete cust.promoOptIn
  await execPlan(ctxOf(sb), plan({ event: 'points_expiring', order: null, orderId: null, customer: cust, vars: MKT_VARS }))
  assertEquals(outbox(sb).length, 0)
  assertEquals(bells(sb).length, 0)
})

Deno.test('เปิดรับแต่ไม่มีเวลายินยอม → ไม่ส่งข้อความการตลาด', async () => {
  const sb = fakeSb([])
  const cust: Any = { ...CUST, promoOptIn: true }
  delete cust.promoConsentAt
  await execPlan(ctxOf(sb), plan({ event: 'points_expiring', order: null, orderId: null, customer: cust, vars: MKT_VARS }))
  assertEquals(outbox(sb).length, 0)
  assertEquals(bells(sb).length, 0)
})

Deno.test('เปิดรับและมีเวลายินยอม → ข้อความการตลาดถูกส่งเข้าคิว', async () => {
  const chat = { id: 'ch1', channel: 'facebook', external_id: CUST.fbPsid, customer_id: 'c1', data: { lastInboundAt: new Date(NOW - 3600e3).toISOString(), messages: [] }, updated_at: '2026-11-14T10:00:00Z' }
  const sb = fakeSb([chat])
  const cust = { ...CUST, promoOptIn: true, promoConsentAt: '2026-11-01T10:00:00.000Z' }
  await execPlan(ctxOf(sb, { chats: [chat] }), plan({ event: 'points_expiring', order: null, orderId: null, customer: cust, vars: MKT_VARS }))
  assertEquals(outbox(sb).length, 1)
})

Deno.test('ข้อความที่ไม่ใช่การตลาด (เตือนนัดรับ) ยังส่งได้แม้ลูกค้าไม่มีคีย์ความยินยอม', async () => {
  const chat = { id: 'ch1', channel: 'facebook', external_id: CUST.fbPsid, customer_id: 'c1', data: { lastInboundAt: new Date(NOW - 3600e3).toISOString(), messages: [] }, updated_at: '2026-11-14T10:00:00Z' }
  const sb = fakeSb([chat])
  const cust: Any = { ...CUST }
  delete cust.promoOptIn
  await execPlan(ctxOf(sb, { chats: [chat] }), plan({ customer: cust }))
  assertEquals(outbox(sb).length > 0, true) // เตือนนัดรับมีหลายช่องทาง (Facebook/SMS) ขอแค่ไม่ถูกบล็อก
})

Deno.test('ทีม: Telegram ปิดอยู่ → ไม่ส่ง (มีแค่กระดิ่งทีม)', async () => {
  const sb = fakeSb([])
  await execPlan(ctxOf(sb, { integrations: { ...INTEG, telegram: { enabled: false } } }), plan({ kind: 'team', event: 'team_due_soon', customer: null }))
  assertEquals(outbox(sb).length, 0)
  assertEquals(bells(sb).map((b: Any) => [b.audience, b.event]), [['staff', 'team_due_soon']])
})

Deno.test('กันส่งซ้ำ: คีย์ที่จองไปแล้วถูกข้าม และไม่ส่งซ้ำ', async () => {
  const sb = fakeSb([])
  const ctx = ctxOf(sb, { rules: [{ ...RULES[0], channels: ['sms'] }] })
  const p = plan({ key: 'pickup|o1' })
  const first = await runPlans(ctx, [p])
  const second = await runPlans(ctx, [p])
  assertEquals([first.done, first.skipped], [1, 0])
  assertEquals([second.done, second.skipped], [0, 1])
  assertEquals(outbox(sb).length, 1)
})

Deno.test('ทุกออเดอร์: มีแชทเว็บ → ส่งเข้าแชทเว็บก่อน แล้วค่อย SMS (แม้ออร์เดอร์มาจาก Facebook)', async () => {
  const chat = { id: 'chw1', channel: 'web', customer_id: 'c1', data: { messages: [] }, updated_at: '2026-11-14T10:00:00Z' }
  const sb = fakeSb([chat])
  await execPlan(ctxOf(sb, { rules: [{ ...RULES[0], channels: ['web', 'sms'] }], chats: [chat] }), plan({}))
  assertEquals(outbox(sb).map((o: Any) => [o.channel, o.status]), [['web', 'sent'], ['sms', 'failed']])
  assertEquals(sb.updates.some((u: Any) => u.table === 'punpang_chats'), true)
})

Deno.test('มีบัญชีเว็บแต่ยังไม่มีแชท → สร้างแชทเว็บให้ แล้วส่งเข้าแชท', async () => {
  const sb = fakeSb([], [{ customer_id: 'c1' }])
  await execPlan(ctxOf(sb, { rules: [{ ...RULES[0], channels: ['web'] }] }), plan({}))
  assertEquals(sb.inserts.filter((i: Any) => i.table === 'punpang_chats').map((i: Any) => [i.row.channel, i.row.customer_id]), [['web', 'c1']])
  assertEquals(outbox(sb).map((o: Any) => [o.channel, o.status]), [['web', 'sent']])
})

Deno.test('ไม่มีบัญชีเว็บและไม่มีแชท → ข้ามช่องเว็บ ส่งเฉพาะ SMS และไม่สร้างแชท', async () => {
  const sb = fakeSb([], [])
  await execPlan(ctxOf(sb, { rules: [{ ...RULES[0], channels: ['web', 'sms'] }] }), plan({}))
  assertEquals(outbox(sb).map((o: Any) => o.channel), ['sms'])
  assertEquals(sb.inserts.some((i: Any) => i.table === 'punpang_chats'), false)
})
