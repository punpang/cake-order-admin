// ทดสอบ preorder-audit: ตรวจค่าส่งและแต้มของออร์เดอร์สั่งล่วงหน้าที่ส่งมอบ/ยกเลิกแล้ว แล้วบันทึกผลลง punpang_preorder_audits
// จำลองฐานข้อมูลผ่าน fetch (RPC คิว, ตั้งค่า, สินค้า, ประวัติแคตาล็อก, แคมเปญ, ผลตรวจ)
// รัน: deno test -A --no-lock --node-modules-dir=none --unstable-sloppy-imports --import-map=supabase/tests/functions/_fake/importmap.json supabase/tests/functions/preorder-audit/
import { assertEquals } from 'jsr:@std/assert@1'

let handler: (r: Request) => Promise<Response> = null as any
;(Deno as any).serve = (h: any) => { handler = h; return { finished: Promise.resolve(), shutdown: async () => {} } }
Deno.env.set('SUPABASE_URL', 'http://db.fake')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service')
Deno.env.set('SCHEDULED_KEY', 'k'.repeat(24))
await import('../../../functions/preorder-audit/index.ts')

const KEY = 'k'.repeat(24)
const CREATED = '2026-11-20T03:00:00.000Z'

// กล่อง S 20×20×20 น้ำหนักกล่อง 100 ราคา 15 · ค่าธรรมเนียม 10 · ขั้น 1000 = 60 → ค่าส่ง 85 (สินค้า 800 g)
const SHOP = { parcel: { fee: 10, boxes: [{ name: 'S', dims: { w: 20, l: 20, h: 20 }, boxG: 100, price: 15 }], steps: [1000, 2000], prices: { S: [60, 90] } } }
const ITEMS = [{ id: 'P', name: 'P', price: 500, active: true, weightG: 800, dimsCm: { w: 10, l: 10, h: 10 } }]

const good = (over: Record<string, unknown> = {}, id = 'po1') => ({
  id,
  campaign_id: 'c1',
  status: 'delivered',
  created_at: CREATED,
  data: {
    fulfillment: 'delivery',
    lines: [{ retailId: 'P', qty: 1 }],
    items: [{ retailId: 'P', unitPrice: 500, qty: 1 }],
    shippingFee: 85,
    loyalty: { points: 5, mult: 1, base: 500 },
    ...over,
  },
})

let queue: any[] = []
let rpcFails = false
let saveFails = false
let saved: any[] = []
const J = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } })
globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
  const req = new Request(input, init)
  const url = new URL(req.url)
  if (url.host !== 'db.fake') throw new Error(`ไม่ควรเรียก ${url.host}`)
  const p = url.pathname
  if (p === '/rest/v1/rpc/punpang_preorder_orders_unaudited') return rpcFails ? J({ message: 'boom' }, 500) : J(queue)
  if (p === '/rest/v1/punpang_kv') {
    if (url.searchParams.get('id') === 'eq.loyalty') return J([{ id: 'loyalty', data: { v: { earnPer: 100 } } }])
    return J([{ id: 'shop', data: { v: SHOP } }])
  }
  if (p === '/rest/v1/punpang_items') return J(ITEMS.map((x) => ({ id: x.id, name: x.name, price: x.price, active: x.active, data: x })))
  if (p === '/rest/v1/punpang_catalog_history') return J([])
  if (p === '/rest/v1/punpang_preorder_campaigns') return J([{ id: 'c1', data: { shipOff: [] } }])
  if (p === '/rest/v1/punpang_preorder_audits' && req.method === 'POST') {
    if (saveFails) return J({ message: 'boom' }, 500)
    saved = JSON.parse(await req.text())
    return new Response(null, { status: 201 })
  }
  return J({ message: `ไม่ได้จำลอง ${p}` }, 404)
}) as typeof fetch

const call = async (key = KEY) => {
  const r = await handler(new Request('http://x', { method: 'POST', headers: { 'x-cron-key': key } }))
  return { status: r.status, body: await r.json() }
}
const reset = () => { queue = []; rpcFails = false; saveFails = false; saved = [] }

Deno.test('คีย์ cron ไม่ถูกต้อง → 403', async () => {
  reset()
  assertEquals((await call('wrong-key-value-xxxxxxxxxx')).status, 403)
})

Deno.test('ไม่มีออร์เดอร์รอตรวจ → checked 0 และไม่บันทึกอะไร', async () => {
  reset()
  assertEquals((await call()).body, { checked: 0, flagged: 0 })
  assertEquals(saved.length, 0)
})

Deno.test('ออร์เดอร์ที่ค่าส่งและแต้มถูกต้อง → ผ่าน บันทึก ok = true', async () => {
  reset()
  queue = [good()]
  assertEquals((await call()).body, { checked: 1, flagged: 0 })
  assertEquals(saved.length, 1)
  assertEquals(saved[0].order_id, 'po1')
  assertEquals(saved[0].ok, true)
  assertEquals(saved[0].flags, [])
})

Deno.test('ค่าส่งที่บันทึกไม่ตรงตาราง → flag shipping_mismatch (high)', async () => {
  reset()
  queue = [good({ shippingFee: 80 })]
  assertEquals((await call()).body, { checked: 1, flagged: 1 })
  assertEquals(saved[0].ok, false)
  assertEquals(saved[0].flags.map((f: any) => f.code), ['shipping_mismatch'])
})

Deno.test('แต้มไม่ตรงกับ ฐาน × ตัวคูณ ÷ แต้มต่อบาท → flag points_mismatch', async () => {
  reset()
  queue = [good({ loyalty: { points: 4, mult: 1, base: 500 } })]
  assertEquals((await call()).body, { checked: 1, flagged: 1 })
  assertEquals(saved[0].flags.map((f: any) => f.code), ['points_mismatch'])
})

Deno.test('ตัวคูณสมาชิกที่เก็บไว้ถูกใช้ตรวจแต้ม (500 × 1.5 ÷ 100 = 7)', async () => {
  reset()
  queue = [good({ loyalty: { points: 7, mult: 1.5, base: 500 } })]
  assertEquals((await call()).body, { checked: 1, flagged: 0 })
})

Deno.test('หลายออร์เดอร์ ตรวจทุกใบและนับเฉพาะที่ผิด', async () => {
  reset()
  queue = [good({}, 'po1'), good({ shippingFee: 1 }, 'po2'), good({ loyalty: { points: 9, mult: 1, base: 500 } }, 'po3')]
  assertEquals((await call()).body, { checked: 3, flagged: 2 })
  assertEquals(saved.map((x) => x.order_id), ['po1', 'po2', 'po3'])
})

Deno.test('อ่านคิวไม่ได้ → 502 และไม่บันทึกอะไร', async () => {
  reset()
  rpcFails = true
  assertEquals((await call()).status, 502)
  assertEquals(saved.length, 0)
})

Deno.test('บันทึกผลไม่สำเร็จ → 502', async () => {
  reset()
  queue = [good()]
  saveFails = true
  assertEquals((await call()).status, 502)
})
