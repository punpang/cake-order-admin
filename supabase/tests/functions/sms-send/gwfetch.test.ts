// เทสต์ gwFetch: เชื่อเฉพาะใบรับรองของโทรศัพท์ (self-signed ไม่มี SAN แบบเดียวกับแอป SMS Gateway)
// ต้องมีคำสั่ง openssl · รันใน test:fn (-A)
import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@1'
import { dechunk, gwFetch, parseHttpResponse } from '../../../functions/_shared/gwfetch.ts'

const dir = Deno.makeTempDirSync({ prefix: 'gwfetch-' })
function makeCert(name: string) {
  const key = `${dir}/${name}.key`, crt = `${dir}/${name}.crt`
  const r = new Deno.Command('openssl', {
    args: ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', crt, '-days', '2', '-subj', '/CN=sms-gateway',
      '-addext', 'basicConstraints=critical,CA:FALSE', '-addext', 'keyUsage=critical,digitalSignature,keyEncipherment', '-addext', 'extendedKeyUsage=serverAuth'],
    stdout: 'null', stderr: 'null',
  }).outputSync()
  if (!r.success) throw new Error('openssl failed')
  return { key: Deno.readTextFileSync(key), cert: Deno.readTextFileSync(crt) }
}
const phone = makeCert('phone')
const other = makeCert('other')

type Seen = { method: string; path: string; auth: string | null; idem: string | null; body: string }
const seen: Seen[] = []
const ac = new AbortController()
const server = Deno.serve({ hostname: '127.0.0.1', port: 0, cert: phone.cert, key: phone.key, signal: ac.signal, onListen: () => {} }, async (req) => {
  const u = new URL(req.url)
  seen.push({ method: req.method, path: u.pathname, auth: req.headers.get('authorization'), idem: req.headers.get('idempotency-key'), body: await req.text() })
  if (u.pathname === '/slow') { await new Promise((r) => setTimeout(r, 1500)); return new Response('late') }
  if (u.pathname === '/v1/sms') return Response.json({ id: 1, status: 'QUEUED' }, { status: 202 })
  return Response.json({ error: 'not_found' }, { status: 404 })
})
const port = (server.addr as Deno.NetAddr).port
const base = `https://localhost:${port}`

function withCert<T>(pem: string, fn: () => Promise<T>): Promise<T> {
  Deno.env.set('SMS_GATEWAY_CERT', pem)
  return fn().finally(() => Deno.env.delete('SMS_GATEWAY_CERT'))
}

Deno.test('ไม่ตั้ง SMS_GATEWAY_CERT: ใช้ fetch ปกติ', async () => {
  const orig = globalThis.fetch
  let called = ''
  globalThis.fetch = ((u: string) => { called = String(u); return Promise.resolve(new Response('x', { status: 200 })) }) as typeof fetch
  try {
    const r = await gwFetch('https://relay.example/v1/status')
    assertEquals(r.status, 200)
    assertEquals(called, 'https://relay.example/v1/status')
  } finally { globalThis.fetch = orig }
})

Deno.test('ใบรับรองตรง: ส่ง method/header/body ครบ และได้คำตอบของโทรศัพท์ (ไม่เทียบชื่อโฮสต์)', () => withCert(phone.cert, async () => {
  const n0 = seen.length
  const body = JSON.stringify({ to: '0812345678', message: 'รหัส OTP 123456' })
  const r = await gwFetch(`${base}/v1/sms`, { method: 'POST', headers: { Authorization: 'Bearer k1', 'Idempotency-Key': 'otp-12345678', 'Content-Type': 'application/json; charset=utf-8' }, body, signal: AbortSignal.timeout(5000) })
  assertEquals(r.status, 202)
  assertEquals(await r.json(), { id: 1, status: 'QUEUED' })
  assertEquals(seen.length, n0 + 1)
  assertEquals(seen[n0], { method: 'POST', path: '/v1/sms', auth: 'Bearer k1', idem: 'otp-12345678', body })
}))

Deno.test('PEM ที่เก็บแบบ \\n ในบรรทัดเดียวก็ใช้ได้', () => withCert(phone.cert.replace(/\n/g, '\\n'), async () => {
  const r = await gwFetch(`${base}/v1/status`, { signal: AbortSignal.timeout(5000) })
  assertEquals(r.status, 404)
  await r.body?.cancel()
}))

Deno.test('ใบรับรองไม่ตรง: ปฏิเสธ และไม่มีคำขอถึงเซิร์ฟเวอร์', () => withCert(other.cert, async () => {
  const n0 = seen.length
  await assertRejects(() => gwFetch(`${base}/v1/sms`, { method: 'POST', headers: { Authorization: 'Bearer k1' }, body: '{}', signal: AbortSignal.timeout(5000) }))
  assertEquals(seen.length, n0)
}))

Deno.test('ตั้งใบรับรองแต่ URL เป็น http: ปฏิเสธ', () => withCert(phone.cert, async () => {
  await assertRejects(() => gwFetch(`http://localhost:${port}/v1/sms`), Error, 'gateway_cert_requires_https')
}))

Deno.test('หมดเวลา: ยกเลิกการเชื่อมต่อ', () => withCert(phone.cert, async () => {
  const t0 = Date.now()
  await assertRejects(() => gwFetch(`${base}/slow`, { signal: AbortSignal.timeout(300) }))
  assert(Date.now() - t0 < 1400)
}))

Deno.test('header ที่มีขึ้นบรรทัดใหม่ถูกตัดทิ้ง (กัน header injection)', () => withCert(phone.cert, async () => {
  const n0 = seen.length
  const r = await gwFetch(`${base}/v1/sms`, { method: 'POST', headers: { Authorization: 'Bearer k1\r\nX-Evil: 1' }, body: '{}', signal: AbortSignal.timeout(5000) })
  assertEquals(r.status, 202)
  await r.body?.cancel()
  assertEquals(seen[n0].auth, null)
}))

Deno.test('แยกคำตอบ chunked และ content-length', async () => {
  const enc = new TextEncoder()
  const r1 = parseHttpResponse(enc.encode('HTTP/1.1 202 Accepted\r\nTransfer-Encoding: chunked\r\nContent-Type: application/json\r\n\r\n5\r\n{"a":\r\n2\r\n1}\r\n0\r\n\r\n'))
  assertEquals(r1.status, 202)
  assertEquals(await r1.json(), { a: 1 })
  const r2 = parseHttpResponse(enc.encode('HTTP/1.1 401 Unauthorized\r\nContent-Length: 24\r\n\r\n{"error":"unauthorized"}'))
  assertEquals(r2.status, 401)
  assertEquals((await r2.json()).error, 'unauthorized')
  assertEquals(dechunk(enc.encode('5\r\nab')), null)
  let threw = false
  try { parseHttpResponse(enc.encode('HTTP/1.1 200 OK\r\nContent-Length: 10\r\n\r\nshort')) } catch { threw = true }
  assert(threw)
})

Deno.test({ name: 'ปิดเซิร์ฟเวอร์ทดสอบ', sanitizeOps: false, sanitizeResources: false, fn: async () => {
  ac.abort()
  await server.finished
  Deno.removeSync(dir, { recursive: true })
} })
