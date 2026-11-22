// ทดสอบ Edge Function sms-send ทั้งฟังก์ชัน: ใครส่งได้ ส่งถึงใครได้ ในโหมดจริงและโหมดทดสอบ · จำลองฐานข้อมูลและเกตเวย์ SMS
// กติกาที่ต้องเป็นจริง (กันใช้ระบบส่ง SMS ออกนอกร้าน / ถึงลูกค้าจริงตอนทดสอบ):
//   โหมดจริง: ส่งได้เฉพาะเบอร์ลูกค้าที่มีในระบบและยังไม่ถูกลบ · ผู้จัดการส่งทดสอบถึงเบอร์ใดก็ได้ (kind=test)
//   โหมดทดสอบ: ส่งได้เฉพาะเบอร์ในรายชื่อทดสอบ (สคีมาทดสอบ) · จำกัดคนละ 60 ฉบับต่อชั่วโมง · กล่องข้อความเกตเวย์ (มี OTP) เฉพาะผู้ดูแล
// รัน (ทุกชุด): npm run test:fn · หรือ deno test -A --no-lock --node-modules-dir=none --unstable-sloppy-imports --import-map=supabase/tests/functions/_fake/importmap.json supabase/tests/functions/sms-send/
import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { installFakeRest, loadHandler } from '../_fake/rest.ts'
import { SMS_GATEWAY_URL } from '../../../functions/_shared/gwfetch.ts'

Deno.env.set('SUPABASE_URL', 'http://db.fake')
Deno.env.set('SUPABASE_ANON_KEY', 'anon')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service')
Deno.env.set('SMS_API_KEY', 'gw-key')
const fake = installFakeRest({
  users: { 'tok-staff': 'u-staff', 'tok-mgr': 'u-mgr' },
  staff: { 'u-staff': { user_id: 'u-staff', active: true, perms: ['chat'] }, 'u-mgr': { user_id: 'u-mgr', active: true, perms: ['manage'] } },
})
// เกตเวย์ SMS จำลอง: นับการส่งจริง
let sent: { to: string; idem: string | null }[] = []
const dbFetch = globalThis.fetch
globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
  const req = new Request(input, init)
  if (new URL(req.url).host !== new URL(SMS_GATEWAY_URL).host) return dbFetch(input, init)
  if (req.method === 'POST') { const b = await req.json(); sent.push({ to: b.to, idem: req.headers.get('idempotency-key') }); return new Response(JSON.stringify({ id: 'job1', status: 'queued' }), { status: 202 }) }
  return new Response(JSON.stringify({ messages: [] }), { status: 200 })
}) as typeof fetch
const sms = await loadHandler('../../../functions/sms-send/index.ts')

const CUST = '0812345678'
function seed(t: Record<string, any[]> = {}) {
  fake.reset()
  sent = []
  fake.t['public.punpang_customers'] = [{ id: 'c1', phone: CUST, data: {} }, { id: 'c2', phone: '0899999999', data: { deleted: true } }]
  Object.assign(fake.t, t)
}
let k = 0
const send = async (token: string, body: Record<string, unknown>, test = false) => {
  const headers: Record<string, string> = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
  if (test) headers['x-punpang-mode'] = 'test'
  const r = await sms(new Request('http://fn.fake', { method: 'POST', headers, body: JSON.stringify({ text: 'แจ้งเตือน', idempotencyKey: `idem-key-${++k}`, ...body }) }))
  return { status: r.status, body: await r.json() }
}
const recipients = (items: unknown[]) => [{ collection: 'testRecipients', id: 'list', data: { items } }]

Deno.test('โหมดจริง: เบอร์ลูกค้าในระบบ → ส่งผ่านเกตเวย์ 1 ครั้ง พร้อมคีย์กันส่งซ้ำ และบันทึกประวัติ', async () => {
  seed()
  const r = await send('tok-staff', { number: '081-234-5678' })
  assertEquals(r.status, 200)
  assertEquals(sent, [{ to: CUST, idem: `idem-key-${k}` }])
  assertEquals(fake.t['public.punpang_sms_log']?.[0]?.status, 'sent')
  assertEquals(fake.t['public.punpang_sms_log']?.[0]?.to_tail, '5678') // ไม่เก็บเบอร์เต็ม
})

Deno.test('โหมดจริง: เบอร์ที่ไม่ใช่ลูกค้า หรือลูกค้าที่ถูกลบ → 403 ไม่ถึงเกตเวย์', async () => {
  seed()
  const a = await send('tok-staff', { number: '0811111111' })
  assertEquals(a.status, 403)
  assertStringIncludes(a.body.error, 'เฉพาะเบอร์ลูกค้า')
  const b = await send('tok-staff', { number: '0899999999' })
  assertEquals(b.status, 403)
  assertEquals(sent, [])
})

Deno.test('โหมดจริง: ส่งทดสอบถึงเบอร์ใดก็ได้เฉพาะผู้จัดการ (kind=test) · พนักงานทั่วไปใช้ไม่ได้', async () => {
  seed()
  assertEquals((await send('tok-staff', { number: '0811111111', kind: 'test' })).status, 403)
  assertEquals(sent, [])
  assertEquals((await send('tok-mgr', { number: '0811111111', kind: 'test' })).status, 200)
  assertEquals(sent.map((s) => s.to), ['0811111111'])
})

Deno.test('โหมดทดสอบ: ส่งได้เฉพาะเบอร์ในรายชื่อทดสอบ · ลูกค้าจริงที่ไม่อยู่ในรายชื่อถูกปฏิเสธ · ประวัติลงสคีมาทดสอบ', async () => {
  seed({ 'punpang_test.punpang_records': recipients([{ channel: 'sms', to: '0822222222' }, { channel: 'facebook', to: CUST }]) })
  const real = await send('tok-staff', { number: CUST }, true)
  assertEquals(real.status, 403)
  assertStringIncludes(real.body.error, 'รายชื่อทดสอบ')
  assertEquals(sent, [])
  const ok = await send('tok-staff', { number: '082-222-2222' }, true)
  assertEquals(ok.status, 200)
  assertEquals(sent.map((s) => s.to), ['0822222222'])
  assertEquals(fake.t['punpang_test.punpang_sms_log']?.length, 1)
  assertEquals(fake.t['public.punpang_sms_log'], undefined)
})

Deno.test('โหมดทดสอบ: ผู้จัดการส่ง kind=test ก็ยังต้องอยู่ในรายชื่อทดสอบ', async () => {
  seed({ 'punpang_test.punpang_records': recipients([{ channel: 'sms', to: '0822222222' }]) })
  const r = await send('tok-mgr', { number: '0811111111', kind: 'test' }, true)
  assertEquals(r.status, 403)
  assertEquals(sent, [])
})

Deno.test('จำกัดอัตรา: ส่งครบ 60 ฉบับในชั่วโมงนี้ → 429 ไม่ถึงเกตเวย์', async () => {
  const now = new Date().toISOString()
  seed({ 'public.punpang_sms_log': Array.from({ length: 60 }, (_, i) => ({ id: i, user_id: 'u-staff', at: now, status: 'sent' })) })
  const r = await send('tok-staff', { number: CUST })
  assertEquals(r.status, 429)
  assertEquals(sent, [])
})

Deno.test('กล่องข้อความเกตเวย์ (มี OTP) และสถานะเกตเวย์ → เฉพาะผู้ดูแล', async () => {
  seed()
  for (const action of ['messages', 'gateway']) {
    assertEquals((await send('tok-staff', { action })).status, 403)
    assertEquals((await send('tok-mgr', { action })).status, 200)
  }
})

Deno.test('ไม่ได้ล็อกอิน → 401 · คำขอไม่มีคีย์กันส่งซ้ำ → 400', async () => {
  seed()
  const r = await sms(new Request('http://fn.fake', { method: 'POST', body: JSON.stringify({ number: CUST, text: 'x', idempotencyKey: 'idem-key-x' }) }))
  assertEquals(r.status, 401)
  assertEquals((await send('tok-staff', { number: CUST, idempotencyKey: '' })).status, 400)
  assertEquals(sent, [])
})
