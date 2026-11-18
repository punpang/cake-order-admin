// ทดสอบ chat-photo-prune: ลบรูปแชทครบ 90 วัน · ลำดับ ถอดลิงก์ในแชท → ลบไฟล์ R2 → ลบทะเบียน · ล้มเหลวขั้นใดทะเบียนยังอยู่ให้รอบถัดไปลองใหม่
// รัน: deno test -A --no-lock --node-modules-dir=none --import-map=supabase/tests/functions/_fake/importmap.json supabase/tests/functions/chat-photo-prune/
import { assertEquals } from 'jsr:@std/assert@1'

let handler: (r: Request) => Promise<Response> = null as any
;(Deno as any).serve = (h: any) => { handler = h; return { finished: Promise.resolve(), shutdown: async () => {} } }
Deno.env.set('SUPABASE_URL', 'http://db.fake')
Deno.env.set('SUPABASE_ANON_KEY', 'anon')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service')
Deno.env.set('SCHEDULED_KEY', 'k'.repeat(24))
Deno.env.set('FILES_URL', 'https://files.fake')
Deno.env.set('FILES_SERVICE_KEY', 'files-key')
await import('../../../functions/chat-photo-prune/index.ts')

const KEY = 'k'.repeat(24)
const OLD = new Date(Date.now() - 100 * 86400e3).toISOString()
const NEW = new Date(Date.now() - 10 * 86400e3).toISOString()
const OLD_KEY = 'webchat/c1/old.png'
const NEW_KEY = 'webchat/c1/new.png'
const ref = (k: string) => `r2://private/${k}`

let r2Ok = true
let r2Calls: string[][] = []
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
  const req = new Request(input, init)
  if (new URL(req.url).host !== 'files.fake') return realFetch(input, init)
  r2Calls.push(JSON.parse(String(init?.body ?? '{}')).keys)
  return new Response('{}', { status: r2Ok ? 200 : 500 })
}) as typeof fetch

function seed() {
  r2Calls = []
  r2Ok = true
  ;(globalThis as any).__DB = {
    t: {
      'public.punpang_kv': [
        { collection: 'chatPhoto', id: OLD_KEY, data: { at: OLD } },
        { collection: 'chatPhoto', id: NEW_KEY, data: { at: NEW } },
      ],
      'public.punpang_chats': [
        {
          id: 'ch1', channel: 'web', updated_at: 'u1',
          data: { messages: [
            { text: 'สวัสดี', attachments: [{ path: ref(OLD_KEY) }, { path: ref(NEW_KEY) }] },
            { text: 'ข้อความเก่า', attachments: [{ path: ref(OLD_KEY) }] },
          ] },
        },
        { id: 'ch2', channel: 'web', updated_at: 'u2', data: { messages: [{ text: 'ไม่มีรูป' }] } },
      ],
    },
  }
}
const call = async (key = KEY, method = 'POST') => {
  const r = await handler(new Request('http://x', { method, headers: { 'x-cron-key': key } }))
  return { status: r.status, body: await r.json() }
}

Deno.test('คีย์ cron ไม่ถูกต้อง → 403 ไม่แตะข้อมูล', async () => {
  seed()
  assertEquals((await call('wrong')).status, 403)
  assertEquals(r2Calls.length, 0)
})

Deno.test('ใช้ POST เท่านั้น → 405', async () => {
  seed()
  assertEquals((await call(KEY, 'GET')).status, 405)
})

Deno.test('ยังไม่ครบ 90 วัน → ไม่ลบอะไร', async () => {
  seed()
  ;(globalThis as any).__DB.t['public.punpang_kv'] = [{ collection: 'chatPhoto', id: NEW_KEY, data: { at: NEW } }]
  const r = await call()
  assertEquals(r.body, { expired: 0, chatsChanged: 0, r2Deleted: true })
  assertEquals(r2Calls.length, 0)
})

Deno.test('ครบกำหนด → ถอดลิงก์ออกจากแชท ลบไฟล์ และลบทะเบียนเฉพาะรายการเก่า', async () => {
  seed()
  const r = await call()
  assertEquals(r.body, { expired: 1, chatsChanged: 1, r2Deleted: true, registryDeleted: true })
  assertEquals(r2Calls, [[OLD_KEY]])
  const db = (globalThis as any).__DB.t
  const ch1 = db['public.punpang_chats'].find((c: any) => c.id === 'ch1').data.messages
  assertEquals(ch1[0].attachments, [{ path: ref(NEW_KEY) }]) // รูปใหม่ยังอยู่
  assertEquals(ch1[1].attachments, [])                       // รูปเก่าถูกถอด
  assertEquals(ch1[0].text, 'สวัสดี')                        // ข้อความไม่หาย
  assertEquals(db['public.punpang_kv'].map((r: any) => r.id), [NEW_KEY])
})

Deno.test('ลบไฟล์ R2 ไม่สำเร็จ → 502 และทะเบียนยังอยู่ให้รอบถัดไปลองใหม่', async () => {
  seed()
  r2Ok = false
  const r = await call()
  assertEquals(r.status, 502)
  assertEquals(r.body.r2Deleted, false)
  assertEquals((globalThis as any).__DB.t['public.punpang_kv'].length, 2)
})
