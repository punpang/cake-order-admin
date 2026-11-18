// ทดสอบ fb-connect (เชื่อมเพจ Facebook): เมื่อยังไม่ตั้งค่าแอป Facebook ต้องไม่เชื่อมและบอกชัดเจน · เฉพาะผู้มีสิทธิ์ manage เริ่ม/เลือก/ยกเลิกการเชื่อมได้
// ครอบคลุม: เมธอด · โหมดทดสอบ · ไม่ล็อกอิน 401 · บัญชีปิดใช้งาน 403 · สถานะเมื่อยังไม่ตั้งค่า · ไม่ใช่ manage 403 · ยังไม่ตั้งค่า 503 ·
//           กลับจาก Facebook ตอนยังไม่ตั้งค่า/ไม่มี state → กลับหน้าแอปพร้อมรหัสข้อผิดพลาด · เริ่มเชื่อมได้เมื่อตั้งค่าแล้ว
// รัน: deno test -A --no-lock --node-modules-dir=none --import-map=supabase/tests/functions/_fake/importmap.json supabase/tests/functions/fb-connect/
import { assertEquals, assert } from 'jsr:@std/assert@1'

let handler: (r: Request) => Promise<Response> = null as any
;(Deno as any).serve = (h: any) => { handler = h; return { finished: Promise.resolve(), shutdown: async () => {} } }
Deno.env.set('SUPABASE_URL', 'http://db.fake')
Deno.env.set('SUPABASE_ANON_KEY', 'anon')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service')
Deno.env.delete('FB_APP_ID')
Deno.env.delete('FB_APP_SECRET')
Deno.env.delete('FB_CONFIG_ID')
await import('../../../functions/fb-connect/index.ts')

const seed = () => { (globalThis as any).__DB = {
  users: { 'tok-mgr': 'u-mgr', 'tok-staff': 'u-staff', 'tok-off': 'u-off' },
  t: { 'public.punpang_staff': [
    { user_id: 'u-mgr', active: true, perms: ['manage'] },
    { user_id: 'u-staff', active: true, perms: ['chat'] },
    { user_id: 'u-off', active: false, perms: ['manage'] },
  ], 'public.punpang_fb_oauth': [], 'public.punpang_fb_pages': [] },
} }
const post = async (body: unknown, token: string | null = 'tok-mgr') => {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) h.Authorization = `Bearer ${token}`
  const r = await handler(new Request('http://x', { method: 'POST', headers: h, body: JSON.stringify(body) }))
  return { status: r.status, body: await r.json() }
}

Deno.test('ใช้ GET/POST เท่านั้น → PUT ได้ 405', async () => {
  seed()
  const r = await handler(new Request('http://x', { method: 'PUT' }))
  assertEquals(r.status, 405)
})

Deno.test('โหมดทดสอบ → 409 ไม่เชื่อมเพจจริง', async () => {
  seed()
  const r = await handler(new Request('http://x', { method: 'POST', headers: { 'x-punpang-mode': 'test' }, body: '{}' }))
  assertEquals(r.status, 409)
})

Deno.test('ไม่มีโทเค็นพนักงาน → 401', async () => {
  seed()
  assertEquals((await post({ action: 'status' }, null)).status, 401)
})

Deno.test('บัญชีพนักงานที่ปิดใช้งาน → 403', async () => {
  seed()
  assertEquals((await post({ action: 'status' }, 'tok-off')).status, 403)
})

Deno.test('สถานะ: ยังไม่ตั้งค่าแอป Facebook และยังไม่มีเพจ', async () => {
  seed()
  assertEquals(await post({ action: 'status' }, 'tok-staff'), { status: 200, body: { configured: false, page: null } })
})

Deno.test('พนักงานที่ไม่มีสิทธิ์ manage เริ่มเชื่อมไม่ได้ → 403', async () => {
  seed()
  assertEquals((await post({ action: 'start' }, 'tok-staff')).status, 403)
})

Deno.test('ผู้จัดการแต่ยังไม่ตั้งค่าแอป Facebook → 503', async () => {
  seed()
  const r = await post({ action: 'start' })
  assertEquals(r.status, 503)
  assertEquals((globalThis as any).__DB.t['public.punpang_fb_oauth'].length, 0)
})

Deno.test('กลับจาก Facebook ตอนยังไม่ตั้งค่า → กลับหน้าแอปพร้อมรหัส config', async () => {
  seed()
  const r = await handler(new Request('http://x/?code=abc&state=' + 'a'.repeat(48), { method: 'GET' }))
  assertEquals(r.status, 302)
  assert(r.headers.get('Location')!.includes('fb=error&m=config'))
})

Deno.test('ตั้งค่าแล้วแต่ state ไม่รู้จัก/ไม่มี code → กลับพร้อม denied', async () => {
  seed()
  Deno.env.set('FB_APP_ID', '123456789')
  Deno.env.set('FB_APP_SECRET', 'a'.repeat(32))
  Deno.env.set('FB_CONFIG_ID', '987654321')
  try {
    const r = await handler(new Request('http://x/?code=abc&state=สั้น', { method: 'GET' }))
    assertEquals(r.status, 302)
    assert(r.headers.get('Location')!.includes('fb=error&m=denied'))
  } finally {
    Deno.env.delete('FB_APP_ID')
    Deno.env.delete('FB_APP_SECRET')
    Deno.env.delete('FB_CONFIG_ID')
  }
})

Deno.test('ตั้งค่าแล้ว ผู้จัดการเริ่มเชื่อม → ได้ลิงก์ Facebook และบันทึก state แบบ hash', async () => {
  seed()
  Deno.env.set('FB_APP_ID', '123456789')
  Deno.env.set('FB_APP_SECRET', 'a'.repeat(32))
  Deno.env.set('FB_CONFIG_ID', '987654321')
  try {
    const r = await post({ action: 'start' })
    assertEquals(r.status, 200)
    assert(r.body.url.startsWith('https://www.facebook.com/'))
    assert(r.body.url.includes('client_id=123456789'))
    const rows = (globalThis as any).__DB.t['public.punpang_fb_oauth']
    assertEquals(rows.length, 1)
    assertEquals(rows[0].stage === undefined || rows[0].stage === 'started', true)
  } finally {
    Deno.env.delete('FB_APP_ID')
    Deno.env.delete('FB_APP_SECRET')
    Deno.env.delete('FB_CONFIG_ID')
  }
})
