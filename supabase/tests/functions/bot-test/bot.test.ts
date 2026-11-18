// ทดสอบ bot-test: บอท AI ในโหมดทดสอบเท่านั้น · เฉพาะแอดมิน (manage) · ไม่ส่งถึง Facebook
// ครอบคลุม: ไม่ใช่โหมดทดสอบ 409 · เมธอด · ไม่มีโทเค็น 401 · ไม่ใช่แอดมิน 403 · ข้อความว่าง/ยาวเกิน 400 · แชทที่ไม่ใช่แชททดสอบ 404
// หมายเหตุ: ไม่เรียกโมเดล AI จริงในเทสต์นี้ (ต้องใช้คีย์และทำให้ผลไม่คงที่)
// รัน: deno test -A --no-lock --node-modules-dir=none --import-map=supabase/tests/functions/_fake/importmap.json supabase/tests/functions/bot-test/
import { assertEquals } from 'jsr:@std/assert@1'

let handler: (r: Request) => Promise<Response> = null as any
;(Deno as any).serve = (h: any) => { handler = h; return { finished: Promise.resolve(), shutdown: async () => {} } }
Deno.env.set('SUPABASE_URL', 'http://db.fake')
Deno.env.set('SUPABASE_ANON_KEY', 'anon')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service')
await import('../../../functions/bot-test/index.ts')

// โหมดทดสอบอ่านเขียนสคีมา punpang_test เท่านั้น
const T = 'punpang_test.'
const call = async (body: unknown, opts: { token?: string; test?: boolean; method?: string } = {}) => {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (opts.token !== undefined) h.Authorization = `Bearer ${opts.token}`
  if (opts.test !== false) h['x-punpang-mode'] = 'test'
  const r = await handler(new Request('http://x', { method: opts.method ?? 'POST', headers: h, body: opts.method === 'GET' ? undefined : JSON.stringify(body) }))
  return { status: r.status, body: await r.json() }
}
const seed = () => { (globalThis as any).__DB = {
  users: { 'tok-mgr': 'u-mgr', 'tok-staff': 'u-staff' },
  t: {
    [`${T}punpang_staff`]: [
      { user_id: 'u-mgr', active: true, perms: ['manage'] },
      { user_id: 'u-staff', active: true, perms: ['chat'] },
    ],
    [`${T}punpang_chats`]: [{ id: 'chLive', channel: 'facebook', data: { botTest: false, messages: [] }, updated_at: 'x' }],
  },
} }

Deno.test('โหมดจริง → 409 ไม่ทำงาน', async () => {
  seed()
  assertEquals((await call({ text: 'สวัสดี' }, { token: 'tok-mgr', test: false })).status, 409)
})

Deno.test('ใช้ POST เท่านั้น → 405', async () => {
  seed()
  assertEquals((await call({ text: 'x' }, { token: 'tok-mgr', method: 'GET' })).status, 405)
})

Deno.test('ไม่มีโทเค็นพนักงาน → 401', async () => {
  seed()
  assertEquals((await call({ text: 'สวัสดี' }, { token: 'none' })).status, 401)
})

Deno.test('พนักงานที่ไม่มีสิทธิ์ manage → 403', async () => {
  seed()
  assertEquals((await call({ text: 'สวัสดี' }, { token: 'tok-staff' })).status, 403)
})

Deno.test('ข้อความว่างหรือยาวเกิน 1000 ตัวอักษร → 400', async () => {
  seed()
  assertEquals((await call({ text: '   ' }, { token: 'tok-mgr' })).status, 400)
  assertEquals((await call({ text: 'ก'.repeat(1001) }, { token: 'tok-mgr' })).status, 400)
})

Deno.test('ต่อจากแชทที่ไม่ใช่แชททดสอบ → 404 (ไม่แตะแชทจริง)', async () => {
  seed()
  assertEquals((await call({ text: 'สวัสดี', chatId: 'chLive' }, { token: 'tok-mgr' })).status, 404)
})
