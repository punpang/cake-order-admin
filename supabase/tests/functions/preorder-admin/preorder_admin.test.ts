// ทดสอบ preorder-admin (ฝั่งร้านของสั่งล่วงหน้า): เฉพาะพนักงานที่มีสิทธิ์ · รายการแสดงข้อมูลพนักงานโดยไม่ส่งข้อมูลลูกค้าอื่น ·
// การกระทำเรียกฟังก์ชันฐานข้อมูลถูกต้อง และข้อผิดพลาดของฐานข้อมูลแปลงเป็น 409
// รัน: deno test -A --no-lock --node-modules-dir=none --unstable-sloppy-imports --import-map=supabase/tests/functions/_fake/importmap.json supabase/tests/functions/preorder-admin/
import { assertEquals, assert } from 'jsr:@std/assert@1'

let handler: (r: Request) => Promise<Response> = null as any
;(Deno as any).serve = (h: any) => { handler = h; return { finished: Promise.resolve(), shutdown: async () => {} } }
Deno.env.set('SUPABASE_URL', 'http://db.fake')
Deno.env.set('SUPABASE_ANON_KEY', 'anon')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service')
await import('../../../functions/preorder-admin/index.ts')

const ORDER = 'e'.repeat(32)
const call = async (body: unknown, token = 'tok-mgr') => {
  const r = await handler(new Request('http://x', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }))
  return { status: r.status, body: await r.json() }
}
function seed() {
  ;(globalThis as any).__RPC = {}
  ;(globalThis as any).__RPC_CALLS = []
  ;(globalThis as any).__DB = {
    users: { 'tok-mgr': 'u-mgr', 'tok-pre': 'u-pre', 'tok-chat': 'u-chat', 'tok-acct': 'u-acct' },
    t: {
      'public.punpang_staff': [
        { user_id: 'u-mgr', active: true, perms: ['manage'] },
        { user_id: 'u-pre', active: true, perms: ['managePreorder'] },
        { user_id: 'u-chat', active: true, perms: ['chat'] },
        { user_id: 'u-acct', active: true, perms: ['acctView'] },
      ],
      'public.punpang_preorder_orders': [
        { id: ORDER, code: 'PRE-241124-000009', status: 'payment_confirmed', pickup_date: '2099-12-24', customer_id: 'cA', updated_at: 't2', data: {
          fulfillment: 'delivery', total: 100, shippingFee: 20,
          payments: [{ id: 'p1', amount: 80, status: 'confirmed', method: 'cash' }, { id: 'p2', amount: 20, status: 'reported', qrRef: 'PRE241124000002ABCDE' }],
        } },
        { id: 'f'.repeat(32), code: 'PRE-241124-000010', status: 'awaiting_payment', pickup_date: '2099-12-24', customer_id: 'cB', updated_at: 't1', data: { total: 50 } },
      ],
      'public.punpang_customers': [{ id: 'cA', name: 'สมชาย' }, { id: 'cB', name: 'คนอื่น' }],
    },
  }
}

Deno.test('ไม่มีโทเค็น → 401 · ไม่มีสิทธิ์สั่งล่วงหน้า → 403', async () => {
  seed()
  assertEquals((await call({ action: 'list' }, '')).status, 401)
  assertEquals((await call({ action: 'list' }, 'tok-chat')).status, 403)
})

Deno.test('list: ผู้มีสิทธิ์ managePreorder เห็นรายการ แสดงยอดที่ชำระและคำขอ QR ที่รอยืนยันของออร์เดอร์', async () => {
  seed()
  const r = await call({ action: 'list' }, 'tok-pre')
  assertEquals(r.status, 200)
  const o = r.body.orders.find((x: any) => x.id === ORDER)
  assertEquals(o.paid, 80)
  assertEquals(o.customerName, 'สมชาย')
  assertEquals(o.pendingCash.length, 1)
  assertEquals(o.shippingFee, 20)
})

Deno.test('set_shipping ส่งพารามิเตอร์ไปฐานข้อมูลและแปลงข้อผิดพลาดเป็น 409', async () => {
  seed()
  ;(globalThis as any).__RPC.punpang_preorder_set_shipping = async (args: any) => { (globalThis as any).__RPC_CALLS.push(args); return { data: { ok: true, status: 'shipped' }, error: null } }
  const ok = await call({ action: 'set_shipping', orderId: ORDER, carrier: 'Kerry', trackingNo: 'TH-1' })
  assertEquals(ok.status, 200)
  assertEquals((globalThis as any).__RPC_CALLS[0], { p_order: ORDER, p_carrier: 'Kerry', p_tracking: 'TH-1', p_postage: 0 })
  await call({ action: 'set_shipping', orderId: ORDER, carrier: 'Kerry', trackingNo: 'TH-1', postage: '45.5' })
  assertEquals((globalThis as any).__RPC_CALLS[1].p_postage, 45.5)
  ;(globalThis as any).__RPC.punpang_preorder_set_shipping = async () => ({ data: { error: 'balance_due' }, error: null })
  assertEquals((await call({ action: 'set_shipping', orderId: ORDER, carrier: 'Kerry', trackingNo: 'TH-1' })).status, 409)
})

Deno.test('extend ส่งวันใหม่ไปฐานข้อมูล และแปลง past_last เป็นข้อความไทย 409', async () => {
  seed()
  const newDue = '2099-06-30T16:59:59.000Z'
  ;(globalThis as any).__RPC.punpang_preorder_extend = async (args: any) => { (globalThis as any).__RPC_CALLS.push(args); return { data: { ok: true, status: 'awaiting_payment' }, error: null } }
  const ok = await call({ action: 'extend', orderId: ORDER, newDue })
  assertEquals(ok.status, 200)
  assertEquals((globalThis as any).__RPC_CALLS[0], { p_order: ORDER, p_new_due: newDue })
  ;(globalThis as any).__RPC.punpang_preorder_extend = async () => ({ data: { error: 'past_last' }, error: null })
  const bad = await call({ action: 'extend', orderId: ORDER, newDue: '2099-07-01T00:00:00.000Z' })
  assertEquals(bad.status, 409)
  assertEquals(bad.body.error, 'ขยายเวลาเกินวันชำระสุดท้ายของแคมเปญไม่ได้')
})

Deno.test('reports: ไม่มีสิทธิ์ 403 · รายงานไม่รู้จัก 400', async () => {
  seed()
  assertEquals((await call({ action: 'reports', report: 'prep' }, 'tok-chat')).status, 403)
  assertEquals((await call({ action: 'reports', report: 'nope' })).status, 400)
})

Deno.test('reports prep: รวมจำนวนสินค้าต่อวันรับ และไม่นับออร์เดอร์ที่ยกเลิก', async () => {
  seed()
  const rows = (globalThis as any).__DB.t['public.punpang_preorder_orders']
  rows.push({ id: 'a'.repeat(32), code: 'PRE-241124-000021', status: 'payment_confirmed', pickup_date: '2099-12-25', customer_id: 'cA', updated_at: 't3', data: { fulfillment: 'pickup', total: 100, lines: [{ retailId: 'rt1', qty: 2 }], payments: [{ id: 'p9', amount: 100, status: 'confirmed' }] } })
  rows.push({ id: 'b'.repeat(32), code: 'PRE-241124-000022', status: 'cancelled', pickup_date: '2099-12-25', customer_id: 'cA', updated_at: 't4', data: { fulfillment: 'pickup', total: 100, lines: [{ retailId: 'rt1', qty: 9 }] } })
  const r = await call({ action: 'reports', report: 'prep' })
  assertEquals(r.status, 200)
  const day = r.body.data.find((d: any) => d.pickupDate === '2099-12-25')
  assertEquals(day.items, [{ retailId: 'rt1', name: 'rt1', qty: 2 }])
  assertEquals(day.orderCount, 1)
  assertEquals(day.paidCount, 1)
})

Deno.test('reports exceptions: แสดงออร์เดอร์ยกเลิกพร้อมเหตุผล', async () => {
  seed()
  ;(globalThis as any).__DB.t['public.punpang_preorder_orders'].push({ id: 'c'.repeat(32), code: 'PRE-241124-000023', status: 'cancelled', pickup_date: '2099-12-26', customer_id: 'cB', updated_at: 't5', data: {} })
  const r = await call({ action: 'reports', report: 'exceptions' })
  assertEquals(r.status, 200)
  assert(r.body.data.some((x: any) => x.code === 'PRE-241124-000023' && x.reason === 'ยกเลิกแล้ว'))
})

Deno.test('refund_return และ reship ส่งรายการคืนและค่าส่งใหม่ไปฐานข้อมูล', async () => {
  seed()
  ;(globalThis as any).__RPC.punpang_preorder_refund_return = async (args: any) => { (globalThis as any).__RPC_CALLS.push(args); return { data: { ok: true }, error: null } }
  ;(globalThis as any).__RPC.punpang_preorder_reship = async (args: any) => { (globalThis as any).__RPC_CALLS.push(args); return { data: { ok: true }, error: null } }
  await call({ action: 'refund_return', orderId: ORDER, refunds: [{ amount: 60, method: 'bank' }] })
  await call({ action: 'reship', orderId: ORDER, newFee: 35 })
  assertEquals((globalThis as any).__RPC_CALLS[0], { p_order: ORDER, p_refunds: [{ amount: 60, method: 'bank' }] })
  assertEquals((globalThis as any).__RPC_CALLS[1], { p_order: ORDER, p_new_fee: 35 })
})

Deno.test('รหัสออร์เดอร์ไม่ถูกต้อง → 400 · คำสั่งไม่รู้จัก → 400', async () => {
  seed()
  assertEquals((await call({ action: 'mark_delivered', orderId: 'bad' }, 'tok-pre')).status, 400)
  assertEquals((await call({ action: 'nope', orderId: ORDER }, 'tok-pre')).status, 400)
})

Deno.test('accounting: ข้อมูลดิบทุกออเดอร์ (รวมที่ไม่มีคำขอ) ส่งเฉพาะฟิลด์ที่บัญชีใช้ และไม่แสดงชื่อลูกค้า', async () => {
  seed()
  const r = await call({ action: 'accounting' }, 'tok-pre')
  assertEquals(r.status, 200)
  assertEquals(r.body.orders.length, 2)
  const o = r.body.orders.find((x: any) => x.id === ORDER)
  assertEquals(o.code, 'PRE-241124-000009')
  assertEquals(o.status, 'payment_confirmed')
  assertEquals(o.total, 100)
  assertEquals(o.payments.length, 2)
  assert(!JSON.stringify(r.body).includes('สมชาย'), 'ต้องไม่รั่วชื่อลูกค้า')
})

Deno.test('accounting: ไม่มีสิทธิ์ → 403 · ผู้ดูบัญชีอ่านได้ แต่การกระทำอื่นไม่ได้', async () => {
  seed()
  assertEquals((await call({ action: 'accounting' }, 'tok-chat')).status, 403)
  assertEquals((await call({ action: 'accounting' }, 'tok-acct')).status, 200)
  assertEquals((await call({ action: 'cancel', orderId: ORDER, refunds: [] }, 'tok-acct')).status, 403)
})

Deno.test('mark_ready: แคมเปญโหมดรอบ → บันทึกเวลาเตรียมเสร็จ · แคมเปญโหมดวัน → 409', async () => {
  seed()
  const T = (globalThis as any).__DB.t
  T['public.punpang_preorder_campaigns'] = [
    { id: 'cR', status: 'open', data: { pickupMode: 'slot', rounds: [{ time: '10:00', cap: 2 }] } },
    { id: 'cD', status: 'open', data: { pickupMode: 'day' } },
  ]
  const rid = '9'.repeat(32)
  T['public.punpang_preorder_orders'].push({ id: rid, code: 'PRE-R-1', status: 'payment_confirmed', campaign_id: 'cR', pickup_date: '2099-12-24', customer_id: 'cA', updated_at: 't9', data: { total: 100, paid: 100, pickupRound: '10:00' } })
  const did = '8'.repeat(32)
  T['public.punpang_preorder_orders'].push({ id: did, code: 'PRE-D-1', status: 'payment_confirmed', campaign_id: 'cD', pickup_date: '2099-12-24', customer_id: 'cA', updated_at: 't8', data: { total: 100, paid: 100 } })
  const ok = await call({ action: 'mark_ready', orderId: rid })
  assertEquals(ok.status, 200)
  const saved = T['public.punpang_preorder_orders'].find((x: any) => x.id === rid)
  assert(typeof saved.data.readyAt === 'string')
  assertEquals((await call({ action: 'mark_ready', orderId: did })).status, 409)
})

const CUST_A = '11111111-1111-4111-8111-111111111111'
const CUST_B = '22222222-2222-4222-8222-222222222222'
Deno.test('customerOrders: ไม่มีสิทธิ์ 403 · รหัสลูกค้าไม่ถูกต้อง 400', async () => {
  seed()
  assertEquals((await call({ action: 'customerOrders', customerId: CUST_A }, 'tok-chat')).status, 403)
  assertEquals((await call({ action: 'customerOrders', customerId: 'bad id!' })).status, 400)
  assertEquals((await call({ action: 'customerOrders', customerId: 'x'.repeat(65) })).status, 400)
})

Deno.test('customerOrders: คืนเฉพาะออร์เดอร์ของลูกค้าที่ขอ และไม่คืนออร์เดอร์ที่ยกเลิก', async () => {
  seed()
  const rows = (globalThis as any).__DB.t['public.punpang_preorder_orders']
  rows.push({ id: 'a'.repeat(32), code: 'PRE-A-1', status: 'awaiting_payment', pickup_date: '2099-12-24', customer_id: CUST_A, updated_at: 't9', data: { total: 100, payDueAt: '2099-12-01T10:00:00Z', payments: [{ id: 'p', amount: 30, status: 'confirmed' }] } })
  rows.push({ id: 'b'.repeat(32), code: 'PRE-A-2', status: 'cancelled', pickup_date: '2099-12-24', customer_id: CUST_A, updated_at: 't8', data: { total: 50 } })
  rows.push({ id: 'c'.repeat(32), code: 'PRE-B-1', status: 'awaiting_payment', pickup_date: '2099-12-24', customer_id: CUST_B, updated_at: 't7', data: { total: 70 } })
  const r = await call({ action: 'customerOrders', customerId: CUST_A })
  assertEquals(r.status, 200)
  assertEquals(r.body.data.map((x: any) => x.code), ['PRE-A-1'])
  assertEquals(r.body.data[0].due, 70)
  assertEquals(Object.keys(r.body.data[0]).sort(), ['code', 'due', 'id', 'payDueAt', 'pickupDate', 'status'])
})

Deno.test('list: แสดงรอบเวลาและเวลาเตรียมเสร็จของออเดอร์', async () => {
  seed()
  const rid = '7'.repeat(32)
  ;(globalThis as any).__DB.t['public.punpang_preorder_orders'].push({ id: rid, code: 'PRE-R-7', status: 'payment_confirmed', pickup_date: '2099-12-24', customer_id: 'cA', updated_at: 't7', data: { total: 100, paid: 100, pickupRound: '13:00', readyAt: '2099-12-24T06:00:00Z' } })
  const r = await call({ action: 'list' })
  const o = r.body.orders.find((x: any) => x.id === rid)
  assertEquals(o.pickupRound, '13:00')
  assertEquals(o.readyAt, '2099-12-24T06:00:00Z')
})

Deno.test('mark_delivered: ส่งมอบแล้วให้แต้มต่อ · ให้แต้มล้มเหลว → 500 เพื่อให้ลองใหม่ได้', async () => {
  seed()
  ;(globalThis as any).__RPC.punpang_preorder_mark_delivered = async (args: any) => { (globalThis as any).__RPC_CALLS.push(['mark', args]); return { data: { ok: true }, error: null } }
  ;(globalThis as any).__RPC.punpang_preorder_award_delivery = async (args: any) => { (globalThis as any).__RPC_CALLS.push(['award', args]); return { data: { ok: true, points: 5, spins: 1 }, error: null } }
  const r = await call({ action: 'mark_delivered', orderId: ORDER }, 'tok-pre')
  assertEquals(r.status, 200)
  assertEquals((globalThis as any).__RPC_CALLS.map((c: any) => c[0]), ['mark', 'award'])
  ;(globalThis as any).__RPC.punpang_preorder_award_delivery = async () => ({ data: null, error: { message: 'x' } })
  const r2 = await call({ action: 'mark_delivered', orderId: ORDER }, 'tok-pre')
  assertEquals(r2.status, 500)
})
