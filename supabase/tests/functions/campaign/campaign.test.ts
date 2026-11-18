// ทดสอบ campaign (ประชาสัมพันธ์/โปรโมชั่นถึงลูกค้า): เฉพาะผู้ดูแล (สิทธิ์ manage) · คำสั่งไม่รู้จัก/คำขอเสีย ถูกปฏิเสธ
// รัน: deno test -A --no-lock --node-modules-dir=none --import-map=supabase/tests/functions/_fake/importmap.json supabase/tests/functions/campaign/
import { assertEquals } from 'jsr:@std/assert@1'

let handler: (r: Request) => Promise<Response> = null as any
;(Deno as any).serve = (h: any) => { handler = h; return { finished: Promise.resolve(), shutdown: async () => {} } }
Deno.env.set('SUPABASE_URL', 'http://db.fake')
Deno.env.set('SUPABASE_ANON_KEY', 'anon')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service')
await import('../../../functions/campaign/index.ts')

const call = async (body: unknown, token = 'tok-mgr') => {
  const r = await handler(new Request('http://x', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }))
  return { status: r.status, body: await r.json() }
}
function seed() {
  ;(globalThis as any).__DB = {
    users: { 'tok-mgr': 'u-mgr', 'tok-staff': 'u-staff' },
    t: { 'public.punpang_staff': [
      { user_id: 'u-mgr', active: true, perms: ['manage'] },
      { user_id: 'u-staff', active: true, perms: ['chat'] },
    ] },
  }
}

Deno.test('ไม่มีโทเค็น → 401', async () => {
  seed()
  assertEquals((await call({ action: 'list' }, 'none')).status, 401)
})

Deno.test('พนักงานที่ไม่มีสิทธิ์ manage → 403', async () => {
  seed()
  assertEquals((await call({ action: 'list' }, 'tok-staff')).status, 403)
})

Deno.test('คำขอ JSON เสีย → 400', async () => {
  seed()
  assertEquals((await call('{ไม่ใช่ json')).status, 400)
})

Deno.test('คำสั่งที่ไม่รู้จัก → 400', async () => {
  seed()
  assertEquals((await call({ action: 'hack' })).status, 400)
})

Deno.test('list และ audience ใช้ได้กับผู้ดูแล', async () => {
  seed()
  const r = await call({ action: 'list' })
  assertEquals(r.status, 200)
  assertEquals(Array.isArray(r.body.items), true)
  assertEquals(typeof r.body.audience, 'number')
})
