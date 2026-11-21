// ทดสอบ Edge Function line-push ตัวจริง: โหมดทดสอบต้องไม่ส่ง LINE ถึงลูกค้าจริง · โหมดจริงทำงานตามเดิม
// เรียก handler ของไฟล์จริง · ฐานข้อมูลและ LINE เป็นของปลอม (fetch) · ไม่มีการเชื่อมต่อจริง
// รัน: npm run test:fn
import { assertEquals } from 'jsr:@std/assert@1'

Deno.env.set('SUPABASE_URL', 'http://db.fake')
Deno.env.set('SUPABASE_ANON_KEY', 'anon')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service')
Deno.env.set('LINE_CHANNEL_ACCESS_TOKEN', 'line-token')

let handler: (r: Request) => Promise<Response> = null as any
;(Deno as any).serve = (h: any) => { handler = h; return { finished: Promise.resolve(), shutdown: async () => {} } }
await import('../../../functions/line-push/index.ts')

// บันทึกทุกคำขอที่ออกไป และตอบจากข้อมูลปลอมตามสคีมาที่ระบุในหัว Accept-Profile
let calls: string[] = []
let tables: Record<string, any[]> = {}
const STAFF_ROW = { user_id: 'u1', active: true }
function seed(t: Record<string, any[]> = {}) {
  calls = []
  tables = {
    'public.punpang_staff': [STAFF_ROW],
    'punpang_test.punpang_staff': [STAFF_ROW],
    'public.punpang_line_users': [{ customer_id: 'c1', line_user_id: 'Ureal', followed: true, updated_at: '2026-11-01' }],
    'punpang_test.punpang_line_users': [],
    ...t,
  }
}
globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
  const url = new URL(String(input instanceof Request ? input.url : input))
  const headers = new Headers(init?.headers)
  calls.push(url.host + url.pathname)
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } })
  if (url.host === 'api.line.me') return json({})
  if (url.pathname === '/auth/v1/user') {
    return headers.get('authorization') === 'Bearer staff-tok' ? json({ id: 'u1' }) : json({}, 401)
  }
  const schema = headers.get('accept-profile') || 'public'
  const table = url.pathname.replace('/rest/v1/', '')
  return json(tables[`${schema}.${table}`] ?? [])
}) as typeof fetch

const call = async (body: unknown, opts: { test?: boolean; token?: string } = {}) => {
  const h: Record<string, string> = { authorization: `Bearer ${opts.token ?? 'staff-tok'}`, 'content-type': 'application/json' }
  if (opts.test) h['x-punpang-mode'] = 'test'
  const r = await handler(new Request('http://fn.fake', { method: 'POST', headers: h, body: JSON.stringify(body) }))
  return { status: r.status, body: await r.json() }
}
const lineCalls = () => calls.filter((c) => c === 'api.line.me/v2/bot/message/push')

Deno.test('โหมดทดสอบ: ปฏิเสธด้วย 409 ก่อนอ่านข้อมูลหรือเรียก LINE (ไม่มีคำขอใดออกไปเลย)', async () => {
  seed()
  const r = await call({ customer_id: 'c1', text: 'ทดสอบ' }, { test: true })
  assertEquals(r.status, 409)
  assertEquals(calls, [])
})

Deno.test('โหมดจริง: ลูกค้าที่ผูก LINE แล้ว → ส่งได้ 200 ไปยัง LINE user ของลูกค้า', async () => {
  seed()
  const r = await call({ customer_id: 'c1', text: 'สวัสดี' })
  assertEquals(r.status, 200)
  assertEquals(lineCalls().length, 1)
})

Deno.test('โหมดจริง: ลูกค้ายังไม่ผูก LINE → 404 และไม่เรียก LINE', async () => {
  seed({ 'public.punpang_line_users': [] })
  const r = await call({ customer_id: 'c1', text: 'สวัสดี' })
  assertEquals(r.status, 404)
  assertEquals(lineCalls().length, 0)
})

Deno.test('โหมดจริง: ไม่ใช่พนักงานที่ active → 401 และไม่เรียก LINE', async () => {
  seed({ 'public.punpang_staff': [{ user_id: 'u1', active: false }] })
  const r = await call({ customer_id: 'c1', text: 'สวัสดี' })
  assertEquals(r.status, 401)
  assertEquals(lineCalls().length, 0)
})
