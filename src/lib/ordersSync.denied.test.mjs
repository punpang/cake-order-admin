// ทดสอบออร์เดอร์ที่ถูกปฏิเสธด้วยสิทธิ์หรือด่าน (42501): ออร์เดอร์ใหม่ที่มีการเงินเข้าคิวผู้จัดการ · ออร์เดอร์ใหม่ไม่มีการเงินก็เข้าคิวผู้จัดการ (ไม่หายเงียบ) · ออร์เดอร์ที่เคยบันทึกแล้วยังโหลดแถวกลับตามเดิม
// รัน: node src/lib/ordersSync.denied.test.mjs
import { fileURLToPath } from 'node:url'
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const server = await createServer({ root: ROOT, server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' })
after(() => server.close())
const { pushOrders } = await server.ssrLoadModule('/src/lib/ordersSync.js')

// ด่านคูปองของตารางออร์เดอร์ปฏิเสธด้วยรหัสสิทธิ์ 42501
const DENIED = { error: { code: '42501', message: 'coupon is not claimed for this order or the discount is too large' }, status: 403 }
const cash = { id: 'pay1', status: 'confirmed', amount: 100, posMethod: 'cash' }
const order = (id, extra = {}) => ({
  id, code: 'OR-' + id, customerId: 'c1', status: 'pos_pending', fulfillment: 'pickup', channel: 'pos',
  items: [{ id: 'i-' + id, name: 'คัพเค้ก', qty: 1, unitPrice: 100 }], payments: [], history: [], ...extra,
})
const deps = (extra = {}) => ({ held: new Set(), known: new Set(), slips: new Map(), retryDelay: 1, ...extra })

// ไคลเอนต์จำลอง: punpang_orders ตอบตามผลที่กำหนด (insert และ update) · punpang_sync_review รับการเก็บคิวเสมอ
function fakeClient({ orderErr = null } = {}) {
  const calls = { orders: [], review: [] }
  const orderResult = () => (orderErr ? { error: orderErr.error, status: orderErr.status } : { error: null })
  return {
    calls,
    from(table) {
      if (table === 'punpang_sync_review') return { insert: async (row) => { calls.review.push(row); return { error: null } } }
      return {
        insert: async (row) => { calls.orders.push(row.id); return orderResult() },
        update: () => {
          const b = { eq: () => b, then: (res, rej) => Promise.resolve({ ...orderResult(), count: 1 }).then(res, rej) }
          return b
        },
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { updated_at: '2026-11-21T06:00:00.000000+00:00' } }) }) }),
      }
    },
  }
}

test('ออร์เดอร์ใหม่มีการเงินถูกปฏิเสธด้วยด่านคูปอง (42501) → เข้าคิวผู้จัดการ ออกจากเครื่อง และไม่เกิดการโหลดกลับแบบขัดแย้ง', async () => {
  const client = fakeClient({ orderErr: DENIED })
  const d = deps()
  const gates = []
  const r = await pushOrders(client, { upserts: [order('x1', { payments: [cash] })] }, { ...d, onGate: (m) => gates.push(m) })
  assert.equal(r.conflicts, undefined)
  assert.equal(r.rejected, undefined)
  assert.deepEqual(r.queued.map((o) => o.id), ['x1'])
  assert.equal(client.calls.review.length, 1)
  assert.equal(client.calls.review[0].reason_code, '42501')
  assert.equal(client.calls.review[0].reason_message, DENIED.error.message)
  assert.deepEqual(gates, [])
  assert.equal(d.held.has('x1'), false)
})

test('ออร์เดอร์ใหม่ไม่มีการเงินถูกปฏิเสธด้วย 42501 → เข้าคิวผู้จัดการ (ไม่หายเงียบ)', async () => {
  const client = fakeClient({ orderErr: DENIED })
  const d = deps()
  const r = await pushOrders(client, { upserts: [order('x2')] }, d)
  assert.equal((r.conflicts || []).length, 0)
  assert.equal(r.rejected, undefined)
  assert.deepEqual(r.queued.map((o) => o.id), ['x2'])
  assert.equal(client.calls.review.length, 1)
  assert.equal(client.calls.review[0].reason_code, '42501')
  assert.equal(d.held.has('x2'), false)
})

test('ออร์เดอร์ที่เคยบันทึกขึ้นเซิร์ฟเวอร์แล้วถูกปฏิเสธด้วย 42501 → ยังโหลดแถวกลับตามเดิม (ไม่เข้าคิว)', async () => {
  const client = fakeClient({ orderErr: DENIED })
  const d = deps({ known: new Set(['k3']) })
  const gates = []
  const r = await pushOrders(client, { upserts: [order('k3', { payments: [cash] })] }, { ...d, onGate: (m) => gates.push(m) })
  assert.deepEqual(r.conflicts, ['k3'])
  assert.equal(r.queued, undefined)
  assert.equal(gates.length, 1)
  assert.match(gates[0], /ข้อมูลถูกโหลดกลับจากฐานข้อมูล/)
  assert.equal(client.calls.review.length, 0)
})
