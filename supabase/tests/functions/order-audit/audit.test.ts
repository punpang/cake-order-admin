// ทดสอบ order-audit: ตรวจออร์เดอร์ที่บันทึกแล้วด้วยราคา ณ เวลาที่สร้าง · ออร์เดอร์ที่ราคาไม่ตรง → ธง high + hold (บล็อกการยืนยันชำระจนกว่าผู้จัดการตรวจ)
// ใช้ชุดตัวอย่างราคาจริงจาก src/lib/quotePrice.golden.json (แคตาล็อก + ออร์เดอร์ที่คิดราคาถูกต้องแล้ว)
// จำลองฐานข้อมูลผ่าน fetch (RPC punpang_orders_unaudited, ตั้งค่า, สินค้า, ประวัติแคตาล็อก, รายการรับเงิน, บันทึกผล)
// รัน: deno test -A --no-lock --node-modules-dir=none --import-map=supabase/tests/functions/_fake/importmap.json supabase/tests/functions/order-audit/
import { assertEquals, assert } from 'jsr:@std/assert@1'
import golden from '../../../../src/lib/quotePrice.golden.json' with { type: 'json' }

let handler: (r: Request) => Promise<Response> = null as any
;(Deno as any).serve = (h: any) => { handler = h; return { finished: Promise.resolve(), shutdown: async () => {} } }
Deno.env.set('SUPABASE_URL', 'http://db.fake')
Deno.env.set('SUPABASE_ANON_KEY', 'anon')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service')
Deno.env.set('SCHEDULED_KEY', 'k'.repeat(24))
await import('../../../functions/order-audit/index.ts')

const KEY = 'k'.repeat(24)
const g: any = golden
const cat: any = g.catalog
const CASE: any = g.cases.find((c: any) => c.payload && c.payload.items?.length)
const ORDER_TIME = new Date(g.nowMs).toISOString()

let unaudited: any[] = []
let kvFails = false
let saved: any[] = []
let transfers: any[] = []
const J = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } })
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
  const req = new Request(input, init)
  const url = new URL(req.url)
  if (url.host !== 'db.fake') return realFetch(input, init)
  const p = url.pathname
  if (p === '/rest/v1/rpc/punpang_orders_unaudited') return J(unaudited)
  if (p === '/rest/v1/punpang_kv') return kvFails ? J({ message: 'boom' }, 500) : J(Object.entries(cat).filter(([k]) => k !== 'retailItems').map(([id, v]) => ({ id, data: { v } })))
  if (p === '/rest/v1/punpang_items') return J(cat.retailItems.map((x: any) => ({ id: x.id, name: x.name, price: x.price, active: x.active, data: x })))
  if (p === '/rest/v1/punpang_catalog_history') return J([])
  if (p === '/rest/v1/tungngern_transfers') return J(transfers)
  if (p === '/rest/v1/punpang_order_audits' && req.method === 'POST') { saved = JSON.parse(await req.text()); return new Response(null, { status: 201 }) }
  return J({ message: `ไม่ได้จำลอง ${p}` }, 404)
}) as typeof fetch

const call = async (key = KEY) => {
  const r = await handler(new Request('http://x', { method: 'POST', headers: { 'x-cron-key': key } }))
  return { status: r.status, body: await r.json() }
}
const row = (data: any, id = 'o1') => ({ id, channel: 'web', status: 'new', fulfillment: data.fulfillment, data: { ...data, createdAt: ORDER_TIME } })
const clean = () => JSON.parse(JSON.stringify(CASE.payload))
const reset = () => { unaudited = []; kvFails = false; saved = []; transfers = [] }

Deno.test('คีย์ cron ไม่ถูกต้อง → 403', async () => {
  reset()
  assertEquals((await call('wrong-key-value-xxxxxxxxxx')).status, 403)
})

Deno.test('ไม่มีออร์เดอร์รอตรวจ → checked 0 และไม่บันทึกอะไร', async () => {
  reset()
  assertEquals((await call()).body, { checked: 0, flagged: 0 })
  assertEquals(saved.length, 0)
})

Deno.test('ออร์เดอร์ที่ราคาถูกต้อง → ผ่าน ไม่ hold', async () => {
  reset()
  unaudited = [row(clean())]
  const r = await call()
  assertEquals(r.body, { checked: 1, flagged: 0 })
  assertEquals(saved.length, 1)
  assertEquals([saved[0].order_id, saved[0].ok, saved[0].hold], ['o1', true, false])
})

Deno.test('ราคาต่อชิ้นในออร์เดอร์ถูกแก้ → ธง high และ hold', async () => {
  reset()
  const d = clean()
  d.items[0].unitPrice = Number(d.items[0].unitPrice) + 100
  d.items[0].fullPrice = Number(d.items[0].fullPrice) + 100
  unaudited = [row(d)]
  const r = await call()
  assertEquals(r.body, { checked: 1, flagged: 1 })
  assertEquals(saved[0].ok, false)
  assertEquals(saved[0].hold, true)
  assert(saved[0].flags.some((f: any) => f.code === 'unit_price_mismatch' && f.severity === 'high'))
})

Deno.test('โหลดแคตาล็อกไม่ได้ → 502 และไม่บันทึกผลตรวจที่ไม่สมบูรณ์', async () => {
  reset()
  unaudited = [row(clean())]
  kvFails = true
  const r = await call()
  assertEquals(r.status, 502)
  assertEquals(saved.length, 0)
})
