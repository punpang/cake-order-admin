// ทดสอบ action ของ Edge Function preorder สำหรับออร์เดอร์สั่งล่วงหน้า: qr_request (คำขอ QR) และ extension_request (ขอขยายเวลา)
// ครอบ: ต้องมีเซสชัน · ออร์เดอร์ของคนอื่นไม่เห็น · ยอดไม่ถูกต้อง · ร้านยังไม่ตั้งพร้อมเพย์ · รหัส PRE ซ้ำแล้วสร้างใหม่ · สถานะที่รับไม่ได้ · ขอขยายเวลา
// รัน: deno test -A --no-lock --node-modules-dir=none --unstable-sloppy-imports --import-map=supabase/tests/functions/_fake/importmap.json supabase/tests/functions/preorder/preorder_qr.test.ts
import { assert, assertEquals } from 'jsr:@std/assert@1'

let handler: (r: Request) => Promise<Response> = null as any
;(Deno as any).serve = (h: any) => { handler = h; return { finished: Promise.resolve(), shutdown: async () => {} } }
Deno.env.set('SUPABASE_URL', 'http://db.fake')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service')
await import('../../../functions/preorder/index.ts')

const TOKEN = 'c'.repeat(64)
const MINE = 'a'.repeat(32)
const OTHER = 'b'.repeat(32)
const BILLER = '012345678901234'
const sha = async (s: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((x) => x.toString(16).padStart(2, '0')).join('')
const call = (body: any) => handler(new Request('http://fn/preorder', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))

async function seed(shop: any = { billerId: BILLER, merchantCode: '1234567', payment: {} }) {
  ;(globalThis as any).__DB = { t: {
    'public.punpang_preorder_sessions': [{ token_hash: await sha('presess:' + TOKEN), customer_id: 'cA', expires_at: new Date(Date.now() + 3600e3).toISOString() }],
    'public.punpang_preorder_orders': [
      { id: MINE, code: 'PRE-241124-000009', status: 'awaiting_payment', campaign_id: 'c_open', pickup_date: '2099-12-24', customer_id: 'cA', data: { total: 200, deposit: { percent: 50, amount: 100 } } },
      { id: OTHER, code: 'PRE-241124-000010', status: 'awaiting_payment', campaign_id: 'c_open', pickup_date: '2099-12-24', customer_id: 'cB', data: { total: 200 } },
    ],
    'public.punpang_kv': [{ collection: 'config', id: 'shop', data: { v: shop } }],
  } }
  ;(globalThis as any).__RPC = {}
  ;(globalThis as any).__RPC_CALLS = []
}
const rpcCalls = (): any[] => (globalThis as any).__RPC_CALLS ?? ((globalThis as any).__RPC_CALLS = [])

Deno.test('qr_request: ไม่มีเซสชัน → 401', async () => {
  await seed()
  const r = await call({ action: 'qr_request', token: 'x', orderId: MINE, amount: 50 })
  assertEquals(r.status, 401)
})

Deno.test('qr_request: ออร์เดอร์ของคนอื่นไม่เห็น → 404 และไม่เรียกฐานข้อมูลเขียน', async () => {
  await seed()
  const r = await call({ action: 'qr_request', token: TOKEN, orderId: OTHER, amount: 50 })
  assertEquals(r.status, 404)
  assertEquals(rpcCalls().length, 0)
})

Deno.test('qr_request: ยอดไม่ถูกต้อง (0 หรือทศนิยมเกิน 2 ตำแหน่ง) → 400', async () => {
  await seed()
  assertEquals((await call({ action: 'qr_request', token: TOKEN, orderId: MINE, amount: 0 })).status, 400)
  assertEquals((await call({ action: 'qr_request', token: TOKEN, orderId: MINE, amount: 10.555 })).status, 400)
})

Deno.test('qr_request: ร้านยังไม่ตั้งพร้อมเพย์ → 409', async () => {
  await seed({ payment: {} })
  const r = await call({ action: 'qr_request', token: TOKEN, orderId: MINE, amount: 50 })
  assertEquals(r.status, 409)
})

Deno.test('qr_request สำเร็จ: รหัส PRE ตามรูปแบบ ยอดและออร์เดอร์ถูกส่งไปที่ฐานข้อมูล และได้ payload พร้อมเพย์', async () => {
  await seed()
  ;(globalThis as any).__RPC.punpang_preorder_request_qr = async (args: any) => { rpcCalls().push(args); return { data: { ok: true, qrRef: args.p_qr_ref, amount: args.p_amount }, error: null } }
  const r = await call({ action: 'qr_request', token: TOKEN, orderId: MINE, amount: 50 })
  assertEquals(r.status, 200)
  const j = await r.json()
  assert(/^PRE241124\d{6}[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/.test(j.qrRef), 'รูปแบบรหัส PRE: ' + j.qrRef)
  assertEquals(rpcCalls()[0], { p_order: MINE, p_amount: 50, p_qr_ref: j.qrRef })
  assert(j.payload.startsWith('000201'), 'payload เริ่มด้วย tag ของ QR พร้อมเพย์')
  assert(j.payload.includes(BILLER) && j.payload.includes('1234567') && j.payload.includes(j.qrRef), 'payload มี Biller ร้านค้า และรหัส')
  assert(j.payload.includes('5405' + '50.00'), 'payload ล็อกยอด 50.00')
})

Deno.test('qr_request: รหัส PRE ซ้ำในฐานข้อมูล → สร้างรหัสใหม่และสำเร็จ', async () => {
  await seed()
  let n = 0
  ;(globalThis as any).__RPC.punpang_preorder_request_qr = async (args: any) => {
    rpcCalls().push(args); n++
    return n === 1 ? { data: { error: 'ref_taken' }, error: null } : { data: { ok: true }, error: null }
  }
  const r = await call({ action: 'qr_request', token: TOKEN, orderId: MINE, amount: 50 })
  assertEquals(r.status, 200)
  assertEquals(rpcCalls().length, 2)
  assert(rpcCalls()[0].p_qr_ref !== rpcCalls()[1].p_qr_ref)
})

Deno.test('qr_request: สถานะที่รับไม่ได้ (หมดเวลาแล้ว) → 409 พร้อมข้อความให้ขอขยายเวลาก่อน', async () => {
  await seed()
  ;(globalThis as any).__RPC.punpang_preorder_request_qr = async () => ({ data: { error: 'bad_status' }, error: null })
  const r = await call({ action: 'qr_request', token: TOKEN, orderId: MINE, amount: 50 })
  assertEquals(r.status, 409)
  assert((await r.json()).error.includes('ขอขยายเวลา'))
})

Deno.test('extension_request: ของคนอื่น → 404 · หมดเวลาแล้ว → ส่งคำขอ · ซ้ำ → already · ยังไม่หมดเวลา → 409', async () => {
  await seed()
  assertEquals((await call({ action: 'extension_request', token: TOKEN, orderId: OTHER })).status, 404)
  ;(globalThis as any).__RPC.punpang_preorder_request_extension = async () => ({ data: { ok: true, already: false }, error: null })
  const a = await call({ action: 'extension_request', token: TOKEN, orderId: MINE })
  assertEquals((await a.json()).already, false)
  ;(globalThis as any).__RPC.punpang_preorder_request_extension = async () => ({ data: { ok: true, already: true }, error: null })
  assertEquals((await (await call({ action: 'extension_request', token: TOKEN, orderId: MINE })).json()).already, true)
  ;(globalThis as any).__RPC.punpang_preorder_request_extension = async () => ({ data: { error: 'bad_status' }, error: null })
  assertEquals((await call({ action: 'extension_request', token: TOKEN, orderId: MINE })).status, 409)
})
