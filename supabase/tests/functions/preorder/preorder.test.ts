// ทดสอบ Edge Function preorder (action campaigns / quote) · ตัวจำลองฐานข้อมูลแบบ _fake · รัน: deno test -A --no-lock --node-modules-dir=none --import-map=supabase/tests/functions/_fake/importmap.json supabase/tests/functions/preorder/
// ครอบ: เมธอด · คำสั่งไม่รู้จัก · แคมเปญปิด/นอกช่วง · ไม่เผยอัตราค่าส่ง · ราคาคิดที่เซิร์ฟเวอร์ · ค่าส่งพัสดุจากตาราง · ไม่เชื่อค่าที่ผู้ใช้ส่ง
import { assertEquals, assert } from 'jsr:@std/assert@1'
import { readFileSync } from 'node:fs'

let handler: (r: Request) => Promise<Response> = null as any
;(Deno as any).serve = (h: any) => { handler = h; return { finished: Promise.resolve(), shutdown: async () => {} } }
Deno.env.set('SUPABASE_URL', 'http://db.fake')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service')
await import('../../../functions/preorder/index.ts')

const golden = JSON.parse(readFileSync(new URL('../../../../src/lib/quotePrice.golden.json', import.meta.url), 'utf8'))
const shopV = { ...golden.catalog.shop, vat: { rate: 7, mode: 'inclusive' }, parcel: { boxG: 100, volDivisor: 5000, rates: [{ upToG: 1000, price: 60 }, { upToG: 2000, price: 90 }] } }

const camp = (over: any) => ({ id: 'c_open', status: 'open', order_from: '2000-01-01', order_to: '2099-12-31', pickup_from: '2099-12-24', pickup_to: '2099-12-26', deposit_percent: 50, pay_due_min: 120,
  data: { name: 'คริสต์มาส', dayCap: null, items: [{ retailId: 'pr1', dayCap: null }], deals: [], parcel: { enabled: false } }, ...over })

function seed() {
  ;(globalThis as any).__DB = { t: {
    'public.punpang_preorder_campaigns': [
      camp({}),
      camp({ id: 'c_closed', status: 'closed' }),
      camp({ id: 'c_past', order_to: '2001-01-01' }),
      camp({ id: 'c_parcel', data: { name: 'พัสดุ', dayCap: null, items: [{ retailId: 'pr2', dayCap: null }], deals: [], parcel: { enabled: true } } }),
    ],
    'public.punpang_items': [
      { id: 'pr1', kind: 'retail', name: 'เค้กพร้อมส่ง', price: 100, active: true, data: {} },
      { id: 'pr2', kind: 'retail', name: 'กล่องพัสดุ', price: 300, active: true, data: { weightG: 800, dimsCm: { w: 20, l: 20, h: 10 } } },
    ],
    'public.punpang_kv': [
      { collection: 'config', id: 'shop', data: { v: shopV } },
      { collection: 'config', id: 'loyalty', data: { v: { pointValue: 1 } } },
    ],
  } }
}

const call = (body: any, method = 'POST') => handler(new Request('http://fn/preorder', { method, headers: { 'content-type': 'application/json' }, body: method === 'POST' ? JSON.stringify(body) : undefined }))

Deno.test('เมธอด GET → 405', async () => {
  seed()
  assertEquals((await call({}, 'GET')).status, 405)
})
Deno.test('คำสั่งไม่รู้จัก → 400', async () => {
  seed()
  assertEquals((await call({ action: 'hack' })).status, 400)
})
Deno.test('campaigns: เห็นเฉพาะแคมเปญเปิดรับที่อยู่ในช่วง และไม่มีอัตราค่าส่งในผล', async () => {
  seed()
  const r = await call({ action: 'campaigns' })
  assertEquals(r.status, 200)
  const j = await r.json()
  assertEquals(j.campaigns.map((c: any) => c.id).sort(), ['c_open', 'c_parcel'])
  const text = JSON.stringify(j)
  assert(!text.includes('upToG'), 'ต้องไม่มีอัตราค่าส่ง')
  assert(!text.includes('volDivisor'), 'ต้องไม่มีตัวหารปริมาตร')
  assertEquals(j.campaigns.find((c: any) => c.id === 'c_open').items[0].price, 100)
})
Deno.test('quote: แคมเปญปิด/นอกช่วง → 409', async () => {
  seed()
  for (const id of ['c_closed', 'c_past']) {
    assertEquals((await call({ action: 'quote', campaignId: id, pickupDate: '2099-12-24', fulfillment: 'pickup', lines: [{ retailId: 'pr1', qty: 1 }] })).status, 409)
  }
})
Deno.test('quote: สินค้านอกแคมเปญ → 400 พร้อมรหัสสินค้า', async () => {
  seed()
  const r = await call({ action: 'quote', campaignId: 'c_open', pickupDate: '2099-12-24', fulfillment: 'pickup', lines: [{ retailId: 'pr2', qty: 1 }] })
  assertEquals(r.status, 400)
  assertEquals((await r.json()).itemId, 'pr2')
})
Deno.test('quote: วันรับนอกช่วง → 400', async () => {
  seed()
  assertEquals((await call({ action: 'quote', campaignId: 'c_open', pickupDate: '2099-12-30', fulfillment: 'pickup', lines: [{ retailId: 'pr1', qty: 1 }] })).status, 400)
})
Deno.test('quote รับที่ร้าน: ราคาคิดที่เซิร์ฟเวอร์ และค่า unitPrice ที่ผู้ใช้ส่งมาถูกทิ้ง', async () => {
  seed()
  const r = await call({ action: 'quote', campaignId: 'c_open', pickupDate: '2099-12-24', fulfillment: 'pickup', lines: [{ retailId: 'pr1', qty: 2, unitPrice: 1, price: 1 }], shippingFee: 0, points: 999 })
  assertEquals(r.status, 200)
  const j = await r.json()
  assertEquals(j.total, 200)
  assertEquals(j.shippingFee, 0)
})
Deno.test('quote ส่งพัสดุ: ค่าส่งมาจากตารางของร้าน ไม่ใช่ค่าที่ผู้ใช้ส่ง', async () => {
  seed()
  const r = await call({ action: 'quote', campaignId: 'c_parcel', pickupDate: '2099-12-24', fulfillment: 'delivery', lines: [{ retailId: 'pr2', qty: 1 }], shippingFee: 0 })
  assertEquals(r.status, 200)
  const j = await r.json()
  assertEquals(j.shippingFee, 60)
  assertEquals(j.parcel.chargeableG, 900)
})
Deno.test('quote ส่งพัสดุในแคมเปญที่ไม่เปิดส่งพัสดุ → 400', async () => {
  seed()
  assertEquals((await call({ action: 'quote', campaignId: 'c_open', pickupDate: '2099-12-24', fulfillment: 'delivery', lines: [{ retailId: 'pr1', qty: 1 }] })).status, 400)
})
