// ทดสอบ 2ก: ยกเลิกออร์เดอร์ที่ถูกปฏิเสธและไม่เคยบันทึกขึ้นเซิร์ฟเวอร์ → ทิ้งจากเครื่อง ไม่ส่งซ้ำ · ออร์เดอร์ที่มีบนเซิร์ฟเวอร์แล้วยังส่งการยกเลิกตามปกติ · รัน: node src/lib/ordersSync.discard.test.mjs
import { fileURLToPath } from 'node:url'
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const server = await createServer({ root: ROOT, server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' })
after(() => server.close())
const { pushOrders, startOrdersSync } = await server.ssrLoadModule('/src/lib/ordersSync.js')
const { syncEntries } = await server.ssrLoadModule('/src/lib/syncStatus.js')

// ไคลเอนต์จำลอง: insert ตาม script (ว่าง = สำเร็จ) · update ผ่าน casUpdate ได้ และนับรหัสที่ถูกแก้
function fakeClient(script = {}) {
  const calls = { insert: [], update: [] }
  return {
    calls,
    from() {
      return {
        insert: async (row) => {
          calls.insert.push(row.id)
          const s = script[row.id]
          return s ? { error: s.error, status: s.status } : { error: null }
        },
        update: () => {
          const b = {
            eq: (col, val) => { if (col === 'id') calls.update.push(val); return b },
            then: (res, rej) => Promise.resolve({ error: null, count: 1 }).then(res, rej),
          }
          return b
        },
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { updated_at: '2026-11-21T06:00:00.000000+00:00' } }) }) }),
      }
    },
  }
}
const REJECT = { error: { code: 'P0001', message: 'punpang_customer_deleted: ลูกค้าถูกลบแล้ว' }, status: 400 }
const order = (id, extra = {}) => ({
  id, code: 'OR-' + id, customerId: 'c1', status: 'pos_pending', fulfillment: 'pickup', channel: 'pos',
  items: [{ id: 'i-' + id, name: 'คัพเค้ก', qty: 1, unitPrice: 100 }], payments: [], history: [], ...extra,
})

test('ยกเลิกออร์เดอร์ที่ถูกปฏิเสธและไม่เคยบันทึกขึ้นเซิร์ฟเวอร์ → ไม่ส่งซ้ำ ทิ้งจากเครื่อง ไม่ค้างเป็นรายการปฏิเสธ', async () => {
  const client = fakeClient({ d1: REJECT })
  const held = new Set()
  await pushOrders(client, { upserts: [order('d1')] }, { held, known: new Set(), slips: new Map() })
  assert.ok(held.has('d1'))
  const r = await pushOrders(client, { upserts: [order('d1', { status: 'cancelled' })] }, { held, known: new Set(), slips: new Map() })
  assert.deepEqual(client.calls.insert, ['d1']) // รอบยกเลิกไม่ส่งซ้ำ
  assert.equal(r.error, undefined)
  assert.equal(r.rejected, undefined)
  assert.deepEqual(r.discarded.map((o) => o.id), ['d1'])
  assert.equal(held.has('d1'), false)
})

test('ยกเลิกออร์เดอร์ที่มีบนเซิร์ฟเวอร์แล้ว (ค้างจากการแก้ไข) → ยังส่งการยกเลิกตามปกติ ไม่ทิ้ง', async () => {
  const client = fakeClient({})
  const held = new Set(['k1'])
  const r = await pushOrders(client, { upserts: [order('k1', { status: 'cancelled' })] }, { held, known: new Set(['k1']), slips: new Map() })
  assert.equal(r.discarded, undefined)
  assert.deepEqual(client.calls.update, ['k1'])
  assert.equal(client.calls.insert.length, 0)
  assert.equal(r.error, undefined)
  assert.equal(held.has('k1'), false)
})

test('ยกเลิกออร์เดอร์ที่ยังไม่เคยถูกปฏิเสธ → ส่งตามปกติ ไม่ทิ้ง', async () => {
  const client = fakeClient({})
  const r = await pushOrders(client, { upserts: [order('n1', { status: 'cancelled' })] }, { held: new Set(), known: new Set(), slips: new Map() })
  assert.equal(r.discarded, undefined)
  assert.deepEqual(client.calls.insert, ['n1'])
})

test('เครื่องทิ้งออร์เดอร์ค้างแล้ว: เอาออกจากรายการ ไม่มีการส่งซ้ำ และไม่มีข้อความแจ้งปฏิเสธใหม่', async () => {
  const state = { rows: [], calls: [] }
  const client = {
    from() {
      const b = {
        select: () => b, not: () => b, is: () => b, limit: () => b, order: () => b,
        range: async () => ({ data: state.rows.map((r) => ({ ...r })), error: null }),
        then: (res, rej) => Promise.resolve({ data: [], error: null }).then(res, rej),
        insert: async (row) => { state.calls.push(row.id); return REJECT },
      }
      return b
    },
  }
  const db = { orders: [] }
  const errors = []
  const h = await startOrdersSync({ client, db, canWrite: true, onError: (m) => errors.push(m), onRecode() {}, onCreated() {}, numbering: null, debounceMs: 60000, retryDelay: 1 })
  db.orders.push(order('p1'))
  await h.flush()
  assert.deepEqual(state.calls, ['p1'])
  assert.equal(syncEntries['ออร์เดอร์']?.state, 'failed')
  const before = errors.length
  db.orders.find((o) => o.id === 'p1').status = 'cancelled'
  await h.flush()
  assert.deepEqual(state.calls, ['p1'])
  assert.equal(db.orders.some((o) => o.id === 'p1'), false)
  assert.equal(errors.length, before)
  assert.notEqual(syncEntries['ออร์เดอร์']?.state, 'failed')
  h.stop()
})
