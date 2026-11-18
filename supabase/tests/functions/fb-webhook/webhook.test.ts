// ทดสอบ fb-webhook (รับข้อความ Messenger/Instagram จาก Meta): ยืนยัน webhook ด้วย verify token · ทุก POST ต้องลงลายเซ็น X-Hub-Signature-256
// ครอบคลุม: ยืนยัน webhook (ถูก/ผิด/สั้นเกินไป) · เมธอด · ยังไม่ตั้งค่า 503 · ลายเซ็นผิด 403 · JSON เสีย 400 · object ไม่ใช่เพจ ข้าม · ยังไม่เชื่อมเพจ ตอบ no page
// รัน: deno test -A --no-lock --node-modules-dir=none --import-map=supabase/tests/functions/_fake/importmap.json supabase/tests/functions/fb-webhook/
import { assertEquals } from 'jsr:@std/assert@1'

let handler: (r: Request) => Promise<Response> = null as any
;(Deno as any).serve = (h: any) => { handler = h; return { finished: Promise.resolve(), shutdown: async () => {} } }
Deno.env.set('SUPABASE_URL', 'http://db.fake')
Deno.env.set('SUPABASE_ANON_KEY', 'anon')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service')
const VERIFY = 'verify-token-123'
const SECRET = 'app-secret-for-tests'
Deno.env.set('FB_VERIFY_TOKEN', VERIFY)
Deno.env.set('FB_APP_SECRET', SECRET)
await import('../../../functions/fb-webhook/index.ts')

const hmac = async (secret: string, body: string) => {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(body)))].map((x) => x.toString(16).padStart(2, '0')).join('')
}
const seed = (pages: unknown[] = []) => { (globalThis as any).__DB = { t: { 'public.punpang_fb_pages': pages } } }
const get = async (qs: string) => {
  const r = await handler(new Request(`http://x/?${qs}`, { method: 'GET' }))
  return { status: r.status, text: await r.text() }
}
const post = async (raw: string, sig: string | null) => {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (sig !== null) h['x-hub-signature-256'] = `sha256=${sig}`
  const r = await handler(new Request('http://x', { method: 'POST', headers: h, body: raw }))
  return { status: r.status, text: await r.text() }
}

Deno.test('ยืนยัน webhook ด้วย verify token ที่ถูกต้อง → ส่ง challenge กลับ', async () => {
  seed()
  const r = await get(`hub.mode=subscribe&hub.verify_token=${VERIFY}&hub.challenge=12345`)
  assertEquals(r, { status: 200, text: '12345' })
})

Deno.test('verify token ผิด → 403', async () => {
  seed()
  assertEquals((await get('hub.mode=subscribe&hub.verify_token=wrong-token-xx&hub.challenge=1')).status, 403)
})

Deno.test('mode ไม่ใช่ subscribe → 403', async () => {
  seed()
  assertEquals((await get(`hub.mode=unsubscribe&hub.verify_token=${VERIFY}&hub.challenge=1`)).status, 403)
})

Deno.test('ใช้ PUT → 405', async () => {
  seed()
  assertEquals((await handler(new Request('http://x', { method: 'PUT' }))).status, 405)
})

Deno.test('ลายเซ็นผิด → 403 ไม่อ่านข้อมูลต่อ', async () => {
  seed([{ page_id: '111111111', token: 't' }])
  assertEquals((await post('{"object":"page"}', 'ff'.repeat(32))).status, 403)
})

Deno.test('ไม่มี x-hub-signature-256 → 403', async () => {
  seed()
  assertEquals((await post('{"object":"page"}', null)).status, 403)
})

Deno.test('ลายเซ็นถูกแต่ JSON เสีย → 400', async () => {
  seed()
  const raw = '{เสีย'
  assertEquals((await post(raw, await hmac(SECRET, raw))).status, 400)
})

Deno.test('object ไม่ใช่ page/instagram → ข้าม ตอบ ignored', async () => {
  seed([{ page_id: '111111111', token: 't' }])
  const raw = JSON.stringify({ object: 'user', entry: [] })
  assertEquals(await post(raw, await hmac(SECRET, raw)), { status: 200, text: 'ignored' })
})

Deno.test('ยังไม่ได้เชื่อมเพจ → ตอบ no page (ไม่ให้ Meta ส่งซ้ำ)', async () => {
  seed([])
  const raw = JSON.stringify({ object: 'page', entry: [{ id: '111111111', messaging: [] }] })
  assertEquals(await post(raw, await hmac(SECRET, raw)), { status: 200, text: 'no page' })
})

Deno.test('ไม่ได้ตั้ง FB_APP_SECRET → 503', async () => {
  seed()
  Deno.env.delete('FB_APP_SECRET')
  try {
    assertEquals((await post('{}', 'ab')).status, 503)
  } finally {
    Deno.env.set('FB_APP_SECRET', SECRET)
  }
})
