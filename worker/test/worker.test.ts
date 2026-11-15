// ทดสอบ Worker punpang-files: เส้นทาง /svc/* (คีย์ลับ) · ลบรูปชุดเทรนเมื่อครบ 30 วัน · สิทธิ์อัปโหลดรูปแชท (staff/)
// ใช้ R2 และ fetch จำลอง ไม่ต่อระบบจริง
import { assert, assertEquals } from 'jsr:@std/assert@1'
import worker, { fileTypeOf, publicRefText, runTrainPrune } from '../src/index.js'

const DAY = 86_400_000
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3, 4, 5, 6, 7, 8])
const TEXT = new TextEncoder().encode('ไม่ใช่รูปภาพ')

type Obj = { key: string; body: Uint8Array; uploaded: Date }
function fakeR2() {
  const objs = new Map<string, Obj>()
  return {
    objs,
    put: async (key: string, body: Uint8Array) => { objs.set(key, { key, body, uploaded: new Date() }) },
    get: async (key: string) => { const o = objs.get(key); return o ? { body: o.body, httpMetadata: {} } : null },
    delete: async (keys: string | string[]) => { for (const k of Array.isArray(keys) ? keys : [keys]) objs.delete(k) },
    list: async ({ prefix = '' }: { prefix?: string } = {}) => ({
      objects: [...objs.values()].filter((o) => o.key.startsWith(prefix)).map((o) => ({ key: o.key, uploaded: o.uploaded, size: o.body.length })),
      truncated: false,
    }),
  }
}

const calls: Array<{ url: string; method: string }> = []
let staffPerms: string[] | null = null
function stubFetch() {
  calls.length = 0
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(input)
    calls.push({ url, method: init?.method || 'GET' })
    if (url.includes('/auth/v1/user')) return new Response(JSON.stringify({ id: 'u1' }), { status: 200 })
    if (url.includes('/rest/v1/punpang_staff')) return new Response(JSON.stringify(staffPerms ? [{ user_id: 'u1', active: true, perms: staffPerms }] : []), { status: 200 })
    return new Response('[]', { status: 200 })
  }) as typeof fetch
}
function makeEnv() {
  return {
    FILES_PRIVATE: fakeR2(),
    FILES_PUBLIC: fakeR2(),
    SIGN_KEY: 'sign-test',
    FILES_SERVICE_KEY: 'svc-test',
    SUPABASE_URL: 'https://sb.test',
    SUPABASE_SERVICE_ROLE_KEY: 'srk',
    SUPABASE_ANON_KEY: 'anon',
    ALLOWED_ORIGINS: 'https://app.test',
  }
}
const bearer = { Authorization: 'Bearer svc-test' }
const svc = (path: string, init: RequestInit = {}) => new Request(`https://files.test${path}`, { method: 'POST', ...init })

Deno.test('svc/upload: ต้องมีคีย์ลับที่ถูกต้อง แล้วเก็บรูปใต้ prefix ที่ส่งมา', async () => {
  stubFetch()
  const env = makeEnv()
  assertEquals((await worker.fetch(svc('/svc/upload?bucket=private&prefix=o1', { body: PNG }), env)).status, 401)
  assertEquals((await worker.fetch(svc('/svc/upload?bucket=private&prefix=o1', { headers: { Authorization: 'Bearer nope' }, body: PNG }), env)).status, 401)
  const ok = await worker.fetch(svc('/svc/upload?bucket=private&prefix=o1', { headers: bearer, body: PNG }), env)
  assertEquals(ok.status, 200)
  const j = await ok.json()
  assert(j.key.startsWith('o1/') && j.key.endsWith('.png'))
  assertEquals(j.ref, `r2://private/${j.key}`)
  assertEquals(env.FILES_PRIVATE.objs.has(j.key), true)
})

Deno.test('svc/upload: ไฟล์ที่ไม่ใช่รูปและ prefix ที่ไม่ปลอดภัยถูกปฏิเสธ', async () => {
  stubFetch()
  const env = makeEnv()
  assertEquals((await worker.fetch(svc('/svc/upload?bucket=private&prefix=o1', { headers: bearer, body: TEXT }), env)).status, 400)
  assertEquals((await worker.fetch(svc('/svc/upload?bucket=private&prefix=..%2Fx', { headers: bearer, body: PNG }), env)).status, 400)
  assertEquals(env.FILES_PRIVATE.objs.size, 0)
})

Deno.test('svc/sign: ออกลิงก์ที่ลายเซ็นตรวจได้ และจำกัดอายุลิงก์', async () => {
  stubFetch()
  const env = makeEnv()
  const r = await worker.fetch(svc('/svc/sign', { headers: bearer, body: JSON.stringify({ key: 'o1/abc.png', ttl: 999999 }) }), env)
  assertEquals(r.status, 200)
  const j = await r.json()
  const u = new URL(j.url)
  const exp = Number(u.searchParams.get('exp'))
  assert(exp - Math.floor(Date.now() / 1000) <= 3605)
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode('sign-test'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const want = [...new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(`o1/abc.png|${exp}`)))].map((x) => x.toString(16).padStart(2, '0')).join('')
  assertEquals(u.searchParams.get('sig'), want)
  assertEquals((await worker.fetch(svc('/svc/sign', { headers: bearer, body: JSON.stringify({ key: '../etc.png' }) }), env)).status, 400)
})

Deno.test('svc/delete: ลบไฟล์ที่ระบุทันที ไม่ย้ายเข้าถังขยะ', async () => {
  stubFetch()
  const env = makeEnv()
  env.FILES_PRIVATE.objs.set('o1/a.png', { key: 'o1/a.png', body: PNG, uploaded: new Date() })
  env.FILES_PRIVATE.objs.set('o1/b.png', { key: 'o1/b.png', body: PNG, uploaded: new Date() })
  const r = await worker.fetch(svc('/svc/delete', { headers: bearer, body: JSON.stringify({ keys: ['o1/a.png'] }) }), env)
  assertEquals(r.status, 200)
  assertEquals([...env.FILES_PRIVATE.objs.keys()], ['o1/b.png'])
})

Deno.test('รูปชุดเทรนเก่าเกิน 30 วันถูกลบถาวร รูปใหม่และไฟล์ของออร์เดอร์ไม่ถูกแตะ และลบรายการ slipTrain ในฐานข้อมูล', async () => {
  stubFetch()
  const env = makeEnv()
  env.FILES_PRIVATE.objs.set('train/old.jpg', { key: 'train/old.jpg', body: PNG, uploaded: new Date(Date.now() - 31 * DAY) })
  env.FILES_PRIVATE.objs.set('train/new.jpg', { key: 'train/new.jpg', body: PNG, uploaded: new Date(Date.now() - 2 * DAY) })
  env.FILES_PRIVATE.objs.set('o1/slip.png', { key: 'o1/slip.png', body: PNG, uploaded: new Date(Date.now() - 400 * DAY) })
  assertEquals(await runTrainPrune(env), 1)
  assertEquals([...env.FILES_PRIVATE.objs.keys()].sort(), ['o1/slip.png', 'train/new.jpg'])
  const del = calls.find((c) => c.method === 'DELETE')
  assert(del !== undefined && del.url.includes('collection=eq.slipTrain'))
})

Deno.test('ลบสลิปของออร์เดอร์ได้เฉพาะผู้ยืนยันชำระหรือแอดมิน (ผู้แจ้งชำระแก้ได้อย่างเดียว)', async () => {
  stubFetch()
  const env = makeEnv()
  const del = (perms: string[]) => {
    staffPerms = perms
    env.FILES_PRIVATE.objs.set('o9/slip.png', { key: 'o9/slip.png', body: PNG, uploaded: new Date() })
    return worker.fetch(new Request('https://files.test/delete', {
      method: 'POST',
      headers: { Authorization: 'Bearer staff-jwt', 'content-type': 'application/json' },
      body: JSON.stringify({ keys: ['o9/slip.png'] }),
    }), env)
  }
  assertEquals((await del(['reportPayment'])).status, 403)
  assert(env.FILES_PRIVATE.objs.has('o9/slip.png'))
  assertEquals((await del(['confirmPayment'])).status, 200)
  assertEquals((await del(['manage'])).status, 200)
  staffPerms = null
})

Deno.test('รูปสาธารณะที่ถูกอ้างในแถวที่ 1,001 ขึ้นไปยังนับว่าถูกใช้ (อ่านข้อมูลทุกหน้า)', async () => {
  const requested: string[] = []
  globalThis.fetch = (async (input: any) => {
    const url = new URL(String(input))
    requested.push(url.pathname + url.search)
    if (url.pathname !== '/rest/v1/punpang_items') return new Response('[]', { status: 200 })
    const off = Number(url.searchParams.get('offset') || 0)
    const page = off === 0
      ? Array.from({ length: 1000 }, (_, i) => ({ data: { name: 'เค้ก ' + i } }))
      : [{ data: { image: 'sb://pub/cake-1001.png' } }]
    return new Response(JSON.stringify(page), { status: 200 })
  }) as typeof fetch
  const refs = await publicRefText({ SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'srk' } as any)
  assert(refs.includes('cake-1001.png'))
  assert(requested.some((u) => u.includes('offset=1000')))
})

Deno.test('อ่านข้อมูลอ้างอิงไม่สำเร็จ = ไม่ตัดสินว่ารูปไม่ถูกใช้ (โยนข้อผิดพลาด)', async () => {
  globalThis.fetch = (async () => new Response('boom', { status: 500 })) as typeof fetch
  let threw = false
  try { await publicRefText({ SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'srk' } as any) } catch { threw = true }
  assert(threw)
})

Deno.test('อัปโหลดรูปแชท (staff/…) ต้องมีสิทธิ์แชท', async () => {
  stubFetch()
  const env = makeEnv()
  const up = (perms: string[]) => {
    staffPerms = perms
    return worker.fetch(new Request('https://files.test/upload?bucket=private&prefix=staff/123', { method: 'POST', headers: { Authorization: 'Bearer staff-jwt' }, body: PNG }), env)
  }
  assertEquals((await up(['reportPayment'])).status, 403)
  const ok = await up(['chat'])
  assertEquals(ok.status, 200)
  assertEquals(fileTypeOf((await ok.json()).key), 'other')
  staffPerms = null
})

Deno.test('fileTypeOf: รูปชุดเทรนไม่ถูกนับเป็นสลิปของออร์เดอร์', () => {
  assertEquals(fileTypeOf('train/abc.jpg'), 'other')
  assertEquals(fileTypeOf('o1/abc.png'), 'slip')
})

// ---- /sign: สิทธิ์ดูไฟล์ส่วนตัวตามประเภทของ key ----
const signAs = (env: ReturnType<typeof makeEnv>, perms: string[] | null, key: string) => {
  staffPerms = perms
  return worker.fetch(new Request('https://files.test/sign', { method: 'POST', headers: { Authorization: 'Bearer staff-jwt', 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) }), env)
}

Deno.test('/sign: ไฟล์นอกออร์เดอร์ (webchat/ manual/ pay-qr/ train/) ต้องมีสิทธิ์ตามประเภท · ไฟล์ของออร์เดอร์พนักงาน active ดูได้เหมือนเดิม', async () => {
  stubFetch()
  const env = makeEnv()
  const KEYS = { webchat: 'webchat/c1/a.jpg', manual: 'manual/chat1/a.png', payqr: 'pay-qr/o1/a.png', train: 'train/a.jpg', chat: 'chat/x/a.jpg', staff: 'staff/123/a.jpg', order: 'o1/a.png', work: 'o1/work/a.jpg' }
  const status = async (perms: string[] | null) => Object.fromEntries(await Promise.all(Object.entries(KEYS).map(async ([n, k]) => [n, (await signAs(env, perms, k)).status])))
  // พนักงานที่ไม่มีสิทธิ์แชท/รับชำระ: เห็นเฉพาะไฟล์ของออร์เดอร์
  assertEquals(await status(['workPhoto']), { webchat: 403, manual: 403, payqr: 403, train: 403, chat: 403, staff: 403, order: 200, work: 200 })
  // สิทธิ์แชท: ไฟล์แชท + รูปลูกค้าในแชท + สลิปรอผูก + QR · ยังไม่เห็นรูปชุดเทรน
  assertEquals(await status(['chat']), { webchat: 200, manual: 200, payqr: 200, train: 403, chat: 200, staff: 200, order: 200, work: 200 })
  // สิทธิ์รับชำระ: สลิปรอผูก + QR · ไม่เห็นรูปแชทของลูกค้า
  assertEquals(await status(['reportPayment']), { webchat: 403, manual: 200, payqr: 200, train: 403, chat: 403, staff: 403, order: 200, work: 200 })
  // manage: ทุกอย่างรวมรูปชุดเทรน
  assertEquals(await status(['manage']), { webchat: 200, manual: 200, payqr: 200, train: 200, chat: 200, staff: 200, order: 200, work: 200 })
  // ไม่ใช่พนักงาน (ไม่มีลิงก์/เซสชันลูกค้า): ไม่เห็นอะไรเลย
  assertEquals(await status(null), { webchat: 403, manual: 403, payqr: 403, train: 403, chat: 403, staff: 403, order: 403, work: 403 })
  staffPerms = null
})

Deno.test('ไฟล์ที่เสิร์ฟมี nosniff · path ที่เข้ารหัสเสียตอบ 403/404 แทนที่จะล้มเป็น 500', async () => {
  stubFetch()
  const env = makeEnv()
  env.FILES_PUBLIC.objs.set('shop/a.png', { key: 'shop/a.png', body: PNG, uploaded: new Date() })
  env.FILES_PRIVATE.objs.set('o1/a.png', { key: 'o1/a.png', body: PNG, uploaded: new Date() })
  const pub = await worker.fetch(new Request('https://files.test/p/shop/a.png'), env)
  assertEquals([pub.status, pub.headers.get('X-Content-Type-Options')], [200, 'nosniff'])
  const signed = await (await worker.fetch(svc('/svc/sign', { headers: bearer, body: JSON.stringify({ key: 'o1/a.png' }) }), env)).json()
  const priv = await worker.fetch(new Request(signed.url), env)
  assertEquals([priv.status, priv.headers.get('X-Content-Type-Options')], [200, 'nosniff'])
  assertEquals((await worker.fetch(new Request('https://files.test/p/%E0%A4%A'), env)).status, 404)
  assertEquals((await worker.fetch(new Request('https://files.test/f/%E0%A4%A?exp=9999999999&sig=x'), env)).status, 403)
})
