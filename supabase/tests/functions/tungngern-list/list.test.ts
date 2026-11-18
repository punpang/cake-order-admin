// ทดสอบ tungngern-list: รายการรับเงินถุงเงินที่ตรงทั้งรหัสธุรกรรมและยอด · เฉพาะพนักงานที่ active
// รัน: deno test -A --no-lock --node-modules-dir=none --import-map=supabase/tests/functions/_fake/importmap.json supabase/tests/functions/tungngern-list/
import { assertEquals } from 'jsr:@std/assert@1'

let handler: (r: Request) => Promise<Response> = null as any
;(Deno as any).serve = (h: any) => { handler = h; return { finished: Promise.resolve(), shutdown: async () => {} } }
Deno.env.set('SUPABASE_URL', 'http://db.fake')
Deno.env.set('SUPABASE_ANON_KEY', 'anon')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service')
await import('../../../functions/tungngern-list/index.ts')

const REF = 'ORD' + '26111812345678901'
const call = async (body: unknown, token = 'tok-staff', method = 'POST') => {
  const r = await handler(new Request('http://x', {
    method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  }))
  return { status: r.status, body: await r.json() }
}
function seed() {
  ;(globalThis as any).__DB = {
    users: { 'tok-staff': 'u-staff', 'tok-off': 'u-off' },
    t: {
      'public.punpang_staff': [
        { user_id: 'u-staff', active: true },
        { user_id: 'u-off', active: false },
      ],
      'public.tungngern_transfers': [
        { id: 't1', ref: REF, amount: 150, received_at: '2026-11-18T10:00:00Z' },
        { id: 't2', ref: REF, amount: 150, received_at: '2026-11-18T10:05:00Z' },
        { id: 't3', ref: REF, amount: 99, received_at: '2026-11-18T10:06:00Z' },
        { id: 't4', ref: 'ORD' + 'A'.repeat(17), amount: 150, received_at: '2026-11-18T10:07:00Z' },
      ],
    },
  }
}

Deno.test('ใช้ POST เท่านั้น → 405', async () => {
  seed()
  assertEquals((await call(null, 'tok-staff', 'GET')).status, 405)
})

Deno.test('ไม่มีโทเค็นพนักงาน → 401', async () => {
  seed()
  assertEquals((await call({ ref: REF, amount: 150 }, 'none')).status, 401)
})

Deno.test('พนักงานที่ปิดใช้งานแล้ว → 403', async () => {
  seed()
  assertEquals((await call({ ref: REF, amount: 150 }, 'tok-off')).status, 403)
})

Deno.test('รหัสหรือยอดไม่ถูกรูปแบบ → 400', async () => {
  seed()
  assertEquals((await call({ ref: 'x', amount: 150 })).status, 400)
  assertEquals((await call({ ref: REF, amount: 0 })).status, 400)
  assertEquals((await call({ ref: REF, amount: -5 })).status, 400)
})

Deno.test('ตรงทั้งรหัสและยอด → คืนเฉพาะรายการนั้น เรียงตามเวลารับ', async () => {
  seed()
  const r = await call({ ref: REF, amount: 150 })
  assertEquals(r.status, 200)
  assertEquals(r.body.rows.map((x: any) => x.id), ['t1', 't2'])
})

Deno.test('ยอดไม่ตรง → ไม่คืนรายการ (ไม่จับคู่ด้วยรหัสอย่างเดียว)', async () => {
  seed()
  const r = await call({ ref: REF, amount: 200 })
  assertEquals(r.body.rows, [])
})
