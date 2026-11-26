// ทดสอบ action issue_invoice ของ preorder-admin (ใบกำกับภาษีเต็มรูปของสั่งล่วงหน้า)
// รัน: deno test -A --no-lock --node-modules-dir=none --unstable-sloppy-imports --import-map=supabase/tests/functions/_fake/importmap.json supabase/tests/functions/preorder-admin/
import { assertEquals, assert } from 'jsr:@std/assert@1'

let handler: (r: Request) => Promise<Response> = null as any
;(Deno as any).serve = (h: any) => { handler = h; return { finished: Promise.resolve(), shutdown: async () => {} } }
Deno.env.set('SUPABASE_URL', 'http://db.fake')
Deno.env.set('SUPABASE_ANON_KEY', 'anon')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service')
await import('../../../functions/preorder-admin/index.ts')

const DELIVERED = 'd'.repeat(32)
// เลข 13 หลักที่ผ่าน checksum
const withCheck = (b: string) => { let s = 0; for (let i = 0; i < 12; i++) s += Number(b[i]) * (13 - i); return b + String((11 - (s % 11)) % 10) }
const TAX_SHOP = withCheck('010556700123')
const TAX_BUYER = withCheck('010553700001')
const BUYER = { name: 'บริษัท ทดสอบ จำกัด', taxId: TAX_BUYER, branch: '00000', address: '1 ถนนทดสอบ' }

const call = async (body: unknown, token = 'tok-mgr') => {
  const r = await handler(new Request('http://x', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  }))
  return { status: r.status, body: await r.json() }
}

function seed(orderOver: Record<string, unknown> = {}) {
  ;(globalThis as any).__RPC = {}
  ;(globalThis as any).__RPC_CALLS = []
  ;(globalThis as any).__DB = {
    users: { 'tok-mgr': 'u-mgr', 'tok-chat': 'u-chat' },
    t: {
      'public.punpang_staff': [
        { user_id: 'u-mgr', active: true, perms: ['managePreorder'] },
        { user_id: 'u-chat', active: true, perms: ['chat'] },
      ],
      'public.punpang_preorder_orders': [
        { id: DELIVERED, code: 'PRE-0001', status: 'delivered', pickup_date: '2099-12-24', customer_id: 'cA', updated_at: 't1', data: {
          fulfillment: 'pickup', total: 1070, vat: { rate: 7, mode: 'inclusive' },
          items: [{ name: 'เค้ก', unitPrice: 1070, qty: 1 }],
          payments: [{ id: 'p1', amount: 1070, status: 'confirmed', method: 'cash' }],
          ...orderOver,
        } },
      ],
      'public.punpang_acct_invoices': [],
      'public.punpang_kv': [
        { collection: 'config', id: 'shop', data: { v: { vat: { enabled: true, taxId: TAX_SHOP, legalName: 'บริษัท เค้กตัวอย่าง จำกัด', address: '88/12 ถนนสุขุมวิท 39', branch: '00000', rate: 7, mode: 'inclusive' } } } },
      ],
      'public.punpang_customers': [{ id: 'cA', name: 'สมชาย' }],
    },
  }
}

Deno.test('ส่งมอบแล้ว ชำระครบ → ออกใบได้ ส่งข้อมูลใบและผู้ออกไปฐานข้อมูล', async () => {
  seed()
  ;(globalThis as any).__RPC.punpang_preorder_issue_invoice = async (args: any) => { (globalThis as any).__RPC_CALLS.push(args); return { data: { no: 'INV-2569-00001' }, error: null } }
  const r = await call({ action: 'issue_invoice', orderId: DELIVERED, buyer: BUYER })
  assertEquals(r.status, 200)
  assertEquals(r.body.result.no, 'INV-2569-00001')
  const c = (globalThis as any).__RPC_CALLS[0]
  assertEquals(c.p_order, DELIVERED)
  assertEquals(c.p_inv_data.type, 'invoice')
  assertEquals(c.p_inv_data.buyer.taxId, TAX_BUYER)
  assertEquals(c.p_inv_data.by, 'staff:u-mgr')
  assertEquals(c.p_inv_data.total, 1070)
  assertEquals(c.p_inv_data.vat, 70)
  assert(c.p_inv_id.startsWith('pi'))
})

Deno.test('ยังไม่ส่งมอบ → 409 และไม่เรียกฐานข้อมูล', async () => {
  seed({})
  ;(globalThis as any).__DB.t['public.punpang_preorder_orders'][0].status = 'paid'
  ;(globalThis as any).__RPC.punpang_preorder_issue_invoice = async (args: any) => { (globalThis as any).__RPC_CALLS.push(args); return { data: null, error: null } }
  const r = await call({ action: 'issue_invoice', orderId: DELIVERED, buyer: BUYER })
  assertEquals(r.status, 409)
  assertEquals((globalThis as any).__RPC_CALLS.length, 0)
})

Deno.test('ข้อมูลผู้ซื้อไม่ถูกต้อง → 409 และไม่เรียกฐานข้อมูล', async () => {
  seed()
  ;(globalThis as any).__RPC.punpang_preorder_issue_invoice = async (args: any) => { (globalThis as any).__RPC_CALLS.push(args); return { data: null, error: null } }
  const r = await call({ action: 'issue_invoice', orderId: DELIVERED, buyer: { ...BUYER, taxId: '123' } })
  assertEquals(r.status, 409)
  assertEquals((globalThis as any).__RPC_CALLS.length, 0)
})

Deno.test('มีใบที่ยังไม่ถูกยกเลิกแล้ว → 409 (ออกซ้ำไม่ได้)', async () => {
  seed()
  ;(globalThis as any).__DB.t['public.punpang_acct_invoices'] = [{ id: 'ti0', order_id: DELIVERED, kind: 'invoice', no: 'INV-2569-00001', data: { type: 'invoice', no: 'INV-2569-00001' } }]
  const r = await call({ action: 'issue_invoice', orderId: DELIVERED, buyer: BUYER })
  assertEquals(r.status, 409)
})

Deno.test('ฐานข้อมูลปฏิเสธเพราะออกไปแล้ว (P0001) → 409 พร้อมข้อความ · ข้อผิดพลาดอื่น → 500', async () => {
  seed()
  ;(globalThis as any).__RPC.punpang_preorder_issue_invoice = async () => ({ data: null, error: { code: 'P0001', message: 'ออกใบกำกับภาษีของออร์เดอร์นี้แล้ว' } })
  const dup = await call({ action: 'issue_invoice', orderId: DELIVERED, buyer: BUYER })
  assertEquals(dup.status, 409)
  assertEquals(dup.body.error, 'ออกใบกำกับภาษีของออร์เดอร์นี้แล้ว')
  ;(globalThis as any).__RPC.punpang_preorder_issue_invoice = async () => ({ data: null, error: { code: 'XX000', message: 'boom' } })
  assertEquals((await call({ action: 'issue_invoice', orderId: DELIVERED, buyer: BUYER })).status, 500)
})

Deno.test('ไม่มีสิทธิ์สั่งล่วงหน้า → 403', async () => {
  seed()
  assertEquals((await call({ action: 'issue_invoice', orderId: DELIVERED, buyer: BUYER }, 'tok-chat')).status, 403)
})
