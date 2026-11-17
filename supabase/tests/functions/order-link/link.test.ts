// ทดสอบ Edge Function order-link ทั้งฟังก์ชัน (ลิงก์ดูออร์เดอร์ของลูกค้า เปิดได้โดยไม่ต้องล็อกอิน)
// สิ่งที่ต้องเป็นจริง: ข้อมูลส่วนตัวและข้อมูลภายในร้านถูกตัดที่เซิร์ฟเวอร์ · ลิงก์หมดอายุ/ถูกเพิกถอนเปิดไม่ได้ · เดาโทเค็นถี่ถูกบล็อก
// รัน (ทุกชุด): npm run test:fn · หรือ deno test -A --no-lock --node-modules-dir=none --unstable-sloppy-imports --import-map=supabase/tests/functions/_fake/importmap.json supabase/tests/functions/order-link/
import { assert, assertEquals, assertFalse } from 'jsr:@std/assert@1'

Deno.env.set('SUPABASE_URL', 'http://db.fake')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service')
let handler: (r: Request) => Promise<Response> = null as any
;(Deno as any).serve = (h: any) => { handler = h; return { finished: Promise.resolve(), shutdown: async () => {} } }
await import('../../../functions/order-link/index.ts')

const TOKEN = 'A'.repeat(16) + 'b'.repeat(14) + '_-'
const DAY = 86400000
const sha = async (s: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('')
const T = () => (globalThis as any).__DB.t
async function seed(link: Record<string, unknown> = {}) {
  ;(globalThis as any).__DB = { t: {
    'public.punpang_records': [{ collection: 'orderLinks', id: 'lk1', data: { tokenHash: await sha(`orderlink:${TOKEN}`), orderId: 'o1', createdAt: new Date().toISOString(), openCount: 0, ...link } }],
    'public.punpang_kv': [{ collection: 'config', id: 'shop', data: { v: { name: 'ร้านทดสอบ', linkPolicy: { idleDays: 7, neverOpenedDays: 30 } } } }],
    'public.punpang_orders': [{ id: 'o1', code: 'OR-171126-000001', customer_id: 'c1', status: 'awaiting_payment', fulfillment: 'delivery', channel: null, data: {
      history: [{ text: 'ภายใน' }], approval: { by: 'ผู้จัดการ' }, shiftId: 's1', chatId: 'ch1',
      address: '99/9 ถนนลับ', mapUrl: 'https://maps.fake/x', detail: 'ฝากป้อมยาม', birthday: { name: 'น้องเอ', md: '05-12' },
      payments: [{ id: 'p1', amount: 100, slip: 'sb://punpang-private/slips/p1.png' }],
      items: [{ id: 'i1', note: 'โน้ตภายใน', images: ['sb://punpang-private/ref/a.png'], workPhotos: [{ image: 'sb://punpang-private/work/w.png' }] }],
    } }],
    'public.punpang_customers': [{ id: 'c1', name: 'สมชาย ใจดี', phone: '081-234-5678', data: {} }],
  } }
}
let ipn = 0
const open = async (body: unknown, ip = `10.0.0.${++ipn}`) => {
  const r = await handler(new Request('http://fn.fake', { method: 'POST', headers: { 'cf-connecting-ip': ip, 'content-type': 'application/json' }, body: JSON.stringify(body) }))
  return { status: r.status, body: await r.json() }
}

Deno.test('เปิดลิงก์: ตัดข้อมูลส่วนตัวและข้อมูลภายในร้านที่เซิร์ฟเวอร์', async () => {
  await seed()
  const r = await open({ token: TOKEN })
  assertEquals(r.status, 200)
  const d = r.body.order.data
  for (const k of ['history', 'approval', 'shiftId', 'chatId', 'address', 'mapUrl', 'detail', 'birthday']) assertFalse(k in d, `ยังมี ${k}`)
  assertEquals(d.payments[0].slip, '') // ไม่ส่งรูปสลิป
  assertFalse('note' in d.items[0])
  assert(String(d.items[0].images[0]).startsWith('https://signed.fake/'), 'รูปส่วนตัวต้องเป็นลิงก์ชั่วคราว')
  assert(String(d.items[0].workPhotos[0].image).includes('ttl=3600'))
  assertEquals(r.body.customer, { id: 'c1', name: 'สมชาย', phone: '0000000678', deleted: false }) // ชื่อแรก + เบอร์ 3 ตัวท้ายเท่านั้น
  for (const k of ['tokenHash', 'openCount', 'revokedAt']) assertFalse(k in r.body.link, `ลิงก์ยังมี ${k}`)
  assertFalse(JSON.stringify(r.body).includes('081-234-5678'))
})

Deno.test('เปิดลิงก์นับครั้งและเลื่อนวันหมดอายุ · รีเฟรชเงียบไม่นับ', async () => {
  await seed()
  await open({ token: TOKEN })
  assertEquals(T()['public.punpang_records'][0].data.openCount, 1)
  await open({ token: TOKEN, refresh: true })
  assertEquals(T()['public.punpang_records'][0].data.openCount, 1)
  assert(T()['public.punpang_records'][0].data.lastOpenedAt)
})

Deno.test('ลิงก์หมดอายุ: ไม่เคยเปิดเกิน 30 วัน · เปิดล่าสุดเกิน 7 วัน → 404', async () => {
  await seed({ createdAt: new Date(Date.now() - 31 * DAY).toISOString() })
  assertEquals((await open({ token: TOKEN })).status, 404)
  await seed({ createdAt: new Date(Date.now() - 60 * DAY).toISOString(), lastOpenedAt: new Date(Date.now() - 8 * DAY).toISOString() })
  assertEquals((await open({ token: TOKEN })).status, 404)
  await seed({ createdAt: new Date(Date.now() - 60 * DAY).toISOString(), lastOpenedAt: new Date(Date.now() - 6 * DAY).toISOString() })
  assertEquals((await open({ token: TOKEN })).status, 200)
})

Deno.test('ลิงก์ที่ถูกเพิกถอน → 404 และไม่ถูกเขียนทับกลับ', async () => {
  await seed({ revokedAt: new Date().toISOString() })
  assertEquals((await open({ token: TOKEN })).status, 404)
  assertEquals(T()['public.punpang_records'][0].data.openCount, 0)
})

Deno.test('โทเค็นผิด/ผิดรูปแบบ → 404 ข้อความเดียวกัน · เดาผิด 20 ครั้งจาก IP เดียว → 429 แม้โทเค็นถูก', async () => {
  await seed()
  const wrong = await open({ token: 'Z'.repeat(32) })
  const bad = await open({ token: '../etc' })
  assertEquals([wrong.status, bad.status], [404, 404])
  assertEquals(wrong.body, bad.body)
  for (let i = 0; i < 20; i++) await open({ token: 'Y'.repeat(32) }, '10.9.9.9')
  assertEquals((await open({ token: TOKEN }, '10.9.9.9')).status, 429)
  assertEquals((await open({ token: TOKEN })).status, 200) // IP อื่นไม่โดน
})
