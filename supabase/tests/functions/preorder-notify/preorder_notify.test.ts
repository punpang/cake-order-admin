// ทดสอบการส่งข้อความแจ้งลูกค้าสั่งล่วงหน้า (กันซ้ำ · เลือกช่องทาง · ล้มเหลวปลดการจอง) ด้วยตัวปลอม ไม่ส่งจริง
// รัน: deno test -A --no-lock --node-modules-dir=none --unstable-sloppy-imports --import-map=supabase/tests/functions/_fake/importmap.json supabase/tests/functions/preorder-notify/
import { assertEquals } from 'jsr:@std/assert@1'
import { notifyCustomer, fillLink, smsOk } from '../../../functions/_shared/preorderNotify.ts'

type Call = { fn: string; args?: any }
function fakeDb(opts: { claim?: boolean; lineRows?: any[]; rpcError?: boolean } = {}) {
  const calls: Call[] = []
  const sb = {
    rpc: async (fn: string, args?: any) => {
      calls.push({ fn, args })
      if (opts.rpcError && fn === 'punpang_preorder_notify_claim') return { data: null, error: { message: 'x' } }
      if (fn === 'punpang_preorder_notify_claim') return { data: opts.claim ?? true, error: null }
      return { data: true, error: null }
    },
    from: (_t: string) => ({
      select: () => ({
        eq: () => ({
          order: () => ({ limit: async () => ({ data: opts.lineRows ?? [], error: null }) }),
        }),
      }),
    }),
  }
  return { sb, calls }
}
const okDeps = (log: string[]) => ({
  sendSms: async (_l: string, _t: string, idem: string) => { log.push(`sms:${idem}`); return true },
  sendLine: async (to: string) => { log.push(`line:${to}`); return true },
})
const base = { orderId: 'o1', customerId: 'c1', phoneLocal: '0812345678', event: 'placed', text: 'ทดสอบ {LINK}', link: 'https://x.test/my' }

Deno.test('ผูก LINE แล้ว ส่งทาง LINE และบันทึกช่องทาง', async () => {
  const log: string[] = []
  const { sb, calls } = fakeDb({ lineRows: [{ line_user_id: 'U1', followed: true, updated_at: 't' }] })
  assertEquals(await notifyCustomer(sb, base, okDeps(log)), 'sent')
  assertEquals(log, ['line:U1'])
  assertEquals(calls.at(-1)?.args?.p_channel, 'line')
})

Deno.test('ไม่ได้ผูก LINE ส่ง SMS สำรอง', async () => {
  const log: string[] = []
  const { sb, calls } = fakeDb({ lineRows: [] })
  assertEquals(await notifyCustomer(sb, base, okDeps(log)), 'sent')
  assertEquals(log, ['sms:pp-o1-placed'])
  assertEquals(calls.at(-1)?.args?.p_channel, 'sms')
})

Deno.test('เรียกซ้ำเหตุการณ์เดิมไม่ส่งอีก (skipped)', async () => {
  const log: string[] = []
  const { sb } = fakeDb({ claim: false })
  assertEquals(await notifyCustomer(sb, base, okDeps(log)), 'skipped')
  assertEquals(log, [])
})

Deno.test('ส่งไม่สำเร็จทั้งสองช่องทาง ปลดการจองและคืน failed', async () => {
  const { sb, calls } = fakeDb({ lineRows: [] })
  const deps = { sendSms: async () => false, sendLine: async () => false }
  assertEquals(await notifyCustomer(sb, base, deps), 'failed')
  assertEquals(calls.at(-1)?.fn, 'punpang_preorder_notify_release')
})

Deno.test('ข้อความยาวเกิน SMS ไม่ส่ง SMS และปลดการจอง', async () => {
  const { sb, calls } = fakeDb({ lineRows: [] })
  const long = { ...base, text: 'ก'.repeat(301) }
  assertEquals(await notifyCustomer(sb, long, okDeps([])), 'failed')
  assertEquals(calls.at(-1)?.fn, 'punpang_preorder_notify_release')
})

Deno.test('ไม่มีลูกค้าและไม่มีเบอร์ → skipped (ไม่มีช่องทาง)', async () => {
  const { sb } = fakeDb()
  assertEquals(await notifyCustomer(sb, { ...base, customerId: null, phoneLocal: null }, okDeps([])), 'skipped')
})

Deno.test('ฐานข้อมูลผิดพลาดตอนจอง คืน failed ไม่โยนข้อผิดพลาดออกไป', async () => {
  const { sb } = fakeDb({ rpcError: true })
  assertEquals(await notifyCustomer(sb, base, okDeps([])), 'failed')
})

Deno.test('fillLink แทน {LINK} และ smsOk ตรวจความยาว', () => {
  assertEquals(fillLink('ดู {LINK} นะ', 'https://a'), 'ดู https://a นะ')
  assertEquals(fillLink('ดู {LINK} นะ'), 'ดู นะ')
  assertEquals(smsOk('ก'.repeat(300)), true)
  assertEquals(smsOk('ก'.repeat(301)), false)
})
