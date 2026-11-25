// ทดสอบเส้นทางสร้างออร์เดอร์ครบทาง: โค้ดฝั่งแอปตัวจริง (ตัวออกเลข + pushOrders) → Edge Function order-create ตัวจริง
// จำลองเฉพาะเครือข่ายไปฐานข้อมูล (fetch) · ไม่ต้องมีคีย์ ไม่แตะฐานข้อมูลจริง
// เหตุที่ต้องมี: บั๊ก TEST-OR (17 พ.ย. 69) เกิดจากแอปเติม TEST- แต่เซิร์ฟเวอร์ไม่รับ — เทสต์แยกฝั่งผ่านทั้งคู่ แต่ใช้ร่วมกันพัง
// รัน (ทุกชุด): npm run test:fn · หรือ deno test -A --no-lock --node-modules-dir=none --unstable-sloppy-imports --import-map=supabase/tests/functions/_fake/importmap.json supabase/tests/functions/order-create/
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import golden from '../../../../src/lib/quotePrice.golden.json' with { type: 'json' }
import { pushOrders as pushOrdersJs } from '../../../../src/lib/ordersSync.js'
// ชนิดของ pushOrders อนุมานจากค่าเริ่มต้นในไฟล์ JS (numbering = null) จึงใช้แบบไม่ตรวจชนิด
const pushOrders = pushOrdersJs as any
import { createNumbering } from '../../../../src/lib/docNo.js'
const TEST_HEADER = 'x-punpang-mode'
const docCode = (code: string, on: boolean) => (on && code ? 'TEST-' + code : code)

// ---------- ดึง handler ของ order-create ----------
let handler: (r: Request) => Promise<Response> = null as any
;(Deno as any).serve = (h: any) => { handler = h; return { finished: Promise.resolve(), shutdown: async () => {} } }
Deno.env.set('SUPABASE_URL', 'http://db.fake')
Deno.env.set('SUPABASE_ANON_KEY', 'anon')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service')

// ---------- ฐานข้อมูลจำลอง (ผ่าน fetch) ----------
const ref: any = (golden as any).cases.find((c: any) => c.payload && c.payload.items?.length)
const cat: any = (golden as any).catalog
const USERS: Record<string, string> = { 'tok-staff': 'u-staff', 'tok-chat': 'u-chat' }
const STAFF: Record<string, any> = {
  'u-staff': { user_id: 'u-staff', active: true, perms: ['createOrder'] },
  'u-chat': { user_id: 'u-chat', active: true, perms: ['chat'] },
}
type Row = { schema: string; [k: string]: any }
let rows: Row[] = []
let reads: { table: string; schema: string }[] = []
const catalogReads: { table: string; schema: string }[] = [] // การอ่านแคตาล็อก (ตามสคีมาที่หัวคำขอระบุ)
const deletedCustomers = new Set<string>() // ลูกค้าที่ถูกลบ (data.deleted = true) สำหรับเคสทดสอบ
const J = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } })
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
  const req = new Request(input, init)
  const url = new URL(req.url)
  if (url.host !== 'db.fake') return realFetch(input, init)
  const p = url.pathname
  const eq = (k: string) => decodeURIComponent((url.searchParams.get(k) || '').replace(/^eq\./, ''))
  if (p === '/auth/v1/user') {
    const id = USERS[(req.headers.get('authorization') || '').replace(/^Bearer /, '')]
    return id ? J({ id }) : J({ msg: 'invalid token' }, 401)
  }
  if (p === '/rest/v1/punpang_staff') return J(STAFF[eq('user_id')] ? [STAFF[eq('user_id')]] : [])
  if (p === '/rest/v1/punpang_customers') {
    reads.push({ table: 'punpang_customers', schema: req.headers.get('accept-profile') || 'public' })
    const id = eq('id')
    const cols = (url.searchParams.get('select') || '*').split(',').map((c) => c.trim())
    // ตอบเหมือน PostgREST: ขอคอลัมน์ที่ตารางไม่มี → 400 (บั๊กจริงขอ `deleted` ทั้งที่ค่านี้อยู่ใน data)
    const bad = cols.find((c) => !/^(?:\w+:)?(?:id|name|phone|note|created_at|updated_at)$|^(?:\w+:)?data->deleted$/.test(c))
    if (bad) return J({ code: '42703', message: `column punpang_customers.${bad.replace(/^\w+:/, '')} does not exist` }, 400)
    const row: Record<string, unknown> = {}
    for (const c of cols) {
      const [alias, expr] = c.includes(':') ? (c.split(':') as [string, string]) : (['', c] as [string, string])
      row[alias || expr] = expr === 'id' ? id : expr === 'data->deleted' ? deletedCustomers.has(id) : null
    }
    return J([row])
  }
  if (p === '/rest/v1/punpang_kv' || p === '/rest/v1/punpang_items') catalogReads.push({ table: p.replace('/rest/v1/', ''), schema: req.headers.get('accept-profile') || 'public' })
  if (p === '/rest/v1/punpang_kv') return J(Object.entries(cat).filter(([k]) => k !== 'retailItems').map(([id, v]) => ({ id, data: { v } })))
  if (p === '/rest/v1/punpang_items') return J(cat.retailItems.map((x: any) => ({ id: x.id, name: x.name, price: x.price, active: x.active, data: x })))
  if (p === '/rest/v1/punpang_orders' && req.method === 'POST') {
    const schema = req.headers.get('content-profile') || 'public'
    const [row] = await req.json()
    if (rows.some((r) => r.schema === schema && r.id === row.id)) return J({ code: '23505', message: 'duplicate key value violates unique constraint "punpang_orders_pkey"' }, 409)
    if (rows.some((r) => r.schema === schema && r.code === row.code)) return J({ code: '23505', message: 'duplicate key value violates unique constraint "punpang_orders_code_key"' }, 409)
    rows.push({ schema, ...row })
    return J([{ ...row, updated_at: '2026-11-17T00:00:00.000000+00:00' }], 201)
  }
  // สิทธิเดือนเกิด: เทสต์นี้ไม่มีสิทธิ (ส่วนลดเดือนเกิดไม่เกี่ยวกับการทดสอบนี้)
  if (p === '/rest/v1/rpc/punpang_member_birth_for_quote') return J({ eligible: false, active: false, rate: 0, cap: 0, birthMult: null, cakeCategories: [] })
  throw new Error(`fetch ที่ไม่ได้จำลอง: ${req.method} ${url}`)
}) as typeof fetch

await import('../../../functions/order-create/index.ts')

// ---------- ฝั่งแอป ----------
// ไคลเอนต์ supabase จำลองเท่าที่ pushOrders ใช้กับออร์เดอร์ใหม่ (functions.invoke)
// โหมดทดสอบใส่หัวเดียวกับที่ src/lib/supabase.js ใส่ (global.headers[TEST_HEADER] = 'test')
// ช่องคิวรอตรวจของผู้จัดการ (punpang_sync_review): ออร์เดอร์ใหม่ที่ระบบปฏิเสธถาวรเข้าคิวที่นี่
let reviews: any[] = []
const appClient = (token: string | null, test: boolean) => ({
  from: (table: string) => ({
    insert: async (row: any) => {
      if (table !== 'punpang_sync_review') throw new Error(`ไม่มีตาราง ${table} ในชุดทดสอบนี้`)
      reviews.push(row)
      return { error: null }
    },
  }),
  functions: {
    invoke: async (name: string, { body }: { body: unknown }) => {
      const headers: Record<string, string> = { 'content-type': 'application/json' }
      if (token) headers.authorization = `Bearer ${token}`
      if (test) headers[TEST_HEADER] = 'test'
      const res = await handler(new Request(`http://fn.fake/functions/v1/${name}`, { method: 'POST', headers, body: JSON.stringify(body) }))
      if (res.ok) return { data: await res.json(), error: null }
      return { data: null, error: { message: 'Edge Function returned a non-2xx status code', context: res } }
    },
  },
})
// ตัวออกเลขแบบเดียวกับแอป (src/data/store.js: decorate = docCode(code, testModeOn()))
const numberingFor = (test: boolean) => createNumbering({ decorate: (code: string) => docCode(code, test) })
let seq = 0
// ออร์เดอร์ใหม่หน้าตาแบบที่แอปสร้าง (รายการจากเคสอ้างอิงที่มีราคาแน่นอน)
const newOrder = (code: string) => ({
  id: `o_flow_${++seq}`, code, customerId: ref.customerId ?? 'golden-cust', fulfillment: ref.draft.fulfillment, pickupAt: ref.draft.pickupAt,
  birthday: ref.draft.birthday, items: structuredClone(ref.draft.items), status: 'awaiting_payment', history: [{ at: '', text: '', by: 'ทดสอบ' }], payments: [],
})
const reset = () => { rows = []; reads = []; catalogReads.length = 0; deletedCustomers.clear(); reviews = [] }
// เวลาเซิร์ฟเวอร์ = เวลาของชุดข้อมูลอ้างอิง (วันนัดในเคสจะไม่กลายเป็นอดีตเมื่อเวลาผ่านไป)
const realNow = Date.now
Date.now = () => (golden as any).nowMs
addEventListener('unload', () => { Date.now = realNow })

Deno.test('โหมดทดสอบ: เลขที่แอปออก (TEST-OR-…) บันทึกผ่าน และเขียนลงสคีมาทดสอบเท่านั้น', async () => {
  reset()
  const numbering = numberingFor(true)
  const o = newOrder(numbering.next('OR'))
  assert(o.code.startsWith('TEST-OR-'), o.code)
  const r = await pushOrders(appClient('tok-staff', true), { upserts: [o] }, { numbering })
  assertEquals(r, { ok: true })
  assertEquals(rows.length, 1)
  assertEquals([rows[0].schema, rows[0].code], ['punpang_test', o.code])
  assertEquals(reads, [{ table: 'punpang_customers', schema: 'punpang_test' }])
  // แคตาล็อกในโหมดทดสอบอ่านจากสำเนาทดสอบเท่านั้น (ไม่แตะแคตาล็อกจริง)
  assert(catalogReads.length > 0 && catalogReads.every((c) => c.schema === 'punpang_test'), JSON.stringify(catalogReads))
})

Deno.test('โหมดจริง: เลข OR-… บันทึกผ่าน และเขียนลงสคีมาจริง', async () => {
  reset()
  const numbering = numberingFor(false)
  const o = newOrder(numbering.next('OR'))
  assert(/^OR-\d{6}-\d{6}$/.test(o.code), o.code)
  const r = await pushOrders(appClient('tok-staff', false), { upserts: [o] }, { numbering })
  assertEquals(r, { ok: true })
  assertEquals([rows[0].schema, rows[0].code], ['public', o.code])
  assert(catalogReads.length > 0 && catalogReads.every((c) => c.schema === 'public'), JSON.stringify(catalogReads))
})

Deno.test('ข้ามโหมด: เลขทดสอบส่งเข้าโหมดจริง และเลขจริงส่งเข้าโหมดทดสอบ → ถูกปฏิเสธ ไม่มีอะไรถูกเขียน', async () => {
  reset()
  const testCode = newOrder(numberingFor(true).next('OR'))
  const r1: any = await pushOrders(appClient('tok-staff', false), { upserts: [testCode] })
  assertEquals(r1.error, undefined) // การปฏิเสธถาวรไม่คืน error (ไม่บล็อกชุด) · ออร์เดอร์ใหม่ที่ถูกปฏิเสธเข้าคิวผู้จัดการ
  assertEquals(r1.queued?.length, 1)
  assertStringIncludes(reviews[0]?.reason_message ?? '', 'รหัสหรือเลขออร์เดอร์ไม่ถูกต้อง')
  const liveCode = newOrder(numberingFor(false).next('OR'))
  const r2: any = await pushOrders(appClient('tok-staff', true), { upserts: [liveCode] })
  assertEquals(r2.error, undefined)
  assertEquals(r2.queued?.length, 1)
  assertStringIncludes(reviews[1]?.reason_message ?? '', 'รหัสหรือเลขออร์เดอร์ไม่ถูกต้อง')
  assertEquals(rows.length, 0)
})

Deno.test('ราคา: ราคาที่เครื่องส่งมาถูกทิ้ง เซิร์ฟเวอร์คิดใหม่จากแคตาล็อก และแอปรับค่าที่บันทึกจริงกลับมา', async () => {
  reset()
  const numbering = numberingFor(true)
  const o: any = newOrder(numbering.next('OR'))
  for (const it of o.items) { it.price = 1; it.total = 1; it.net = 1 }
  const r = await pushOrders(appClient('tok-staff', true), { upserts: [o] }, { numbering })
  assertEquals(r, { ok: true })
  assertEquals(rows[0].data.items, ref.payload.items)
  assertEquals(o.items, ref.payload.items)
})

Deno.test('สิทธิ์: ไม่ได้ล็อกอิน หรือบทบาทไม่มีสิทธิ์สร้างออร์เดอร์ → ถูกปฏิเสธ ไม่มีอะไรถูกเขียน', async () => {
  reset()
  const numbering = numberingFor(true)
  const r1: any = await pushOrders(appClient(null, true), { upserts: [newOrder(numbering.next('OR'))] })
  assertStringIncludes(r1.error, 'ต้องเข้าสู่ระบบพนักงาน')
  const r2: any = await pushOrders(appClient('tok-chat', true), { upserts: [newOrder(numbering.next('OR'))] })
  assertEquals(r2.error, undefined)
  assertEquals(r2.queued?.length, 1)
  assertStringIncludes(reviews.at(-1)?.reason_message ?? '', 'บทบาทนี้สร้างออร์เดอร์ไม่ได้')
  assertEquals(rows.length, 0)
})

Deno.test('เลขซ้ำในโหมดทดสอบ: แอปออกเลขใหม่ (ยังมี TEST-) แล้วบันทึกผ่าน', async () => {
  reset()
  const numbering = numberingFor(true)
  const o = newOrder(numbering.next('OR'))
  const taken = o.code
  rows.push({ schema: 'punpang_test', id: 'o_other', code: taken })
  const recoded: string[] = []
  const r = await pushOrders(appClient('tok-staff', true), { upserts: [o] }, { numbering, onRecode: (_o: unknown, c: string) => recoded.push(c) })
  assertEquals(r, { ok: true })
  assertEquals(recoded.length, 1)
  assert(recoded[0].startsWith('TEST-OR-') && recoded[0] !== taken, recoded[0])
  assertEquals(rows.at(-1)?.code, recoded[0])
})

Deno.test('ลูกค้าที่ถูกลบแล้ว: ออร์เดอร์ถูกปฏิเสธ (ไม่พบลูกค้า) และไม่มีอะไรถูกเขียน', async () => {
  reset()
  const numbering = numberingFor(false)
  const o = newOrder(numbering.next('OR'))
  deletedCustomers.add(o.customerId)
  const r: any = await pushOrders(appClient('tok-staff', false), { upserts: [o] }, { numbering })
  assertEquals(r.error, undefined)
  assertEquals(r.queued?.length, 1)
  assertStringIncludes(reviews[0]?.reason_message ?? '', 'ไม่พบลูกค้า')
  assertEquals(rows.length, 0)
})

Deno.test('บริการเกี่ยวกับเงิน: เซิร์ฟเวอร์คิดค่าบริการและเงินพักจากการตั้งค่าและธนบัตร (ยอดที่เครื่องส่งมาถูกทิ้ง)', async () => {
  reset()
  const prevShop = cat.shop
  cat.shop = { ...cat.shop, cashService: { maxNotes: 5, services: { hide: { fee: 50, show: true }, pull: { fee: 40, show: false }, stash: { fee: 30, show: false } } } }
  try {
    const numbering = numberingFor(true)
    const o: any = newOrder(numbering.next('OR'))
    // เครื่องส่งยอดและราคาปลอมมา: เซิร์ฟเวอร์ต้องคิดเงินพักจาก 1,000 บาท (ธนบัตร) และค่าบริการ 50 บาท (การตั้งค่า)
    o.holdMoney = { kind: 'hide', notes: { 1000: 1 }, amount: 1 }
    o.items = [...o.items, { id: 'svc-hide', kind: 'service', serviceKind: 'hide', name: 'ซ่อนเงิน', qty: 1, unitPrice: 1, regularPrice: 1, fullPrice: 1, mods: [], discounts: [], specials: [], bundles: [], noPoints: true }]
    const r = await pushOrders(appClient('tok-staff', true), { upserts: [o] }, { numbering })
    assertEquals(r, { ok: true })
    const row: any = rows.at(-1)
    assertEquals(row.data.holdMoney.amount, 1000)
    const svcs = row.data.items.filter((i: any) => i.kind === 'service')
    assertEquals(svcs.length, 1)
    assertEquals(svcs[0].unitPrice, 50)
  } finally {
    cat.shop = prevShop
  }
})

Deno.test('บริการเกี่ยวกับเงิน: รายการ kind service ที่ส่งมาจากเครื่องโดยตรงถูกปฏิเสธ และไม่มีอะไรถูกเขียน', async () => {
  reset()
  const numbering = numberingFor(true)
  const o: any = newOrder(numbering.next('OR'))
  const res = await handler(new Request('http://fn.fake/functions/v1/order-create', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer tok-staff', [TEST_HEADER]: 'test' },
    body: JSON.stringify({ id: o.id, code: o.code, asDraft: false, by: 'ทดสอบ', draft: { customerId: o.customerId, fulfillment: o.fulfillment, pickupAt: o.pickupAt, birthday: null, items: [...o.items, { id: 'fake', kind: 'service', unitPrice: 1, qty: 1, name: 'ปลอม' }] } }),
  }))
  assertEquals(res.ok, false)
  assertEquals(rows.length, 0)
})
