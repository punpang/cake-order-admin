// ทดสอบ line-webhook: เหตุการณ์จาก LINE Official Account · ต้องลงลายเซ็น x-line-signature ถูกต้องก่อนทุกอย่าง
// ครอบคลุม: ยังไม่ตั้งค่า 503 · ลายเซ็นผิด 401 · โหมดทดสอบ 409 · unfollow บันทึกว่าเลิกติดตาม · เหตุการณ์ standby ข้าม
// รัน: deno test -A --no-lock --node-modules-dir=none --import-map=supabase/tests/functions/_fake/importmap.json supabase/tests/functions/line-webhook/
import { assertEquals } from 'jsr:@std/assert@1'
import { lineSignature } from '../../../functions/_shared/line.ts'

let handler: (r: Request) => Promise<Response> = null as any
;(Deno as any).serve = (h: any) => { handler = h; return { finished: Promise.resolve(), shutdown: async () => {} } }
Deno.env.set('SUPABASE_URL', 'http://db.fake')
Deno.env.set('SUPABASE_ANON_KEY', 'anon')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service')
const SECRET = 'line-secret-for-tests'
Deno.env.set('LINE_CHANNEL_SECRET', SECRET)
Deno.env.set('LINE_CHANNEL_ACCESS_TOKEN', 'line-token-for-tests')
await import('../../../functions/line-webhook/index.ts')

const U = 'U' + 'b'.repeat(32)
const body = (events: unknown[]) => JSON.stringify({ destination: 'Dxxx', events })
const send = async (raw: string, sig: string | null, test = false) => {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (sig !== null) h['x-line-signature'] = sig
  if (test) h['x-punpang-mode'] = 'test'
  const r = await handler(new Request('http://x', { method: 'POST', headers: h, body: raw }))
  return { status: r.status, body: await r.json() }
}
const signed = async (raw: string) => lineSignature(SECRET, raw)
const seed = () => { (globalThis as any).__DB = { t: { 'public.punpang_line_users': [] } } }

Deno.test('ลายเซ็นไม่ถูกต้อง → 401 ไม่ประมวลผลอะไร', async () => {
  seed()
  const raw = body([{ type: 'unfollow', source: { userId: U }, webhookEventId: 'e1' }])
  assertEquals((await send(raw, 'wrong')).status, 401)
  assertEquals((globalThis as any).__DB.t['public.punpang_line_users'].length, 0)
})

Deno.test('ไม่มีลายเซ็น → 401', async () => {
  seed()
  assertEquals((await send(body([]), null)).status, 401)
})

Deno.test('โหมดทดสอบ → 409 ไม่รับเว็บฮุกจริง', async () => {
  seed()
  const raw = body([])
  assertEquals((await send(raw, await signed(raw), true)).status, 409)
})

Deno.test('ใช้ POST เท่านั้น → 405', async () => {
  seed()
  const r = await handler(new Request('http://x', { method: 'GET' }))
  assertEquals(r.status, 405)
})

Deno.test('unfollow ที่ลงลายเซ็นถูก → บันทึกว่าเลิกติดตาม', async () => {
  seed()
  const raw = body([{ type: 'unfollow', source: { userId: U }, webhookEventId: 'e1' }])
  assertEquals(await send(raw, await signed(raw)), { status: 200, body: { ok: true } })
  const rows = (globalThis as any).__DB.t['public.punpang_line_users']
  assertEquals([rows[0].line_user_id, rows[0].followed], [U, false])
})

Deno.test('เหตุการณ์โหมด standby → ข้าม ไม่บันทึกผู้ใช้', async () => {
  seed()
  const raw = body([{ type: 'unfollow', mode: 'standby', source: { userId: U }, webhookEventId: 'e2' }])
  assertEquals((await send(raw, await signed(raw))).status, 200)
  assertEquals((globalThis as any).__DB.t['public.punpang_line_users'].length, 0)
})
