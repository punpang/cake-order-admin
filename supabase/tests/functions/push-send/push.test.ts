// ทดสอบ push-send: แจ้งเตือนไปยังมือถือ · เรียกจากทริกเกอร์ฐานข้อมูลเท่านั้น (ต้องมี x-push-key) · ไม่ตั้งคีย์ = ปิดทั้งหมด
// ครอบคลุม: คีย์ไม่ได้ตั้ง 503 · คีย์ผิด 401 · เมธอด · JSON เสีย · ไม่มี recordId 400 · กระดิ่งที่ไม่ใช่ของพนักงาน/ไม่ตรงกติกาข้าม · แชทที่ไม่ใช่เว็บข้าม
// รัน: deno test -A --no-lock --node-modules-dir=none --import-map=supabase/tests/functions/_fake/importmap.json supabase/tests/functions/push-send/
import { assertEquals } from 'jsr:@std/assert@1'

let handler: (r: Request) => Promise<Response> = null as any
;(Deno as any).serve = (h: any) => { handler = h; return { finished: Promise.resolve(), shutdown: async () => {} } }
Deno.env.set('SUPABASE_URL', 'http://db.fake')
Deno.env.set('SUPABASE_ANON_KEY', 'anon')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service')
Deno.env.set('PUSH_SEND_KEY', 'p'.repeat(32))
await import('../../../functions/push-send/index.ts')

const KEY = 'p'.repeat(32)
const call = async (body: unknown, key: string | null = KEY, method = 'POST', raw?: string) => {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (key !== null) h['x-push-key'] = key
  const r = await handler(new Request('http://x', { method, headers: h, body: raw ?? (method === 'POST' ? JSON.stringify(body) : undefined) }))
  return { status: r.status, body: await r.json() }
}
const seed = () => { (globalThis as any).__DB = { t: {
  'public.punpang_records': [
    { collection: 'bell', id: 'custbell', created_at: new Date().toISOString(), data: { audience: 'customer', event: 'order_new', title: 'x', text: 'y' } },
  ],
  'public.punpang_chats': [{ id: 'chat-pos', channel: 'pos', customer_id: null, data: {} }],
  'public.punpang_staff': [],
} } }

Deno.test('ใช้ POST เท่านั้น → 405', async () => {
  seed()
  assertEquals((await call(null, KEY, 'GET')).status, 405)
})

Deno.test('ไม่มี x-push-key → 401', async () => {
  seed()
  assertEquals((await call({ recordId: 'x' }, null)).status, 401)
})

Deno.test('คีย์ผิด → 401', async () => {
  seed()
  assertEquals((await call({ recordId: 'x' }, 'x'.repeat(32))).status, 401)
})

Deno.test('ไม่ได้ตั้ง PUSH_SEND_KEY → 503 ปิดทั้งหมด', async () => {
  seed()
  const old = Deno.env.get('PUSH_SEND_KEY')
  Deno.env.delete('PUSH_SEND_KEY')
  try {
    assertEquals((await call({ recordId: 'x' }, KEY)).status, 503)
  } finally {
    Deno.env.set('PUSH_SEND_KEY', old!)
  }
})

Deno.test('JSON เสีย → 400', async () => {
  seed()
  assertEquals((await call(null, KEY, 'POST', '{เสีย')).status, 400)
})

Deno.test('ไม่มี recordId และ chatId → 400', async () => {
  seed()
  assertEquals((await call({})).status, 400)
})

Deno.test('กระดิ่งที่ไม่ใช่ของพนักงาน → ข้าม ไม่ส่ง', async () => {
  seed()
  const r = await call({ recordId: 'custbell' })
  assertEquals(r.body, { skipped: 'event' })
})

Deno.test('ไม่พบรายการกระดิ่ง → 404', async () => {
  seed()
  assertEquals((await call({ recordId: 'ไม่มี' })).status, 404)
})

Deno.test('แชทที่ไม่ใช่ช่องทางเว็บ → ข้าม', async () => {
  seed()
  assertEquals((await call({ chatId: 'chat-pos' })).body, { skipped: 'chat' })
})
