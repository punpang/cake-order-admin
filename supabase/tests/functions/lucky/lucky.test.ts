// ทดสอบ lucky-spin (ลุ้นโชคท้ายบิล) ทั้งฟังก์ชัน: ยิงคำขอจริงเข้า handler กับฐานข้อมูลจำลอง
// ครอบคลุม: token รูปแบบผิด/ไม่พบ/หมดเวลา · ดูโครงการ (ไม่รั่ว tokenHash) · ลุ้นต้องมีเซสชันสมาชิก ·
// แปลงผลฐานข้อมูลเป็นสถานะ HTTP และข้อความ · ลุ้นสำเร็จแล้วอ่านมุมมองใหม่ (จำนวนที่เหลือ/ประวัติ)
// รัน: deno test -A --no-lock --node-modules-dir=none --import-map=supabase/tests/functions/_fake/importmap.json supabase/tests/functions/lucky/
import { assert, assertEquals } from 'jsr:@std/assert@1'

let handler: (r: Request) => Promise<Response> = null as any
;(Deno as any).serve = (h: any) => { handler = h; return { finished: Promise.resolve(), shutdown: async () => {} } }
Deno.env.set('SUPABASE_URL', 'http://db.fake')
Deno.env.set('SUPABASE_ANON_KEY', 'anon')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service')
await import('../../../functions/lucky-spin/index.ts')

const enc = new TextEncoder()
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')
const sha = async (s: string) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)))
const TOKEN = 'T'.repeat(32)
const SESSION = 'c'.repeat(64)
const PROJECT = 'p1'
const future = () => new Date(Date.now() + 3600e3).toISOString()
let ipn = 0
const call = async (body: any) => {
  const r = await handler(new Request('http://x', { method: 'POST', headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': `10.0.0.${++ipn}` }, body: JSON.stringify(body) }))
  return { status: r.status, body: await r.json() }
}
async function seed({ expiresAt = future(), token = TOKEN, session = true }: { expiresAt?: string; token?: string; session?: boolean } = {}) {
  ;(globalThis as any).__RPC = {}
  const luckyDraw = { projects: [{ id: PROJECT, name: 'โปรลุ้นทดสอบ', kind: 'items', enabled: true, from: '2020-01-01T00:00:00Z', to: future(), prizes: [{ id: 'x1', name: 'ของแถม', kind: 'item', amount: 0, points: 0 }] }] }
  ;(globalThis as any).__DB = { t: {
    'public.punpang_records': [{ collection: 'luckyTokens', id: 'lt1', data: { tokenHash: await sha(`luckydraw:${token}`), expiresAt, draws: { [PROJECT]: 2 }, spins: [] } }],
    'public.punpang_kv': [{ collection: 'config', id: 'shop', data: { v: { luckyDraw } } }],
    'public.punpang_customer_sessions': session ? [{ token_hash: await sha(`custsess:${SESSION}`), customer_id: 'c1', expires_at: future() }] : [],
    'public.punpang_customers': [{ id: 'c1', name: 'ทดสอบ', phone: '0812345678', data: {} }],
  } }
}

Deno.test('token รูปแบบผิด หรือไม่พบ → 404 ข้อความเดียวกัน (ไม่บอกว่าอะไรผิด)', async () => {
  await seed()
  const a = await call({ token: 'สั้น' })
  assertEquals(a.status, 404)
  const b = await call({ token: 'U'.repeat(32) })
  assertEquals(b.status, 404)
  assertEquals(a.body.error, b.body.error)
})

Deno.test('ดูโครงการของบิล: แสดงจำนวนที่ลุ้นได้ และไม่รั่ว tokenHash', async () => {
  await seed()
  const r = await call({ token: TOKEN })
  assertEquals(r.status, 200)
  const p = r.body.projects[0]
  assertEquals([p.id, p.draws, p.remaining, p.state], [PROJECT, 2, 2, 'ready'])
  assert(!JSON.stringify(r.body).includes('tokenHash'), 'รั่ว tokenHash')
})

Deno.test('token หมดเวลา → 410', async () => {
  await seed({ expiresAt: new Date(Date.now() - 1000).toISOString() })
  const r = await call({ token: TOKEN })
  assertEquals(r.status, 410)
})

Deno.test('ลุ้นโดยไม่มีเซสชันสมาชิก → 401 ให้เข้าสู่ระบบก่อน', async () => {
  await seed()
  const r = await call({ token: TOKEN, spin: true, project: PROJECT })
  assertEquals(r.status, 401)
  assertEquals(r.body.code, 'login')
})

Deno.test('ลุ้นโดยไม่ระบุโครงการที่ถูกต้อง → 400', async () => {
  await seed()
  const r = await call({ token: TOKEN, spin: true, session: SESSION, project: 'ไม่ถูก/รูปแบบ' })
  assertEquals(r.status, 400)
})

Deno.test('ผลฐานข้อมูลปิดการลุ้น (closed) → 409 พร้อมข้อความไทย', async () => {
  await seed()
  ;(globalThis as any).__RPC.punpang_lucky_spin = async () => ({ data: { error: 'closed' }, error: null })
  const r = await call({ token: TOKEN, spin: true, session: SESSION, project: PROJECT })
  assertEquals(r.status, 409)
  assert(r.body.error.includes('ปิดการลุ้น'), r.body.error)
})

Deno.test('ลุ้นสำเร็จ: ส่ง p_customer จากเซสชัน แล้วตอบมุมมองใหม่ (เหลือลดลง และมีประวัติการลุ้นของสมาชิกนี้)', async () => {
  await seed()
  const calls: any[] = []
  ;(globalThis as any).__RPC.punpang_lucky_spin = async (a: any) => {
    calls.push(a)
    const db = (globalThis as any).__DB.t['public.punpang_records']
    const rec = db.find((x: any) => x.id === 'lt1')
    rec.data.spins.push({ projectId: PROJECT, customerId: 'c1', at: new Date().toISOString(), prize: { id: 'x1', name: 'ของแถม', kind: 'item', amount: 0, points: 0 } })
    return { data: { ok: true }, error: null }
  }
  const r = await call({ token: TOKEN, spin: true, session: SESSION, project: PROJECT })
  assertEquals(r.status, 200)
  assertEquals(calls.length, 1)
  assertEquals(calls[0].p_customer, 'c1')
  assertEquals(calls[0].p_project, PROJECT)
  const p = r.body.projects[0]
  assertEquals([p.remaining, p.state], [1, 'ready'])
  assertEquals(p.spins.length, 1)
  assertEquals(p.spins[0].prize.name, 'ของแถม')
})

Deno.test('ข้อผิดพลาดของ rpc (ระบบ) → 500 ข้อความทั่วไป', async () => {
  await seed()
  ;(globalThis as any).__RPC.punpang_lucky_spin = async () => ({ data: null, error: { message: 'internal detail' } })
  const r = await call({ token: TOKEN, spin: true, session: SESSION, project: PROJECT })
  assertEquals(r.status, 500)
  assert(!JSON.stringify(r.body).includes('internal detail'))
})
