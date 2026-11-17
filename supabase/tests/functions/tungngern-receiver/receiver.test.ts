// ทดสอบ Edge Function tungngern-receiver ทั้งฟังก์ชัน (รับแจ้งเตือนเงินเข้าจากแอปถุงเงิน → จับคู่งวดชำระของออร์เดอร์)
// สิ่งที่ต้องเป็นจริง: ไม่มีลายเซ็นถูกต้อง = ไม่แตะอะไรเลย · ส่งซ้ำ (replay) ไม่ผ่าน · โหมดทดสอบไม่ทำงาน · แอปอื่นไม่ถูกนับ
//   แจ้งเตือนเดียวกันส่งซ้ำ = ไม่จับคู่ซ้ำ · ยอดตรง+รหัสตรง = งวดชำระถูกทำเครื่องหมายผ่านการตรวจสอบ
// รัน (ทุกชุด): npm run test:fn · หรือ deno test -A --no-lock --node-modules-dir=none --unstable-sloppy-imports --import-map=supabase/tests/functions/_fake/importmap.json supabase/tests/functions/tungngern-receiver/
import { assert, assertEquals } from 'jsr:@std/assert@1'

const SECRET = 'test-secret-0123456789abcdef'
Deno.env.set('SUPABASE_URL', 'http://db.fake')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service')
Deno.env.set('TUNGNGERN_FORWARD_SECRET', SECRET)
let handler: (r: Request) => Promise<Response> = null as any
;(Deno as any).serve = (h: any) => { handler = h; return { finished: Promise.resolve(), shutdown: async () => {} } }
await import('../../../functions/tungngern-receiver/index.ts')

const REF = 'ORD171126000001ABCD' + 'E' // ORD + 17 ตัว
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')
async function sign(ts: string, body: string, secret = SECRET) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return `sha256=${hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${ts}.${body}`)))}`
}
const T = () => (globalThis as any).__DB.t
function seed() {
  ;(globalThis as any).__DB = { t: {
    'public.tungngern_app_names': [{ name: 'ถุงเงิน' }],
    'public.punpang_orders': [{ id: 'o1', code: 'OR-171126-000001', status: 'awaiting_payment', updated_at: 't0', data: {
      pickupAt: '2026-12-30T10:00', history: [], payments: [{ id: 'p1', status: 'reported', amount: 250, qrRef: REF }],
    } }],
  } }
}
const note = (over: Record<string, unknown> = {}) => ({
  event: 'notification.forwarded', id: crypto.randomUUID(), app: 'com.ktb.tungngern', app_name: 'ถุงเงิน',
  title: 'เงินเข้า 250.00 บาท', text: `รายการ ${REF} สำเร็จ`, received_at: Date.now(), ...over,
})
async function post(payload: unknown, opt: { ts?: number; secret?: string; sig?: string; test?: boolean } = {}) {
  const body = JSON.stringify(payload)
  const ts = String(opt.ts ?? Math.floor(Date.now() / 1000))
  const headers: Record<string, string> = { 'X-Gateway-Timestamp': ts, 'X-Gateway-Signature': opt.sig ?? await sign(ts, body, opt.secret) }
  if (opt.test) headers['x-punpang-mode'] = 'test'
  const r = await handler(new Request('http://fn.fake', { method: 'POST', headers, body }))
  return { status: r.status, body: await r.json() }
}
const untouched = () => {
  assertEquals(T()['public.tungngern_transfers'], undefined)
  assertEquals(T()['public.tungngern_inbox'], undefined)
  assertEquals(T()['public.punpang_orders'][0].data.payments[0].receiptVerified, undefined)
}

Deno.test('ลายเซ็นผิด / ไม่มีลายเซ็น / ใช้ค่าลับอื่น → 401 และไม่แตะข้อมูลใด ๆ', async () => {
  seed()
  assertEquals((await post(note(), { sig: 'sha256=00' })).status, 401)
  assertEquals((await post(note(), { sig: '' })).status, 401)
  assertEquals((await post(note(), { secret: 'another-secret-0123456789' })).status, 401)
  untouched()
})

Deno.test('ลายเซ็นถูกแต่เวลาเก่าเกิน 5 นาที (ส่งซ้ำของเก่า) → 401', async () => {
  seed()
  assertEquals((await post(note(), { ts: Math.floor(Date.now() / 1000) - 301 })).status, 401)
  untouched()
})

Deno.test('โหมดทดสอบ → 409 ไม่ทำงาน', async () => {
  seed()
  assertEquals((await post(note(), { test: true })).status, 409)
  untouched()
})

Deno.test('แอปที่ไม่อยู่ในรายชื่อถุงเงิน → รับ (2xx กันส่งซ้ำ) แต่ไม่บันทึกและไม่จับคู่', async () => {
  seed()
  const r = await post(note({ app: 'com.other', app_name: 'แอปอื่น' }))
  assertEquals([r.status, r.body.stored], [200, false])
  assertEquals(T()['public.tungngern_transfers'], undefined)
  assertEquals(T()['public.tungngern_inbox'][0].reason, 'ไม่อยู่ในรายชื่อแอปถุงเงิน')
})

Deno.test('แจ้งเตือนถูกต้อง: รหัส+ยอดตรง → งวดชำระผ่านการตรวจสอบ · ส่งซ้ำ id เดิม → ไม่จับคู่ซ้ำ', async () => {
  seed()
  const n = note()
  const r = await post(n)
  assertEquals([r.status, r.body.stored], [200, true])
  assertEquals(T()['public.tungngern_transfers'].length, 1)
  const o = T()['public.punpang_orders'][0]
  assertEquals(o.data.payments[0].receiptVerified, true)
  assertEquals(o.status, 'payment_reported')
  const historyLen = o.data.history.length
  const again = await post(n)
  assertEquals([again.status, again.body.stored], [200, true])
  assertEquals(T()['public.tungngern_transfers'].length, 1)
  assertEquals(T()['public.punpang_orders'][0].data.history.length, historyLen)
  assert(T()['public.tungngern_inbox'].some((x: any) => x.reason === 'รับซ้ำ ไม่ทำซ้ำ'))
})

Deno.test('ยอดในแจ้งเตือนไม่ตรงกับงวด → บันทึกรหัส แต่ไม่ทำเครื่องหมายผ่านการตรวจสอบ', async () => {
  seed()
  const r = await post(note({ title: 'เงินเข้า 25.00 บาท' }))
  assertEquals(r.status, 200)
  assertEquals(T()['public.punpang_orders'][0].data.payments[0].receiptVerified, undefined)
  assertEquals(T()['public.punpang_orders'][0].status, 'awaiting_payment')
})
