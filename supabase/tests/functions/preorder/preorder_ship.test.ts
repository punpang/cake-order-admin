// ทดสอบ action ของ Edge Function preorder เรื่องการจัดส่งและการรับคืน: state (มุมมองลูกค้า) และ return_request
// ครอบ: ดูเฉพาะออร์เดอร์ตัวเอง · มีเลขพัสดุ/ยอดคงค้าง · ไม่รั่วรหัสอ้างอิงการชำระ · ขอคืนต้องเป็นเจ้าของ เหตุผลไม่ว่าง และอยู่ในสถานะที่ขอได้
// รัน: deno test -A --no-lock --node-modules-dir=none --unstable-sloppy-imports --import-map=supabase/tests/functions/_fake/importmap.json supabase/tests/functions/preorder/preorder_ship.test.ts
import { assert, assertEquals } from 'jsr:@std/assert@1'

let handler: (r: Request) => Promise<Response> = null as any
;(Deno as any).serve = (h: any) => { handler = h; return { finished: Promise.resolve(), shutdown: async () => {} } }
Deno.env.set('SUPABASE_URL', 'http://db.fake')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service')
await import('../../../functions/preorder/index.ts')

const TOKEN = 'd'.repeat(64)
const MINE = 'a'.repeat(32)
const OTHER = 'b'.repeat(32)
const sha = async (s: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((x) => x.toString(16).padStart(2, '0')).join('')
const call = (body: any) => handler(new Request('http://fn/preorder', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))

async function seed() {
  ;(globalThis as any).__DB = { t: {
    'public.punpang_preorder_sessions': [{ token_hash: await sha('presess:' + TOKEN), customer_id: 'cA', expires_at: new Date(Date.now() + 3600e3).toISOString() }],
    'public.punpang_preorder_orders': [
      { id: MINE, code: 'PRE-241124-000009', status: 'shipped', campaign_id: 'c_open', pickup_date: '2099-12-24', customer_id: 'cA', data: {
        fulfillment: 'delivery', total: 130, deposit: { percent: 50, amount: 65 }, payDueAt: null, shippingFee: 30,
        payments: [{ id: 'p1', amount: 100, method: 'qr', status: 'confirmed', qrRef: 'PRE241124000001ABCDE', bankRef: 'SECRETREF' }, { id: 'p2', amount: 20, method: 'qr', status: 'reported', qrRef: 'PRE241124000002ABCDE' }],
        shipping: { carrier: 'Kerry', trackingNo: 'TH-123456', shippedAt: '2099-01-01T00:00:00.000Z' },
      } },
      { id: OTHER, code: 'PRE-241124-000010', status: 'delivered', campaign_id: 'c_open', pickup_date: '2099-12-24', customer_id: 'cB', data: { total: 200, fulfillment: 'delivery' } },
    ],
    'public.punpang_kv': [],
  } }
  ;(globalThis as any).__RPC = {}
  ;(globalThis as any).__RPC_CALLS = []
}

Deno.test('state: เห็นเฉพาะออร์เดอร์ตัวเอง มีเลขพัสดุและยอดคงค้าง และไม่รั่วรหัสอ้างอิงการชำระ', async () => {
  await seed()
  const r = await call({ action: 'state', token: TOKEN })
  assertEquals(r.status, 200)
  const j = await r.json()
  assertEquals(j.orders.map((o: any) => o.id), [MINE])
  const o = j.orders[0]
  assertEquals(o.shipping.trackingNo, 'TH-123456')
  assertEquals(o.paid, 100)
  assertEquals(o.balanceDue, 30)
  const text = JSON.stringify(j)
  assert(!text.includes('SECRETREF') && !text.includes('qrRef') && !text.includes('PRE241124000002ABCDE'), 'ต้องไม่มีรหัสอ้างอิงการชำระ')
})

Deno.test('return_request: ไม่มีเซสชัน → 401 · ของคนอื่น → 404 · เหตุผลว่าง → 400', async () => {
  await seed()
  assertEquals((await call({ action: 'return_request', token: 'x', orderId: MINE, reason: 'ไม่ตรงปก' })).status, 401)
  assertEquals((await call({ action: 'return_request', token: TOKEN, orderId: OTHER, reason: 'ไม่ตรงปก' })).status, 404)
  assertEquals((await call({ action: 'return_request', token: TOKEN, orderId: MINE, reason: '   ' })).status, 400)
  assertEquals((globalThis as any).__RPC_CALLS.length, 0)
})

Deno.test('return_request สำเร็จ: ส่งเหตุผลไปที่ฐานข้อมูล · สถานะไม่เหมาะสมคืน 409', async () => {
  await seed()
  ;(globalThis as any).__RPC.punpang_preorder_request_return = async (args: any) => { (globalThis as any).__RPC_CALLS.push(args); return { data: { ok: true, already: false }, error: null } }
  const r = await call({ action: 'return_request', token: TOKEN, orderId: MINE, reason: 'ไม่ตรงปก' })
  assertEquals(r.status, 200)
  assertEquals((globalThis as any).__RPC_CALLS[0], { p_order: MINE, p_reason: 'ไม่ตรงปก' })
  ;(globalThis as any).__RPC.punpang_preorder_request_return = async () => ({ data: { error: 'bad_status' }, error: null })
  assertEquals((await call({ action: 'return_request', token: TOKEN, orderId: MINE, reason: 'ไม่ตรงปก' })).status, 409)
})
