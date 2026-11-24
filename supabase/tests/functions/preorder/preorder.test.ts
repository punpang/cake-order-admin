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
const shopV = { ...golden.catalog.shop, vat: { rate: 7, mode: 'inclusive' }, parcel: { fee: 10, boxes: [{ name: 'S', dims: { w: 20, l: 20, h: 20 }, boxG: 100, price: 15 }], steps: [1000, 2000], prices: { S: [60, 90] } } }

const camp = (over: any) => ({ id: 'c_open', status: 'open', order_from: '2000-01-01', order_to: '2099-12-31', pickup_from: '2099-12-24', pickup_to: '2099-12-26', deposit_percent: 50, pay_due_min: 120,
  data: { name: 'คริสต์มาส', dayCap: null, items: [{ retailId: 'pr1', dayCap: null }], deals: [], parcel: { enabled: false } }, ...over })

function seed() {
  ;(globalThis as any).__DB = { t: {
    'public.punpang_preorder_campaigns': [
      camp({}),
      camp({ id: 'c_closed', status: 'closed' }),
      camp({ id: 'c_past', order_to: '2001-01-01' }),
      camp({ id: 'c_parcel', data: { name: 'พัสดุ', dayCap: null, items: [{ retailId: 'pr2', dayCap: null }], deals: [], parcel: { enabled: true }, shipOff: [{ min: 60, value: 20 }], shipping: { shipFrom: '2099-12-22', shipTo: '2099-12-23' } } }),
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
  assertEquals(j.shippingFee, 65) // ค่าธรรมเนียม 10 + กล่อง S 15 + ขนส่ง 60 − ส่วนลดค่าส่งขั้น 60 บาท 20
  assertEquals(j.parcel.chargeableG, 900)
})
Deno.test('quote ส่งพัสดุในแคมเปญที่ไม่เปิดส่งพัสดุ → 400', async () => {
  seed()
  assertEquals((await call({ action: 'quote', campaignId: 'c_open', pickupDate: '2099-12-24', fulfillment: 'delivery', lines: [{ retailId: 'pr1', qty: 1 }] })).status, 400)
})

// ---------- OTP / เซสชัน / สร้างออร์เดอร์ / ออร์เดอร์ของฉัน ----------
const realFetch = globalThis.fetch
globalThis.fetch = (async (url: any, init?: any) => {
  const u = String(url)
  if (u.includes('challenges.cloudflare.com')) {
    const body = new URLSearchParams(String(init?.body ?? ''))
    return new Response(JSON.stringify({ success: body.get('response') === 'good-token' }), { status: 200 })
  }
  if (u.includes('/v1/sms')) return new Response('{}', { status: 200 })
  return realFetch(url, init)
}) as typeof fetch
Deno.env.set('TURNSTILE_SECRET_KEY', 'sec')
Deno.env.set('SMS_API_KEY', 'k')

const sha = async (s: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((x) => x.toString(16).padStart(2, '0')).join('')
const TOKEN = 'b'.repeat(64)
const ORDER = 'd'.repeat(32)

async function seedAuth(otpCode = '123456') {
  seed()
  const db = (globalThis as any).__DB
  db.t['public.punpang_customers'] = [{ id: 'cA', name: 'เดิม', phone: '0812345678', data: { active: true, ledger: [] } }]
  db.t['public.punpang_otps'] = [{ id: 'otp1', phone: '0812345678', purpose: 'preorder', code_hash: await sha(`salt1:${otpCode}`), salt: 'salt1', expires_at: new Date(Date.now() + 300e3).toISOString(), attempts: 0, used: false, sent_at: new Date(Date.now() - 120e3).toISOString() }]
  db.t['public.punpang_preorder_sessions'] = [{ token_hash: await sha('presess:' + TOKEN), customer_id: 'cA', expires_at: new Date(Date.now() + 3600e3).toISOString() }]
  db.t['public.punpang_preorder_orders'] = [{ id: 'po_mine', code: 'PRE-241124-000009', status: 'awaiting_payment', campaign_id: 'c_open', pickup_date: '2099-12-24', customer_id: 'cA', data: { total: 200, deposit: { percent: 50, amount: 100 } } }, { id: 'po_other', code: 'PRE-241124-000010', status: 'awaiting_payment', campaign_id: 'c_open', pickup_date: '2099-12-24', customer_id: 'cX', data: {} }]
  ;(globalThis as any).__RPC = {
    punpang_preorder_otp_allowed: async () => ({ data: true, error: null }),
    punpang_preorder_create: async () => ({ data: { ok: true, already: false, code: 'PRE-241124-000001' }, error: null }),
  }
  return db
}
const GOOD = 'good-token'

Deno.test('otp_request: Turnstile ไม่ผ่าน → 400 และไม่ส่ง SMS', async () => {
  await seedAuth()
  const r = await call({ action: 'otp_request', phone: '0899999999', turnstileToken: 'bad' })
  assertEquals(r.status, 400)
})
Deno.test('otp_request: เกินเพดาน (RPC ไม่อนุญาต) → 429', async () => {
  await seedAuth()
  ;(globalThis as any).__RPC.punpang_preorder_otp_allowed = async () => ({ data: false, error: null })
  assertEquals((await call({ action: 'otp_request', phone: '0899999999', turnstileToken: GOOD })).status, 429)
})
Deno.test('otp_request: สำเร็จ → 200 เหมือนกันทุกเบอร์ และมีแถว OTP purpose preorder', async () => {
  const db = await seedAuth()
  const r = await call({ action: 'otp_request', phone: '0899999999', turnstileToken: GOOD })
  assertEquals(r.status, 200)
  assertEquals((await r.json()).ok, true)
  assert(db.t['public.punpang_otps'].some((x: any) => x.phone === '0899999999' && x.purpose === 'preorder' && !x.used))
})
Deno.test('otp_verify: รหัสผิด → 400 และนับจำนวนที่ผิด', async () => {
  const db = await seedAuth()
  assertEquals((await call({ action: 'otp_verify', phone: '0812345678', code: '000000' })).status, 400)
  assertEquals(db.t['public.punpang_otps'][0].attempts, 1)
})
Deno.test('otp_verify: ลูกค้าใหม่ไม่ยินยอม → 400 needConsent', async () => {
  const db = await seedAuth('654321')
  db.t['public.punpang_otps'].push({ id: 'otp2', phone: '0899999999', purpose: 'preorder', code_hash: await sha('salt2:654321'), salt: 'salt2', expires_at: new Date(Date.now() + 300e3).toISOString(), attempts: 0, used: false, sent_at: new Date().toISOString() })
  const r = await call({ action: 'otp_verify', phone: '0899999999', code: '654321' })
  assertEquals(r.status, 400)
  assertEquals((await r.json()).needConsent, true)
})
Deno.test('otp_verify: รหัสถูก (เบอร์เดิม) → เซสชันสั่งล่วงหน้า และรหัสถูกใช้แล้ว', async () => {
  const db = await seedAuth('777777')
  const r = await call({ action: 'otp_verify', phone: '0812345678', code: '777777' })
  assertEquals(r.status, 200)
  const j = await r.json()
  assertEquals(typeof j.token, 'string')
  assertEquals(j.token.length, 64)
  assert(db.t['public.punpang_otps'][0].used === true)
  assert(db.t['public.punpang_preorder_sessions'].some((x: any) => x.customer_id === 'cA'))
})
Deno.test('state: ไม่มีเซสชัน → 401', async () => {
  await seedAuth()
  assertEquals((await call({ action: 'state', token: 'x' })).status, 401)
})
Deno.test('state: เห็นเฉพาะออร์เดอร์ของเซสชันนี้', async () => {
  await seedAuth()
  const j = await (await call({ action: 'state', token: TOKEN })).json()
  assertEquals(j.orders.map((o: any) => o.id), ['po_mine'])
  assertEquals(j.orders[0].deposit.amount, 100)
})
Deno.test('create: ไม่มีเซสชัน → 401', async () => {
  await seedAuth()
  const r = await call({ action: 'create', token: 'x', turnstileToken: GOOD, campaignId: 'c_open', pickupDate: '2099-12-24', fulfillment: 'pickup', lines: [{ retailId: 'pr1', qty: 1 }], orderId: ORDER })
  assertEquals(r.status, 401)
})
Deno.test('create: สำเร็จ → เลข PRE และยอดเงินมัดจำจากเซิร์ฟเวอร์', async () => {
  await seedAuth()
  const r = await call({ action: 'create', token: TOKEN, turnstileToken: GOOD, campaignId: 'c_open', pickupDate: '2099-12-24', fulfillment: 'pickup', lines: [{ retailId: 'pr1', qty: 2 }], orderId: ORDER, total: 1, deposit: 1 })
  assertEquals(r.status, 200)
  const j = await r.json()
  assertEquals(j.code, 'PRE-241124-000001')
  assertEquals(j.total, 200)
  assertEquals(j.deposit, 100)
})
Deno.test('create จัดส่ง: มัดจำเท่ายอดรวมเสมอ (ไม่ใช้เปอร์เซ็นต์ของแคมเปญ)', async () => {
  await seedAuth()
  const r = await call({ action: 'create', token: TOKEN, turnstileToken: GOOD, campaignId: 'c_parcel', pickupDate: '2099-12-24', fulfillment: 'delivery', address: '1 ถนนทดสอบ', province: 'เชียงใหม่', shipping: { shipFrom: '2099-12-22', shipTo: '2099-12-23' }, lines: [{ retailId: 'pr2', qty: 1 }], orderId: ORDER, deposit: 1 })
  assertEquals(r.status, 200)
  const j = await r.json()
  assertEquals(j.deposit, j.total)
})
Deno.test('create: โควตาเต็ม (RPC reserve_failed) → 409 พร้อมรหัสเหตุผล', async () => {
  await seedAuth()
  ;(globalThis as any).__RPC.punpang_preorder_create = async () => ({ data: null, error: { message: 'reserve_failed:item_full' } })
  const r = await call({ action: 'create', token: TOKEN, turnstileToken: GOOD, campaignId: 'c_open', pickupDate: '2099-12-24', fulfillment: 'pickup', lines: [{ retailId: 'pr1', qty: 1 }], orderId: ORDER })
  assertEquals(r.status, 409)
  assertEquals((await r.json()).code, 'item_full')
})
Deno.test('create: รหัสออร์เดอร์ไม่ใช่ hex 32 ตัว → 400', async () => {
  await seedAuth()
  const r = await call({ action: 'create', token: TOKEN, turnstileToken: GOOD, campaignId: 'c_open', pickupDate: '2099-12-24', fulfillment: 'pickup', lines: [{ retailId: 'pr1', qty: 1 }], orderId: 'bad' })
  assertEquals(r.status, 400)
})

Deno.test('campaigns: ส่งช่วงวันจัดส่งเฉพาะแคมเปญที่เปิดส่งพัสดุ', async () => {
  seed()
  const j = await (await call({ action: 'campaigns' })).json()
  assertEquals(j.campaigns.find((c: any) => c.id === 'c_parcel').shipping, { shipFrom: '2099-12-22', shipTo: '2099-12-23' })
  assertEquals(j.campaigns.find((c: any) => c.id === 'c_open').shipping, null)
})
Deno.test('create ส่งพัสดุ: เก็บช่วงวันจัดส่งของแคมเปญไว้ในออเดอร์ (ไม่รับค่าจากผู้ใช้)', async () => {
  await seedAuth()
  let captured: any = null
  ;(globalThis as any).__RPC.punpang_preorder_create = async (args: any) => { captured = args; return { data: { ok: true, already: false, code: 'PRE-241124-000002' }, error: null } }
  const r = await call({ action: 'create', token: TOKEN, turnstileToken: GOOD, campaignId: 'c_parcel', pickupDate: '2099-12-24', fulfillment: 'delivery', address: '1 ถนนทดสอบ', province: 'เชียงใหม่', shipping: { shipFrom: '2000-01-01', shipTo: '2000-01-02' }, lines: [{ retailId: 'pr2', qty: 1 }], orderId: ORDER })
  assertEquals(r.status, 200)
  assertEquals(captured.p_row.data.shipping, { shipFrom: '2099-12-22', shipTo: '2099-12-23' })
})
Deno.test('create ส่งพัสดุในแคมเปญที่ยังไม่ระบุวันจัดส่ง → 409', async () => {
  await seedAuth()
  const row = (globalThis as any).__DB.t['public.punpang_preorder_campaigns'].find((x: any) => x.id === 'c_parcel')
  delete row.data.shipping
  const r = await call({ action: 'create', token: TOKEN, turnstileToken: GOOD, campaignId: 'c_parcel', pickupDate: '2099-12-24', fulfillment: 'delivery', address: '1 ถนนทดสอบ', province: 'เชียงใหม่', lines: [{ retailId: 'pr2', qty: 1 }], orderId: ORDER })
  assertEquals(r.status, 409)
  assertEquals((await r.json()).error, 'แคมเปญนี้ยังไม่ระบุวันจัดส่งพัสดุ')
})
Deno.test('create ส่งพัสดุโดยไม่กรอกที่อยู่ → 400', async () => {
  await seedAuth()
  const r = await call({ action: 'create', token: TOKEN, turnstileToken: GOOD, campaignId: 'c_open', pickupDate: '2099-12-24', fulfillment: 'delivery', lines: [{ retailId: 'pr1', qty: 1 }], orderId: ORDER })
  assertEquals(r.status, 400)
})
