// ทดสอบ scheduled (งานตามเวลาฝั่งเซิร์ฟเวอร์): เปิดใช้เฉพาะเมื่อ config/scheduled.server = true · ค่าเริ่มต้นแอปพนักงานทำเอง (ไม่ส่งซ้ำ)
// ครอบคลุม: คีย์ cron · เมธอด · โหมดทดสอบถูกปฏิเสธ · โหมดแอปข้ามงาน · โหมดเซิร์ฟเวอร์ที่ไม่มีข้อมูลจบปกติ
// รัน: deno test -A --no-lock --node-modules-dir=none --import-map=supabase/tests/functions/_fake/importmap.json supabase/tests/functions/scheduled/
import { assertEquals } from 'jsr:@std/assert@1'

let handler: (r: Request) => Promise<Response> = null as any
;(Deno as any).serve = (h: any) => { handler = h; return { finished: Promise.resolve(), shutdown: async () => {} } }
Deno.env.set('SUPABASE_URL', 'http://db.fake')
Deno.env.set('SUPABASE_ANON_KEY', 'anon')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service')
Deno.env.set('SCHEDULED_KEY', 'k'.repeat(24))
await import('../../../functions/scheduled/index.ts')

const KEY = 'k'.repeat(24)
const call = async (opts: { key?: string | null; method?: string } = {}) => {
  const headers: Record<string, string> = {}
  if (opts.key !== null) headers['x-cron-key'] = opts.key ?? KEY
  const r = await handler(new Request('http://x', { method: opts.method ?? 'POST', headers }))
  return { status: r.status, body: await r.json() }
}
function seed(serverOn: boolean) {
  ;(globalThis as any).__DB = { t: {
    'public.punpang_kv': [
      { collection: 'config', id: 'shop', data: { v: {} } },
      { collection: 'config', id: 'scheduled', data: { v: serverOn ? { server: true } : {} } },
    ],
  } }
}

Deno.test('ใช้ POST เท่านั้น → 405', async () => {
  seed(false)
  assertEquals((await call({ method: 'GET' })).status, 405)
})

Deno.test('ไม่มีคีย์ cron → 403', async () => {
  seed(true)
  assertEquals((await call({ key: null })).status, 403)
})

Deno.test('คีย์ cron ผิด → 403', async () => {
  seed(true)
  assertEquals((await call({ key: 'x'.repeat(24) })).status, 403)
})

Deno.test('โหมดแอปพนักงาน (ยังไม่เปิด server) → ข้ามงาน ไม่ส่งอะไร', async () => {
  seed(false)
  const r = await call()
  assertEquals(r.status, 200)
  assertEquals(r.body.skipped, 'app-mode')
  assertEquals(r.body.ok, true)
})

Deno.test('โหมดเซิร์ฟเวอร์ ไม่มีข้อมูลที่ต้องเตือน → จบปกติ ไม่มีรายการส่ง', async () => {
  seed(true)
  const r = await call()
  assertEquals(r.status, 200)
  assertEquals(r.body.ok, true)
  assertEquals(r.body.done ?? 0, 0)
  assertEquals(r.body.errors ?? [], [])
})

Deno.test('เก็บข้อความ LINE: ลบเฉพาะข้อความที่เกินระยะที่ร้านตั้ง · ทำแม้โหมดแอป (ไม่เปิดงานเซิร์ฟเวอร์)', async () => {
  const DAY = 86400000
  const old = new Date(Date.now() - 200 * DAY).toISOString()
  const recent = new Date(Date.now() - 10 * DAY).toISOString()
  seed(false)
  const db = (globalThis as any).__DB.t
  db['public.punpang_kv'][0].data.v = { lineRetentionDays: 180 }
  db['public.punpang_line_messages'] = [
    { line_user_id: 'U1', text: 'เก่า', created_at: old },
    { line_user_id: 'U1', text: 'ใหม่', created_at: recent },
  ]
  assertEquals((await call()).body.skipped, 'app-mode')
  assertEquals(db['public.punpang_line_messages'].map((r: any) => r.text), ['ใหม่'])
})

Deno.test('เก็บข้อความ LINE: ไม่ได้ตั้งค่า → ใช้ 180 วัน', async () => {
  const DAY = 86400000
  seed(false)
  const db = (globalThis as any).__DB.t
  db['public.punpang_line_messages'] = [
    { line_user_id: 'U1', text: 'เก่า 170 วัน', created_at: new Date(Date.now() - 170 * DAY).toISOString() },
    { line_user_id: 'U1', text: 'เก่า 200 วัน', created_at: new Date(Date.now() - 200 * DAY).toISOString() },
  ]
  await call()
  assertEquals(db['public.punpang_line_messages'].map((r: any) => r.text), ['เก่า 170 วัน'])
})
