// ทดสอบ line-link: ผูกบัญชี LINE กับลูกค้า · ต้องมีโทเค็น LIFF ของช่อง LINE Login ของร้าน + เซสชันลูกค้าที่ยังไม่หมดอายุ
// จำลอง api.line.me และฐานข้อมูล · รัน: deno test -A --no-lock --node-modules-dir=none --import-map=supabase/tests/functions/_fake/importmap.json supabase/tests/functions/line-link/
import { assertEquals } from 'jsr:@std/assert@1'

let handler: (r: Request) => Promise<Response> = null as any
;(Deno as any).serve = (h: any) => { handler = h; return { finished: Promise.resolve(), shutdown: async () => {} } }
Deno.env.set('SUPABASE_URL', 'http://db.fake')
Deno.env.set('SUPABASE_ANON_KEY', 'anon')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service')
await import('../../../functions/line-link/index.ts')

const enc = new TextEncoder()
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')
const sha = async (s: string) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)))
const SESSION = 'a'.repeat(64)
const TOKEN = 'L'.repeat(30)
const LINE_UID = 'U' + '1'.repeat(32)

let verify: any = { client_id: '2012641404', expires_in: 3600 }
let profile: any = { userId: LINE_UID, displayName: 'ลูกค้าทดสอบ' }
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
  const u = new URL(new Request(input, init).url)
  if (u.host === 'api.line.me' && u.pathname === '/oauth2/v2.1/verify') return verify ? new Response(JSON.stringify(verify), { status: 200 }) : new Response('{}', { status: 400 })
  if (u.host === 'api.line.me' && u.pathname === '/v2/profile') return profile ? new Response(JSON.stringify(profile), { status: 200 }) : new Response('{}', { status: 401 })
  if (u.host === 'db.fake') return realFetch(input, init)
  return realFetch(input, init)
}) as typeof fetch

async function seed(expiresAt = new Date(Date.now() + 3600e3).toISOString()) {
  verify = { client_id: '2012641404', expires_in: 3600 }
  profile = { userId: LINE_UID, displayName: 'ลูกค้าทดสอบ' }
  ;(globalThis as any).__DB = { t: {
    'public.punpang_customer_sessions': [{ token_hash: await sha(`custsess:${SESSION}`), customer_id: 'c1', expires_at: expiresAt }],
    'public.punpang_line_users': [],
  } }
}
const call = async (body: unknown, method = 'POST') => {
  const r = await handler(new Request('http://x', { method, headers: { 'Content-Type': 'application/json' }, body: method === 'POST' ? JSON.stringify(body) : undefined }))
  return { status: r.status, body: await r.json() }
}
const ok = { accessToken: TOKEN, session: SESSION }

Deno.test('ใช้ POST เท่านั้น → 405', async () => {
  await seed()
  assertEquals((await call(ok, 'GET')).status, 405)
})

Deno.test('รูปแบบคำขอไม่ถูกต้อง (เซสชันไม่ใช่ hex 64 ตัว) → 400', async () => {
  await seed()
  assertEquals((await call({ accessToken: TOKEN, session: 'สั้น' })).status, 400)
})

Deno.test('โทเค็น LIFF ของช่องอื่น → 401', async () => {
  await seed()
  verify = { client_id: '9999999999', expires_in: 3600 }
  assertEquals((await call(ok)).status, 401)
})

Deno.test('โทเค็น LIFF หมดอายุ/ตรวจไม่ผ่าน → 401', async () => {
  await seed()
  verify = null
  assertEquals((await call(ok)).status, 401)
})

Deno.test('userId ของ LINE รูปแบบผิด → 401', async () => {
  await seed()
  profile = { userId: 'X-bad' }
  assertEquals((await call(ok)).status, 401)
})

Deno.test('ยังไม่ได้เข้าสู่ระบบบัญชีลูกค้า → 401', async () => {
  await seed()
  assertEquals((await call({ accessToken: TOKEN, session: 'b'.repeat(64) })).status, 401)
})

Deno.test('เซสชันหมดอายุ → 401', async () => {
  await seed(new Date(Date.now() - 1000).toISOString())
  assertEquals((await call(ok)).status, 401)
})

Deno.test('ผูกสำเร็จ → บันทึก userId ของ LINE กับลูกค้า และเรียกซ้ำไม่เกิดแถวซ้ำ', async () => {
  await seed()
  assertEquals(await call(ok), { status: 200, body: { ok: true } })
  assertEquals(await call(ok), { status: 200, body: { ok: true } })
  const rows = (globalThis as any).__DB.t['public.punpang_line_users']
  assertEquals(rows.length, 1)
  assertEquals([rows[0].line_user_id, rows[0].customer_id, rows[0].display_name], [LINE_UID, 'c1', 'ลูกค้าทดสอบ'])
})

Deno.test('สถานะการเชื่อม (action=status): ยังไม่ผูก → linked=false · ผูกแล้ว → linked=true พร้อมชื่อ LINE', async () => {
  await seed()
  assertEquals(await call({ action: 'status', session: SESSION }), { status: 200, body: { linked: false, displayName: '' } })
  await call(ok)
  assertEquals(await call({ action: 'status', session: SESSION }), { status: 200, body: { linked: true, displayName: 'ลูกค้าทดสอบ' } })
})

Deno.test('ยกเลิกการเชื่อม (action=unlink): ลบการผูก ชื่อ LINE และประวัติข้อความของบัญชีนั้นทันที · คนอื่นไม่โดนลบ', async () => {
  await seed()
  await call(ok)
  const db = (globalThis as any).__DB.t
  db['public.punpang_line_messages'] = [
    { line_user_id: LINE_UID, direction: 'in', text: 'สวัสดี' },
    { line_user_id: 'U' + '2'.repeat(32), direction: 'in', text: 'ของคนอื่น' },
  ]
  db['public.punpang_line_users'].push({ line_user_id: 'U' + '2'.repeat(32), customer_id: 'c2', display_name: 'คนอื่น' })
  assertEquals(await call({ action: 'unlink', session: SESSION }), { status: 200, body: { ok: true, unlinked: 1 } })
  assertEquals(db['public.punpang_line_users'].map((r: any) => r.customer_id), ['c2'])
  assertEquals(db['public.punpang_line_messages'].map((r: any) => r.text), ['ของคนอื่น'])
  assertEquals(await call({ action: 'status', session: SESSION }), { status: 200, body: { linked: false, displayName: '' } })
})

Deno.test('ยกเลิกการเชื่อม/ดูสถานะ ต้องมีเซสชันลูกค้าที่ยังไม่หมดอายุ → 401', async () => {
  await seed()
  assertEquals((await call({ action: 'unlink' })).status, 401)
  assertEquals((await call({ action: 'status', session: 'b'.repeat(64) })).status, 401)
  await seed(new Date(Date.now() - 1000).toISOString())
  assertEquals((await call({ action: 'unlink', session: SESSION })).status, 401)
})
