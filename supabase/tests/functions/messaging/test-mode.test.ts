// ทดสอบการส่งข้อความในโหมดทดสอบครบทาง: Edge Function telegram-send และ fb-send ตัวจริง กับฐานข้อมูลจำลองที่แยกสคีมา
// สิ่งที่ต้องเป็นจริง: โหมดทดสอบส่งออกได้เฉพาะผู้รับในรายชื่อทดสอบ (อ่านจาก punpang_test เท่านั้น) · ไม่อยู่ในรายชื่อ = ไม่มีการยิงออกไปข้างนอกเลย
// รัน (ทุกชุด): npm run test:fn · หรือ deno test -A --no-lock --node-modules-dir=none --unstable-sloppy-imports --import-map=supabase/tests/functions/_fake/importmap.json supabase/tests/functions/messaging/
import { assert, assertEquals } from 'jsr:@std/assert@1'

const TG_CHAT = '-1001234567'
Deno.env.set('SUPABASE_URL', 'http://db.fake')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service')
Deno.env.set('TELEGRAM_BOT_TOKEN', '12345:abcdefghijklmnopqrstuvwxyz')
Deno.env.set('TELEGRAM_CHAT_ID', TG_CHAT)

// ดึง handler ของแต่ละฟังก์ชัน (แต่ละไฟล์เรียก Deno.serve ครั้งเดียวตอนโหลด)
let captured: (r: Request) => Promise<Response> = null as any
;(Deno as any).serve = (h: any) => { captured = h; return { finished: Promise.resolve(), shutdown: async () => {} } }
await import('../../../functions/telegram-send/index.ts')
const telegram = captured
await import('../../../functions/fb-send/index.ts')
const fb = captured

// การยิงออกไปข้างนอก (Telegram / Facebook) ถูกบันทึกไว้ตรวจ · ไม่มีการเชื่อมต่อจริง
let outbound: string[] = []
globalThis.fetch = (async (input: Request | URL | string) => {
  const url = String(input instanceof Request ? input.url : input)
  outbound.push(new URL(url).host)
  return new Response(JSON.stringify({ ok: true, message_id: 'm1', recipient_id: '1' }), { status: 200, headers: { 'content-type': 'application/json' } })
}) as typeof fetch

const STAFF = { user_id: 'u1', active: true, perms: ['chat'] }
const list = (items: unknown[]) => [{ collection: 'testRecipients', id: 'list', data: { items } }]
function seed(t: Record<string, any[]> = {}) {
  outbound = []
  ;(globalThis as any).__DB = { users: { tok: 'u1' }, t: { 'public.punpang_staff': [STAFF], 'punpang_test.punpang_staff': [STAFF], ...t } }
}
const T = () => (globalThis as any).__DB.t
const call = async (h: (r: Request) => Promise<Response>, body: unknown, test: boolean) => {
  const headers: Record<string, string> = { authorization: 'Bearer tok', 'content-type': 'application/json' }
  if (test) headers['x-punpang-mode'] = 'test'
  const r = await h(new Request('http://fn.fake', { method: 'POST', headers, body: JSON.stringify(body) }))
  return { status: r.status, body: await r.json() }
}

Deno.test('Telegram โหมดทดสอบ: กลุ่มอยู่ในรายชื่อทดสอบ → ส่งได้ และบันทึกประวัติในสคีมาทดสอบเท่านั้น', async () => {
  seed({ 'punpang_test.punpang_records': list([{ channel: 'telegram', to: TG_CHAT }]) })
  const r = await call(telegram, { text: 'ทดสอบ' }, true)
  assertEquals(r.status, 200)
  assertEquals(outbound, ['api.telegram.org'])
  assertEquals(T()['punpang_test.punpang_tg_log']?.[0]?.status, 'sent')
  assertEquals(T()['public.punpang_tg_log'], undefined)
})

Deno.test('Telegram โหมดทดสอบ: กลุ่มไม่อยู่ในรายชื่อ → 403 และไม่มีการยิงออกไปเลย', async () => {
  seed({ 'punpang_test.punpang_records': list([{ channel: 'telegram', to: '-1009999999' }, { channel: 'sms', to: TG_CHAT }]) })
  const r = await call(telegram, { text: 'ทดสอบ' }, true)
  assertEquals(r.status, 403)
  assertEquals(outbound, [])
})

Deno.test('Telegram โหมดทดสอบ: รายชื่ออยู่ในสคีมาจริงเท่านั้น → ไม่นับ (403) · โหมดทดสอบอ่านรายชื่อจากสคีมาทดสอบเท่านั้น', async () => {
  seed({ 'public.punpang_records': list([{ channel: 'telegram', to: TG_CHAT }]) })
  const r = await call(telegram, { text: 'ทดสอบ' }, true)
  assertEquals(r.status, 403)
  assertEquals(outbound, [])
})

Deno.test('Telegram โหมดจริง: ส่งเข้ากลุ่มทีมได้ตามปกติ ไม่ต้องมีรายชื่อทดสอบ', async () => {
  seed()
  const r = await call(telegram, { text: 'แจ้งทีม' }, false)
  assertEquals(r.status, 200)
  assertEquals(outbound, ['api.telegram.org'])
  assertEquals(T()['public.punpang_tg_log']?.[0]?.status, 'sent')
})

Deno.test('Facebook โหมดทดสอบ: ลูกค้าไม่อยู่ในรายชื่อ → 403 ก่อนอ่านเพจหรือยิงไป Facebook', async () => {
  seed({ 'punpang_test.punpang_records': list([{ channel: 'facebook', to: '1111111111' }, { channel: 'telegram', to: '2222222222' }]) })
  const r = await call(fb, { psid: '2222222222', text: 'สวัสดี' }, true)
  assertEquals(r.status, 403)
  assertEquals(outbound, [])
})

Deno.test('Facebook โหมดทดสอบ: ลูกค้าอยู่ในรายชื่อ → ผ่านด่านรายชื่อ (ไปต่อถึงขั้นอ่านเพจ)', async () => {
  // ไม่มีเพจในสคีมาทดสอบ → หยุดที่ 503 "ยังไม่ได้เชื่อมเพจ" = ผ่านด่านรายชื่อแล้ว และยังไม่ได้ยิงไป Facebook
  seed({ 'punpang_test.punpang_records': list([{ channel: 'facebook', to: '1111111111' }]) })
  const r = await call(fb, { psid: '1111111111', text: 'สวัสดี' }, true)
  assertEquals(r.status, 503)
  assert(String(r.body.error).includes('เพจ'), r.body.error)
  assertEquals(outbound, [])
})
