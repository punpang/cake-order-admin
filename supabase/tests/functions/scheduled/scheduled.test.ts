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
const call = async (opts: { key?: string | null; method?: string; test?: boolean } = {}) => {
  const headers: Record<string, string> = {}
  if (opts.key !== null) headers['x-cron-key'] = opts.key ?? KEY
  if (opts.test) headers['x-punpang-mode'] = 'test'
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

Deno.test('โหมดทดสอบ → 409 ไม่ทำงานงานตามเวลา', async () => {
  seed(true)
  assertEquals((await call({ test: true })).status, 409)
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
