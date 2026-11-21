// ทดสอบเส้นทาง "ส่งใบเสนอ → ลูกค้ายืนยัน → แปลงเป็นออร์เดอร์" ครบทาง ทั้งโหมดจริงและโหมดทดสอบ
// ฝั่งแอปตัวจริง (createQuoteRemote · ตัวออกเลข · pushOrders) → Edge Function quote-create และ order-create ตัวจริง · จำลองเฉพาะฐานข้อมูล
// รัน (ทุกชุด): npm run test:fn · หรือ deno test -A --no-lock --node-modules-dir=none --unstable-sloppy-imports --import-map=supabase/tests/functions/_fake/importmap.json supabase/tests/functions/flows/
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import golden from '../../../../src/lib/quotePrice.golden.json' with { type: 'json' }
import { createQuoteRemote } from '../../../../src/lib/quoteRemote.js'
import { pushOrders as pushOrdersJs } from '../../../../src/lib/ordersSync.js'
import { createNumbering } from '../../../../src/lib/docNo.js'
import { docCode } from '../../../../src/lib/testMode.js'
import { appClient, installFakeRest, loadHandler, seedCatalog } from '../_fake/rest.ts'
// ช่องคิวรอตรวจของผู้จัดการ (punpang_sync_review): ออร์เดอร์ใหม่ที่ระบบปฏิเสธถาวรเข้าคิวที่นี่
const reviews: any[] = []
const withReviewQueue = (c: any) => ({ ...c, from: (table: string) => ({ insert: async (row: any) => { if (table !== 'punpang_sync_review') throw new Error(`ไม่มีตาราง ${table} ในชุดทดสอบนี้`); reviews.push(row); return { error: null } } }) })

const pushOrders = pushOrdersJs as any // ชนิดอนุมานจากค่าเริ่มต้นในไฟล์ JS
Deno.env.set('SUPABASE_URL', 'http://db.fake')
Deno.env.set('SUPABASE_ANON_KEY', 'anon')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service')
const fake = installFakeRest({
  users: { 'tok-staff': 'u-staff' },
  staff: { 'u-staff': { user_id: 'u-staff', active: true, perms: ['chat', 'createOrder'] } },
})
const handlers = {
  'quote-create': await loadHandler('../../../functions/quote-create/index.ts'),
  'order-create': await loadHandler('../../../functions/order-create/index.ts'),
}
const ref: any = (golden as any).cases.find((c: any) => c.payload && c.payload.items?.length)
const CUST = ref.customerId ?? 'golden-cust'
Date.now = () => (golden as any).nowMs // วันนัดในเคสอ้างอิงไม่กลายเป็นอดีต

const schemaOf = (test: boolean) => (test ? 'punpang_test' : 'public')
function setup(test: boolean) {
  fake.reset()
  reviews.length = 0
  seedCatalog(fake, (golden as any).catalog)
  // สำเนาทดสอบมีแคตาล็อกชุดเดียวกับจริง (การซิงก์คัดลอกค่าตั้งค่าและสินค้า) · ใบเสนอในโหมดทดสอบคิดราคาจากสำเนานี้
  fake.t['punpang_test.punpang_kv'] = structuredClone(fake.t['public.punpang_kv'])
  fake.t['punpang_test.punpang_items'] = structuredClone(fake.t['public.punpang_items'])
  fake.t[`${schemaOf(test)}.punpang_chats`] = [{ id: 'ch1', customer_id: CUST }, { id: 'ch2', customer_id: 'other-cust' }]
  fake.t[`${schemaOf(test)}.punpang_customers`] = [{ id: CUST, deleted: false }]
}
// ลูกค้ากดยืนยันบน Messenger: fb-webhook ตั้งสถานะใบเสนอเป็น customer_ok
const confirm = (test: boolean, id: string) => { fake.t[`${schemaOf(test)}.punpang_quotes`].find((q) => q.id === id).status = 'customer_ok' }
// แอปแปลงใบเสนอเป็นออร์เดอร์แบบเดียวกับ quoteToOrder (src/data/store.js): รายการ/ราคาจากใบเสนอ + quoteId
let seq = 0
const orderFromQuote = (q: any, code: string, chatId = q.chatId) => ({
  ...structuredClone(q.payload), id: `o_q_${++seq}`, code, customerId: q.customerId, chatId, quoteId: q.id,
  status: 'awaiting_payment', history: [{ at: '', text: '', by: 'ทดสอบ' }], payments: [],
})

for (const test of [true, false]) {
  const label = test ? 'โหมดทดสอบ' : 'โหมดจริง'
  const numbering = createNumbering({ decorate: (c: string) => docCode(c, test) })
  const client = () => withReviewQueue(appClient(handlers, 'tok-staff', test))

  Deno.test(`${label}: ส่งใบเสนอ → ลูกค้ายืนยัน → แปลงเป็นออร์เดอร์ ผ่านครบ และอยู่ในสคีมาเดียวกันทั้งเส้นทาง`, async () => {
    setup(test)
    const r = await createQuoteRemote(client(), 'ch1', structuredClone(ref.draft))
    assert(r.quote, r.error)
    assertEquals(r.quote.code.startsWith(test ? 'TEST-QT-' : 'QT-'), true, r.quote.code)
    assertEquals(r.quote.payload.items, ref.payload.items) // ราคาคิดที่เซิร์ฟเวอร์
    confirm(test, r.quote.id)
    const o = orderFromQuote(r.quote, numbering.next('OR'))
    const p = await pushOrders(client(), { upserts: [o] }, { numbering })
    assertEquals(p, { ok: true })
    const saved = fake.t[`${schemaOf(test)}.punpang_orders`]
    assertEquals(saved.length, 1)
    assertEquals(saved[0].data.quoteId, r.quote.id)
    assertEquals(saved[0].data.items, r.quote.payload.items)
    // ทุกคำขอไปฐานข้อมูล (ยกเว้นอ่านแคตาล็อกและสิทธิ์พนักงานที่ใช้ร่วมกัน) อยู่ในสคีมาของโหมดนั้น
    const off = fake.calls.filter((c) => !/punpang_(kv|items|staff)$/.test(c.path) && c.path !== '/auth/v1/user' && c.schema !== schemaOf(test))
    assertEquals(off, [])
  })

  Deno.test(`${label}: ใบเสนอที่ลูกค้ายังไม่ยืนยัน → แปลงไม่ได้`, async () => {
    setup(test)
    const r = await createQuoteRemote(client(), 'ch1', structuredClone(ref.draft))
    const p = await pushOrders(client(), { upserts: [orderFromQuote(r.quote, numbering.next('OR'))] }, { numbering })
    assertEquals(p.error, undefined) // การปฏิเสธถาวรไม่คืน error (ไม่บล็อกชุด) · ออร์เดอร์ใหม่ที่ถูกปฏิเสธเข้าคิวผู้จัดการ
    assertEquals(p.queued?.length, 1)
    assertStringIncludes(reviews[0]?.reason_message ?? '', 'ยังไม่พร้อมแปลงเป็นออร์เดอร์')
    assertEquals(fake.t[`${schemaOf(test)}.punpang_orders`] ?? [], [])
  })

  Deno.test(`${label}: แปลงใบเสนอเดียวกันเป็นออร์เดอร์ที่สอง → ถูกปฏิเสธ และมีออร์เดอร์เดียว`, async () => {
    setup(test)
    const r = await createQuoteRemote(client(), 'ch1', structuredClone(ref.draft))
    confirm(test, r.quote.id)
    assertEquals(await pushOrders(client(), { upserts: [orderFromQuote(r.quote, numbering.next('OR'))] }, { numbering }), { ok: true })
    // ออร์เดอร์ที่สองจากใบเดิม (เช่น สองแท็บ/สองเครื่องแปลงพร้อมกัน หรือกดแปลงซ้ำก่อนผูกใบเสนอ)
    const p = await pushOrders(client(), { upserts: [orderFromQuote(r.quote, numbering.next('OR'))] }, { numbering })
    assertEquals(p.error, undefined)
    assertEquals(p.queued?.length, 1)
    assertStringIncludes(reviews[0]?.reason_message ?? '', 'ถูกแปลงเป็นออร์เดอร์แล้ว')
    assertEquals(fake.t[`${schemaOf(test)}.punpang_orders`].length, 1)
  })

  Deno.test(`${label}: แก้ราคาในออร์เดอร์ที่มาจากใบเสนอ → เซิร์ฟเวอร์ใช้ราคาตามใบเสนอ`, async () => {
    setup(test)
    const r = await createQuoteRemote(client(), 'ch1', structuredClone(ref.draft))
    confirm(test, r.quote.id)
    const o: any = orderFromQuote(r.quote, numbering.next('OR'))
    for (const it of o.items) { it.price = 1; it.total = 1; it.net = 1 }
    assertEquals(await pushOrders(client(), { upserts: [o] }, { numbering }), { ok: true })
    assertEquals(fake.t[`${schemaOf(test)}.punpang_orders`][0].data.items, r.quote.payload.items)
  })

  Deno.test(`${label}: ใช้ใบเสนอของแชทอื่น → ถูกปฏิเสธ`, async () => {
    setup(test)
    const r = await createQuoteRemote(client(), 'ch1', structuredClone(ref.draft))
    confirm(test, r.quote.id)
    const p = await pushOrders(client(), { upserts: [orderFromQuote(r.quote, numbering.next('OR'), 'ch2')] }, { numbering })
    assertEquals(p.error, undefined)
    assertEquals(p.queued?.length, 1)
    assertStringIncludes(reviews[0]?.reason_message ?? '', 'ไม่ใช่ของแชทนี้')
  })
}

Deno.test('ใบเสนอใหม่ในแชทเดียวกัน → ใบเดิมที่รอยืนยันถูกแทนที่ (superseded)', async () => {
  setup(true)
  const a = await createQuoteRemote(appClient(handlers, 'tok-staff', true), 'ch1', structuredClone(ref.draft))
  const b = await createQuoteRemote(appClient(handlers, 'tok-staff', true), 'ch1', structuredClone(ref.draft))
  const qs = fake.t['punpang_test.punpang_quotes']
  assertEquals(qs.find((q) => q.id === a.quote.id).status, 'superseded')
  assertEquals(qs.find((q) => q.id === b.quote.id).status, 'pending')
  assert(a.quote.code !== b.quote.code)
})
