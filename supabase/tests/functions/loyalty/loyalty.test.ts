// ทดสอบ customer-loyalty (แลกของ/หมุนกาชาของลูกค้า) ทั้งฟังก์ชัน: ยิงคำขอจริงเข้า handler กับฐานข้อมูลจำลอง
// ครอบคลุม: เซสชัน (ไม่มี/รูปแบบผิด/หมดอายุ) · คำสั่งที่ไม่รู้จัก · ส่ง p_customer จากเซสชัน (ไม่ใช่จากคำขอ) ·
// แปลงผลฐานข้อมูลเป็นข้อความไทย · ข้อผิดพลาดระบบไม่รั่วรายละเอียด · โหมดทดสอบถูกปฏิเสธ
// รัน: deno test -A --no-lock --node-modules-dir=none --import-map=supabase/tests/functions/_fake/importmap.json supabase/tests/functions/loyalty/
import { assert, assertEquals } from 'jsr:@std/assert@1'

let handler: (r: Request) => Promise<Response> = null as any
;(Deno as any).serve = (h: any) => { handler = h; return { finished: Promise.resolve(), shutdown: async () => {} } }
Deno.env.set('SUPABASE_URL', 'http://db.fake')
Deno.env.set('SUPABASE_ANON_KEY', 'anon')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service')
await import('../../../functions/customer-loyalty/index.ts')

const enc = new TextEncoder()
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')
const sha = async (s: string) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)))
const TOKEN = 'a'.repeat(64)
const call = async (body: any, headers: Record<string, string> = {}) => {
  const r = await handler(new Request('http://x', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }))
  return { status: r.status, body: await r.json() }
}
async function seed(expiresAt = new Date(Date.now() + 3600e3).toISOString()) {
  ;(globalThis as any).__RPC = {}
  ;(globalThis as any).__DB = { t: {
    'public.punpang_customer_sessions': [{ token_hash: await sha(`custsess:${TOKEN}`), customer_id: 'c1', expires_at: expiresAt }],
    'public.punpang_customers': [{ id: 'c1', name: 'ทดสอบ', phone: '0812345678', data: { ledger: [], scanCode: 'f'.repeat(32) } }],
    'public.punpang_records': [
      { collection: 'coupons', id: 'cp1', data: { customerId: 'c1', name: 'คูปองของ c1' } },
      { collection: 'coupons', id: 'cp2', data: { customerId: 'c2', name: 'คูปองของคนอื่น' } },
    ],
  } }
}

Deno.test('ไม่มีเซสชัน หรือเซสชันรูปแบบผิด → 401 และไม่เรียกฐานข้อมูล', async () => {
  await seed()
  assertEquals((await call({ action: 'redeem', rewardId: 'r1' })).status, 401)
  const bad = await call({ action: 'redeem', rewardId: 'r1', session: 'xyz' })
  assertEquals(bad.status, 401)
})

Deno.test('เซสชันหมดอายุ → 401 ให้เข้าสู่ระบบใหม่', async () => {
  await seed(new Date(Date.now() - 1000).toISOString())
  const r = await call({ action: 'redeem', rewardId: 'r1', session: TOKEN })
  assertEquals(r.status, 401)
  assert(r.body.error.includes('เข้าสู่ระบบใหม่'), r.body.error)
})

Deno.test('คำสั่งที่ไม่รู้จัก → 400', async () => {
  await seed()
  const r = await call({ action: 'hack', session: TOKEN })
  assertEquals(r.status, 400)
})

Deno.test('แลกของ: ส่ง p_customer จากเซสชัน (ไม่ใช่จากคำขอ) และตอบข้อมูลลูกค้ากับคูปองของตัวเองเท่านั้น', async () => {
  await seed()
  const calls: any[] = []
  ;(globalThis as any).__RPC.punpang_cust_redeem = async (a: any) => { calls.push(a); return { data: { ok: true }, error: null } }
  const r = await call({ action: 'redeem', rewardId: 'r1', session: TOKEN, customer: 'c2' })
  assertEquals(r.status, 200)
  assertEquals(calls, [{ p_customer: 'c1', p_reward: 'r1' }])
  assertEquals(r.body.customer.id, 'c1')
  assertEquals(r.body.customer.scanCode, 'f'.repeat(32))
  assertEquals(r.body.coupons.map((c: any) => c.id), ['cp1'])
})

Deno.test('ผลจากฐานข้อมูลที่ไม่สำเร็จ → 400 พร้อมข้อความไทยและรหัส', async () => {
  await seed()
  ;(globalThis as any).__RPC.punpang_cust_spin = async () => ({ data: { error: 'insufficient' }, error: null })
  const r = await call({ action: 'spin', usePoints: true, session: TOKEN })
  assertEquals(r.status, 400)
  assertEquals(r.body.code, 'insufficient')
  assertEquals(r.body.error, 'คะแนนไม่พอ')
})

Deno.test('ข้อผิดพลาดของฐานข้อมูล → 500 ข้อความทั่วไป ไม่รั่วรายละเอียด', async () => {
  await seed()
  ;(globalThis as any).__RPC.punpang_cust_redeem = async () => ({ data: null, error: { message: 'relation secret_table does not exist' } })
  const r = await call({ action: 'redeem', rewardId: 'r1', session: TOKEN })
  assertEquals(r.status, 500)
  assertEquals(r.body.error, 'ทำรายการไม่สำเร็จ กรุณาลองใหม่')
  assert(!JSON.stringify(r.body).includes('secret_table'))
})

Deno.test('โหมดทดสอบ → ถูกปฏิเสธ (409) ไม่เรียกฐานข้อมูล', async () => {
  await seed()
  const r = await call({ action: 'redeem', rewardId: 'r1', session: TOKEN }, { 'x-punpang-mode': 'test' })
  assertEquals(r.status, 409)
})
