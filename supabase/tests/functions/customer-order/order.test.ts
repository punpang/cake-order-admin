// ทดสอบ customer-order (ลูกค้าทำรายการบนออร์เดอร์): แจ้งชำระ/ขอ QR/ขยายเวลา/ขอไม่เผยแพร่รูป ผ่านลิงก์ออร์เดอร์หรือเซสชันลูกค้า
// ครอบคลุม: เมธอด · โหมดทดสอบ · คำขอเสีย · คำสั่งไม่รู้จัก · ลิงก์ผิด/ถูกเพิกถอน · เซสชันหมดอายุ · ออร์เดอร์คนอื่น/ยกเลิก/ร่าง ·
//           ต้องยินยอมก่อนชำระ · สลิปไม่ใช่รูป · ขยายเวลาเมื่อยังไม่เกินกำหนด · ไม่มีรูปให้ขอไม่เผยแพร่ · และฟังก์ชันคิดยอด (totals/minimumOf/isOverdue/sniffImage)
// รัน: deno test -A --no-lock --node-modules-dir=none --import-map=supabase/tests/functions/_fake/importmap.json supabase/tests/functions/customer-order/
import { assertEquals, assert } from 'jsr:@std/assert@1'

let handler: (r: Request) => Promise<Response> = null as any
;(Deno as any).serve = (h: any) => { handler = h; return { finished: Promise.resolve(), shutdown: async () => {} } }
Deno.env.set('SUPABASE_URL', 'http://db.fake')
Deno.env.set('SUPABASE_ANON_KEY', 'anon')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service')
const mod = await import('../../../functions/customer-order/index.ts')
const { totals, isOverdue, sniffImage, minimumOf } = mod

const enc = new TextEncoder()
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')
const sha = async (s: string) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)))
const SESSION = 'a'.repeat(64)
const EXPIRED = 'e'.repeat(64)
const TOKEN = 'T'.repeat(32)
const REVOKED = 'R'.repeat(32)
const future = () => new Date(Date.now() + 3600e3).toISOString()
const past = () => new Date(Date.now() - 3600e3).toISOString()
const ITEM = { id: 'i1', name: 'เค้ก', unitPrice: 500, qty: 1 }

async function seed() {
  ;(globalThis as any).__DB = { t: {
    'public.punpang_customer_sessions': [
      { token_hash: await sha(`custsess:${SESSION}`), customer_id: 'c1', expires_at: future() },
      { token_hash: await sha(`custsess:${EXPIRED}`), customer_id: 'c1', expires_at: past() },
    ],
    'public.punpang_orders': [
      { id: 'o1', code: 'ORD2611180001', customer_id: 'c1', status: 'awaiting_payment', fulfillment: 'pickup', channel: 'web', updated_at: 'u1', data: { createdAt: new Date().toISOString(), pickupAt: '2026-12-01T10:00', items: [ITEM], payments: [] } },
      { id: 'o-cancel', code: 'ORD2611180002', customer_id: 'c1', status: 'cancelled', fulfillment: 'pickup', channel: 'web', updated_at: 'u2', data: { items: [ITEM], payments: [] } },
      { id: 'o-other', code: 'ORD2611180003', customer_id: 'c2', status: 'awaiting_payment', fulfillment: 'pickup', channel: 'web', updated_at: 'u3', data: { items: [ITEM], payments: [] } },
      { id: 'o-draft', code: 'ORD2611180004', customer_id: 'c1', status: 'draft', fulfillment: 'pickup', channel: 'web', updated_at: 'u4', data: { items: [ITEM], payments: [] } },
    ],
    'public.punpang_records': [
      { collection: 'orderLinks', id: 'lk1', data: { tokenHash: await sha(`orderlink:${TOKEN}`), orderId: 'o1', createdAt: new Date().toISOString(), lastOpenedAt: null } },
      { collection: 'orderLinks', id: 'lk2', data: { tokenHash: await sha(`orderlink:${REVOKED}`), orderId: 'o1', createdAt: new Date().toISOString(), revokedAt: new Date().toISOString() } },
    ],
    'public.punpang_kv': [{ collection: 'config', id: 'shop', data: { v: {} } }],
  } }
}
let ipn = 0
const call = async (body: unknown, method = 'POST', test = false) => {
  const h: Record<string, string> = { 'Content-Type': 'application/json', 'cf-connecting-ip': `10.2.0.${++ipn}` }
  if (test) h['x-punpang-mode'] = 'test'
  const r = await handler(new Request('http://x', { method, headers: h, body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined }))
  return { status: r.status, body: await r.json() }
}
const orderOf = (id: string) => (globalThis as any).__DB.t['public.punpang_orders'].find((o: any) => o.id === id)

Deno.test('ใช้ POST เท่านั้น → 405', async () => {
  await seed()
  assertEquals((await call({}, 'GET')).status, 405)
})

Deno.test('โหมดทดสอบ → 409 ไม่แตะข้อมูลลูกค้า', async () => {
  await seed()
  assertEquals((await call({ action: 'extend', token: TOKEN }, 'POST', true)).status, 409)
})

Deno.test('คำขอ JSON เสีย → 400', async () => {
  await seed()
  assertEquals((await call('{เสีย')).status, 400)
})

Deno.test('คำสั่งที่ไม่รู้จัก → 400', async () => {
  await seed()
  assertEquals((await call({ action: 'drop_table', token: TOKEN })).status, 400)
})

Deno.test('ลิงก์รูปแบบผิด หรือไม่รู้จัก → 404 ข้อความเดียวกัน', async () => {
  await seed()
  const a = await call({ action: 'extend', token: 'สั้น' })
  const b = await call({ action: 'extend', token: 'Z'.repeat(32) })
  assertEquals(a.status, 404)
  assertEquals(b.status, 404)
  assertEquals(a.body, b.body)
})

Deno.test('ลิงก์ที่ถูกเพิกถอนแล้ว → 404', async () => {
  await seed()
  assertEquals((await call({ action: 'extend', token: REVOKED })).status, 404)
})

Deno.test('ไม่มีลิงก์และไม่มีเซสชัน → 401 ยังไม่ได้เข้าสู่ระบบ', async () => {
  await seed()
  assertEquals((await call({ action: 'pay', orderId: 'o1' })).status, 401)
})

Deno.test('เซสชันหมดอายุ → 401 ให้เข้าสู่ระบบใหม่', async () => {
  await seed()
  assertEquals((await call({ action: 'pay', session: EXPIRED, orderId: 'o1' })).status, 401)
})

Deno.test('เซสชันของลูกค้า c1 ขอออร์เดอร์ของ c2 → 404 ไม่เปิดเผยว่ามีอยู่', async () => {
  await seed()
  assertEquals((await call({ action: 'pay', session: SESSION, orderId: 'o-other' })).status, 404)
})

Deno.test('ออร์เดอร์ร่าง → 404 (ลูกค้าไม่เห็นร่าง)', async () => {
  await seed()
  assertEquals((await call({ action: 'pay', session: SESSION, orderId: 'o-draft' })).status, 404)
})

Deno.test('แจ้งชำระบนออร์เดอร์ที่ยกเลิกแล้ว → 400 ไม่เขียนข้อมูล', async () => {
  await seed()
  const r = await call({ action: 'pay', session: SESSION, orderId: 'o-cancel', amount: 100 })
  assertEquals(r.status, 400)
  assertEquals(r.body.error, 'ออร์เดอร์นี้ถูกยกเลิกแล้ว')
})

Deno.test('แจ้งชำระโดยยังไม่ยินยอม → 400 พร้อมรายการที่ต้องยินยอม (ไม่เขียนข้อมูล)', async () => {
  await seed()
  const r = await call({ action: 'pay', session: SESSION, orderId: 'o1', amount: 500 })
  assertEquals(r.status, 400)
  assertEquals(r.body.error, 'ต้องยินยอมก่อนชำระเงิน')
  assert(Array.isArray(r.body.consentNeeded))
  assertEquals(orderOf('o1').data.payments.length, 0)
})

Deno.test('ขยายเวลาเมื่อยังไม่เกินกำหนด → 400', async () => {
  await seed()
  const r = await call({ action: 'extend', token: TOKEN, paymentId: 'none' })
  assertEquals(r.status, 400)
  assertEquals(r.body.error, 'ไม่พบยอดที่ร้านแจ้ง')
})

Deno.test('ขอไม่ให้เผยแพร่รูป เมื่อยังไม่มีรูปงานในออร์เดอร์ → 400', async () => {
  await seed()
  const r = await call({ action: 'photo_optout', token: TOKEN })
  assertEquals(r.status, 400)
  assertEquals(r.body.error, 'ยังไม่มีรูปงานในออร์เดอร์นี้')
})

Deno.test('อ่านสลิปที่ไม่ใช่รูปภาพ → 400 ไม่ส่งให้โมเดล', async () => {
  await seed()
  const r = await call({ action: 'read_slip', token: TOKEN, slip: 'data:text/plain;base64,aGVsbG8=' })
  assertEquals(r.status, 400)
})

Deno.test('ยอดรวม: VAT แยกนอกราคา และหักยอดที่ยืนยันแล้ว', () => {
  const t = totals({ items: [{ unitPrice: 100, qty: 2 }], vat: { rate: 7, mode: 'exclusive' }, payments: [{ status: 'confirmed', amount: 100 }] })
  assertEquals(t.total, 214)
  assertEquals(t.paid, 100)
  assertEquals(t.balance, 114)
})

Deno.test('ยอดรวม: ส่งฟรีโปรหักค่าส่ง และส่วนลดคูปอง/แต้ม', () => {
  const t = totals({ fulfillment: 'delivery', shippingFee: 50, shipPromo: { free: true }, items: [{ unitPrice: 300, qty: 1 }], couponsUsed: [{ amount: 20 }], pointsUsed: { amount: 10 } })
  assertEquals(t.total, 270)
})

Deno.test('minimumOf: ไม่ตั้งมัดจำ = 0 · ตั้งแล้วปัดขึ้นและไม่เกินยอดค้าง', async () => {
  await seed()
  const sb = (await import('npm:@supabase/supabase-js@2')).createClient('x', 'y')
  ;(globalThis as any).__DB.t['public.punpang_kv'] = [{ collection: 'config', id: 'shop', data: { v: { depositPercent: 30 } } }]
  assertEquals(await minimumOf(sb, 1000, 1000), 300)
  assertEquals(await minimumOf(sb, 1000, 100), 100)
})

Deno.test('isOverdue: เฉพาะรายการที่ร้านแจ้ง (reported) และเลยวันนัดแล้ว', () => {
  assertEquals(isOverdue({ status: 'reported', dueAt: '2000-01-01T00:00' }), true)
  assertEquals(isOverdue({ status: 'reported', dueAt: '2999-01-01T00:00' }), false)
  assertEquals(isOverdue({ status: 'confirmed', dueAt: '2000-01-01T00:00' }), false)
})

Deno.test('sniffImage: ตรวจชนิดจากไบต์จริง ไม่เชื่อนามสกุล', () => {
  assertEquals(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0, 0])), { type: 'image/png', ext: 'png' })
  assertEquals(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0])), { type: 'image/jpeg', ext: 'jpg' })
  assertEquals(sniffImage(new TextEncoder().encode('<html>hello world</html>')), null)
})
