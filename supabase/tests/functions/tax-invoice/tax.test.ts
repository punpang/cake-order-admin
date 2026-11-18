// ทดสอบ tax-invoice: ใบกำกับภาษีเต็มรูปที่ลูกค้าขอเอง · ดูด้วยลิงก์ออร์เดอร์ (view) หรือเซสชันลูกค้า (state/request/edit)
// ครอบคลุม: เมธอด · โหมดทดสอบ 409 · คำขอเสีย · เซสชัน · ออร์เดอร์ของคนอื่น/ร่าง · ลิงก์ที่ถูกต้องดูเอกสารได้ · ลิงก์ที่ผิด 404
// รัน: deno test -A --no-lock --node-modules-dir=none --import-map=supabase/tests/functions/_fake/importmap.json supabase/tests/functions/tax-invoice/
import { assertEquals, assert } from 'jsr:@std/assert@1'

let handler: (r: Request) => Promise<Response> = null as any
;(Deno as any).serve = (h: any) => { handler = h; return { finished: Promise.resolve(), shutdown: async () => {} } }
Deno.env.set('SUPABASE_URL', 'http://db.fake')
Deno.env.set('SUPABASE_ANON_KEY', 'anon')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service')
await import('../../../functions/tax-invoice/index.ts')

const enc = new TextEncoder()
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')
const sha = async (s: string) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)))
const SESSION = 'a'.repeat(64)
const LINK = 'L'.repeat(32)
const ORDER = 'o1'
const CUST = 'c1'
const future = () => new Date(Date.now() + 3600e3).toISOString()

async function seed({ orderStatus = 'delivered', sessionOk = true }: { orderStatus?: string; sessionOk?: boolean } = {}) {
  ;(globalThis as any).__DB = { t: {
    'public.punpang_customer_sessions': sessionOk ? [{ token_hash: await sha(`custsess:${SESSION}`), customer_id: CUST, expires_at: future() }] : [],
    'public.punpang_orders': [
      { id: ORDER, code: 'ORD1', customer_id: CUST, status: orderStatus, data: { items: [], payments: [], total: 0 } },
      { id: 'o-other', code: 'ORD2', customer_id: 'someone-else', status: 'delivered', data: {} },
      { id: 'o-draft', code: 'ORD3', customer_id: CUST, status: 'draft', data: {} },
    ],
    'public.punpang_kv': [{ collection: 'config', id: 'shop', data: { v: { vat: { rate: 7, mode: 'inclusive' } } } }],
    'public.punpang_acct_invoices': [],
    'public.punpang_records': [{ collection: 'orderLinks', id: 'lk1', data: {
      tokenHash: await sha(`orderlink:${LINK}`), orderId: ORDER, createdAt: new Date().toISOString(), lastOpenedAt: null,
    } }],
    'public.punpang_customers': [{ id: CUST, data: {} }],
  } }
}
const call = async (body: unknown, method = 'POST', test = false) => {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (test) h['x-punpang-mode'] = 'test'
  const r = await handler(new Request('http://x', { method, headers: h, body: method === 'GET' ? undefined : typeof body === 'string' ? body : JSON.stringify(body) }))
  return { status: r.status, body: await r.json() }
}

Deno.test('ใช้ POST เท่านั้น → 405', async () => {
  await seed()
  assertEquals((await call({ action: 'state' }, 'GET')).status, 405)
})

Deno.test('โหมดทดสอบ → 409 ไม่ออกใบ', async () => {
  await seed()
  assertEquals((await call({ action: 'state' }, 'POST', true)).status, 409)
})

Deno.test('คำขอ JSON เสีย → 400', async () => {
  await seed()
  assertEquals((await call('{เสีย')).status, 400)
})

Deno.test('คำสั่งที่ไม่รู้จัก → 400', async () => {
  await seed()
  assertEquals((await call({ action: 'hack', session: SESSION })).status, 400)
})

Deno.test('ลิงก์ออร์เดอร์รูปแบบผิด หรือไม่รู้จัก → 404 ข้อความเดียวกัน', async () => {
  await seed()
  const a = await call({ action: 'view', token: 'สั้น' })
  const b = await call({ action: 'view', token: 'Z'.repeat(32) })
  assertEquals(a.status, 404)
  assertEquals(b.status, 404)
  assertEquals(a.body.error, b.body.error)
})

Deno.test('ลิงก์ออร์เดอร์ที่ถูกต้อง → ดูประวัติใบกำกับได้ (ว่างเมื่อยังไม่ออกใบ)', async () => {
  await seed()
  const r = await call({ action: 'view', token: LINK })
  assertEquals(r.status, 200)
  assertEquals(r.body.history, [])
})

Deno.test('ไม่มีเซสชันลูกค้า → 401 ให้เข้าสู่ระบบก่อน', async () => {
  await seed()
  assertEquals((await call({ action: 'state', orderId: ORDER })).status, 401)
})

Deno.test('ออร์เดอร์ของลูกค้าคนอื่น หรือร่าง → 404 (ไม่เปิดเผยว่ามีอยู่)', async () => {
  await seed()
  assertEquals((await call({ action: 'state', session: SESSION, orderId: 'o-other' })).status, 404)
  assertEquals((await call({ action: 'state', session: SESSION, orderId: 'o-draft' })).status, 404)
})

Deno.test('สถานะใบกำกับของออร์เดอร์ตัวเอง → ตอบ state ได้', async () => {
  await seed()
  const r = await call({ action: 'state', session: SESSION, orderId: ORDER })
  assertEquals(r.status, 200)
  assertEquals(r.body.ok, true)
  assert(r.body.state && typeof r.body.state === 'object')
})

Deno.test('ขอใบด้วยข้อมูลผู้ซื้อไม่ครบ → 400 ไม่สร้างใบ', async () => {
  await seed()
  const r = await call({ action: 'request', session: SESSION, orderId: ORDER, buyer: {} })
  assertEquals(r.status, 400)
  assert(typeof r.body.error === 'string')
  assertEquals((globalThis as any).__DB.t['public.punpang_acct_invoices'].length, 0)
})
