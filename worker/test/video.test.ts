// ทดสอบ Worker punpang-files: อัปโหลดวิดีโอสื่อโฆษณา (สาธารณะ/displayAds เท่านั้น) และเสิร์ฟไฟล์สาธารณะแบบขอเป็นช่วง (Range)
// ใช้ R2 และ fetch จำลอง ไม่ต่อระบบจริง · รัน: deno test --no-prompt --no-lock --node-modules-dir=none worker/test/
import { assert, assertEquals } from 'jsr:@std/assert@1'
import worker, { parseRange } from '../src/index.js'

// R2 จำลองที่รองรับ range / head / httpMetadata เหมือนของจริง
function fakeR2() {
  const objs = new Map<string, { body: Uint8Array; type: string }>()
  return {
    objs,
    put: async (key: string, body: Uint8Array, o?: any) => { objs.set(key, { body, type: o?.httpMetadata?.contentType || '' }) },
    head: async (key: string) => { const o = objs.get(key); return o ? { size: o.body.length } : null },
    get: async (key: string, opts?: any) => {
      const o = objs.get(key)
      if (!o) return null
      const size = o.body.length
      const r = opts?.range
      if (!r) return { body: o.body, size, httpMetadata: { contentType: o.type } }
      const start = 'suffix' in r ? Math.max(0, size - r.suffix) : r.offset
      if (start >= size) throw new Error('range not satisfiable')
      const end = 'suffix' in r ? size : r.length != null ? Math.min(size, start + r.length) : size
      return { body: o.body.slice(start, end), size, range: r, httpMetadata: { contentType: o.type } }
    },
  }
}
let perms: string[] = []
globalThis.fetch = (async (input: any) => {
  const url = String(input)
  if (url.includes('/auth/v1/user')) return new Response(JSON.stringify({ id: 'u1' }), { status: 200 })
  if (url.includes('/rest/v1/punpang_staff')) return new Response(JSON.stringify([{ user_id: 'u1', active: true, perms }]), { status: 200 })
  return new Response('[]', { status: 200 })
}) as typeof fetch
const env = () => ({ FILES_PRIVATE: fakeR2(), FILES_PUBLIC: fakeR2(), SIGN_KEY: 's', SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'k', SUPABASE_ANON_KEY: 'a', ALLOWED_ORIGINS: 'https://app.test' })
const MP4 = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, 0, 1, 2, 3, 4])
const WEBM = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 1, 2, 3])
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3, 4])
const upload = (e: any, q: string, body: Uint8Array) => worker.fetch(new Request(`https://files.test/upload?${q}`, { method: 'POST', headers: { Authorization: 'Bearer staff-jwt' }, body: body as unknown as BodyInit }), e)

Deno.test('อัปโหลดวิดีโอ MP4/WebM ลงสาธารณะ/displayAds ได้ เก็บชนิดตามไบต์จริง', async () => {
  perms = ['editItems']
  const e = env()
  const a = await upload(e, 'bucket=public&prefix=displayAds', MP4)
  assertEquals(a.status, 200)
  const ja = await a.json()
  assert(ja.key.startsWith('displayAds/') && ja.key.endsWith('.mp4') && ja.url.endsWith(ja.key))
  assertEquals(e.FILES_PUBLIC.objs.get(ja.key)?.type, 'video/mp4')
  const b = await (await upload(e, 'bucket=public&prefix=displayAds', WEBM)).json()
  assert(b.key.endsWith('.webm'))
  // รูปยังอัปโหลดในโฟลเดอร์เดียวกันได้ตามปกติ
  assert((await (await upload(e, 'bucket=public&prefix=displayAds', PNG)).json()).key.endsWith('.png'))
})

Deno.test('วิดีโอนอกสาธารณะ/displayAds ถูกปฏิเสธ (สินค้า · ไฟล์ส่วนตัว)', async () => {
  perms = ['editItems', 'manage']
  const e = env()
  assertEquals((await upload(e, 'bucket=public&prefix=items', MP4)).status, 400)
  assertEquals((await upload(e, 'bucket=private&prefix=displayAds', MP4)).status, 400)
  assertEquals(e.FILES_PUBLIC.objs.size + e.FILES_PRIVATE.objs.size, 0)
})

Deno.test('อัปโหลดสาธารณะต้องมีสิทธิ์แก้สินค้า (หรือผู้จัดการ)', async () => {
  perms = ['chat']
  assertEquals((await upload(env(), 'bucket=public&prefix=displayAds', MP4)).status, 403)
})

Deno.test('วิดีโอใหญ่เกิน 30 MB ถูกปฏิเสธ · รูปยังใช้เพดานรูปเดิม (5 MB)', async () => {
  perms = ['editItems']
  const big = new Uint8Array(30 * 1024 * 1024 + 10)
  big.set(MP4)
  const r = await upload(env(), 'bucket=public&prefix=displayAds', big)
  assert([400, 413].includes(r.status), String(r.status))
  const bigPng = new Uint8Array(6 * 1024 * 1024)
  bigPng.set(PNG)
  assertEquals((await upload(env(), 'bucket=public&prefix=displayAds', bigPng)).status, 400)
})

Deno.test('อ่านช่วง Range: a-b · a- · -n · ไม่ระบุ = ทั้งไฟล์ · เกินไฟล์ = 416', async () => {
  const e = env()
  const body = Uint8Array.from({ length: 100 }, (_, i) => i)
  await e.FILES_PUBLIC.put('displayAds/v.mp4', body, { httpMetadata: { contentType: 'video/mp4' } })
  const get = (range?: string) => worker.fetch(new Request('https://files.test/p/displayAds/v.mp4', { headers: range ? { Range: range } : {} }), e)
  const full = await get()
  assertEquals([full.status, full.headers.get('Accept-Ranges'), full.headers.get('Content-Type')], [200, 'bytes', 'video/mp4'])
  assertEquals((await full.arrayBuffer()).byteLength, 100)
  const mid = await get('bytes=10-19')
  assertEquals([mid.status, mid.headers.get('Content-Range')], [206, 'bytes 10-19/100'])
  assertEquals([...new Uint8Array(await mid.arrayBuffer())], [10, 11, 12, 13, 14, 15, 16, 17, 18, 19])
  const tail = await get('bytes=95-')
  assertEquals([tail.status, tail.headers.get('Content-Range')], [206, 'bytes 95-99/100'])
  const suffix = await get('bytes=-10')
  assertEquals([suffix.status, suffix.headers.get('Content-Range')], [206, 'bytes 90-99/100'])
  const over = await get('bytes=200-')
  assertEquals([over.status, over.headers.get('Content-Range')], [416, 'bytes */100'])
  assertEquals((await get('bytes=abc')).status, 200) // รูปแบบไม่รู้จัก → ส่งทั้งไฟล์
})

Deno.test('parseRange', () => {
  assertEquals(parseRange('bytes=0-'), { offset: 0 })
  assertEquals(parseRange('bytes=5-9'), { offset: 5, length: 5 })
  assertEquals(parseRange('bytes=-3'), { suffix: 3 })
  assertEquals(parseRange('bytes=9-5'), null)
  assertEquals(parseRange('items=0-1'), null)
  assertEquals(parseRange(''), null)
})
