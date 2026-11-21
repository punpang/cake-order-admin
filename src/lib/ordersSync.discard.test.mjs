// ทดสอบการทิ้งออร์เดอร์แบบจำกัด: ทิ้งได้เฉพาะออร์เดอร์ที่ถูกปฏิเสธแล้วและยกเลิก ไม่เคยบันทึกขึ้นเซิร์ฟเวอร์ และไม่มีการเงิน แต้ม คูปอง หรือรูปผูกอยู่ · รัน: node src/lib/ordersSync.discard.test.mjs
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
const cash = { id: 'pay1', status: 'confirmed', amount: 100, posMethod: 'cash' }
const order = (id, extra = {}) => ({
  id, code: 'OR-' + id, customerId: 'c1', status: 'pos_pending', fulfillment: 'pickup', channel: 'pos',
  items: [{ id: 'i-' + id, name: 'คัพเค้ก', qty: 1, unitPrice: 100 }], payments: [], history: [], ...extra,
})

test('ไม่มีการเงิน แต้ม คูปอง หรือรูป: ยกเลิกหลังถูกปฏิเสธ → ทิ้ง ไม่ส่งซ้ำ และไม่ค้างเป็นรายการปฏิเสธ', async () => {
  const client = fakeClient({ d1: REJECT })
  const held = new Set()
  // ปิดการเก็บคิวเพื่อให้ออร์เดอร์ค้างในเครื่องก่อนยกเลิก (เมื่อเปิดคิว ออร์เดอร์ไม่มีการเงินจะเข้าคิวผู้จัดการแทน)
  await pushOrders(client, { upserts: [order('d1')] }, { held, known: new Set(), slips: new Map(), reviewQueue: false })
  assert.ok(held.has('d1'))
  const r = await pushOrders(client, { upserts: [order('d1', { status: 'cancelled' })] }, { held, known: new Set(), slips: new Map(), reviewQueue: false })
  assert.deepEqual(client.calls.insert, ['d1']) // รอบยกเลิกไม่ส่งซ้ำ
  assert.equal(r.error, undefined)
  assert.equal(r.rejected, undefined)
  assert.deepEqual(r.discarded.map((o) => o.id), ['d1'])
  assert.equal(held.has('d1'), false)
})

test('มีรายการรับเงินผูกอยู่: ยกเลิกหลังถูกปฏิเสธ → ไม่ทิ้ง ส่งซ้ำและยังค้างให้เห็น', async () => {
  const client = fakeClient({ m1: REJECT })
  const held = new Set()
  await pushOrders(client, { upserts: [order('m1', { payments: [cash] })] }, { held, known: new Set(), slips: new Map(), reviewQueue: false })
  const r = await pushOrders(client, { upserts: [order('m1', { status: 'cancelled', payments: [cash] })] }, { held, known: new Set(), slips: new Map(), reviewQueue: false })
  assert.equal(r.discarded, undefined)
  assert.equal(client.calls.insert.length, 2)
  assert.ok(held.has('m1'))
  assert.equal(r.rejected[0].id, 'm1')
})

test('มีรูปในเครื่องผูกอยู่: ยกเลิกหลังถูกปฏิเสธ → ไม่ทิ้ง', async () => {
  const client = fakeClient({ ph: REJECT })
  const held = new Set()
  const withPhoto = (status) => order('ph', { status, items: [{ id: 'i-ph', name: 'คัพเค้ก', qty: 1, unitPrice: 100, images: ['data:image/png;base64,iVBORw0KGgo='] }] })
  await pushOrders(client, { upserts: [withPhoto('pos_pending')] }, { held, known: new Set(), slips: new Map() })
  const r = await pushOrders(client, { upserts: [withPhoto('cancelled')] }, { held, known: new Set(), slips: new Map() })
  assert.equal(r.discarded, undefined)
  assert.ok(held.has('ph'))
})

test('เคยบันทึกขึ้นเซิร์ฟเวอร์แล้ว: ยกเลิก → ส่งการแก้ไขตามปกติ ไม่ทิ้ง', async () => {
  const client = fakeClient({})
  const held = new Set(['k1'])
  const r = await pushOrders(client, { upserts: [order('k1', { status: 'cancelled' })] }, { held, known: new Set(['k1']), slips: new Map() })
  assert.equal(r.discarded, undefined)
  assert.deepEqual(client.calls.update, ['k1'])
  assert.equal(held.has('k1'), false)
})

test('ไม่เคยถูกปฏิเสธ: ยกเลิกแล้วส่งตามปกติ ไม่ทิ้ง', async () => {
  const client = fakeClient({})
  const r = await pushOrders(client, { upserts: [order('n1', { status: 'cancelled' })] }, { held: new Set(), known: new Set(), slips: new Map() })
  assert.equal(r.discarded, undefined)
  assert.deepEqual(client.calls.insert, ['n1'])
})

// ตารางจำลองสำหรับทดสอบทั้งเส้นทางผ่าน startOrdersSync
function fakeOrdersClient(scriptFor, { reviewErr = null } = {}) {
  const state = { rows: [], calls: [], review: [] }
  const builder = (table) => {
    const b = {
      select: () => b, not: () => b, is: () => b, limit: () => b, order: () => b,
      range: async () => ({ data: state.rows.map((r) => ({ ...r })), error: null }),
      then: (res, rej) => Promise.resolve({ data: [], error: null }).then(res, rej),
      insert: async (row) => {
        if (table === 'punpang_sync_review') { state.review.push(row); return reviewErr ? { error: reviewErr.error, status: reviewErr.status } : { error: null } }
        state.calls.push(row.id)
        return scriptFor(row.id)
      },
    }
    return b
  }
  return { state, from: (table) => builder(table) }
}

test('ยกเลิกออร์เดอร์ค้างที่ไม่มีการเงิน → ออกจากเครื่อง ไม่ส่งซ้ำ และสถานะซิงก์กลับเป็นปกติ', async () => {
  // ช่องเก็บคิวถูกปฏิเสธด้วยสิทธิ์ → ออร์เดอร์ค้างในเครื่องก่อนยกเลิก (เมื่อเก็บคิวได้ ออร์เดอร์ไม่มีการเงินเข้าคิวแทน)
  const client = fakeOrdersClient(() => REJECT, { reviewErr: { error: { code: '42501', message: 'permission denied' }, status: 403 } })
  const db = { orders: [] }
  const errors = []
  const h = await startOrdersSync({ client, db, canWrite: true, onError: (m) => errors.push(m), onRecode() {}, onCreated() {}, numbering: null, debounceMs: 60000, retryDelay: 1 })
  db.orders.push(order('p1'))
  await h.flush()
  assert.deepEqual(client.state.calls, ['p1'])
  assert.equal(syncEntries['ออร์เดอร์']?.state, 'failed')
  const before = errors.length
  db.orders.find((o) => o.id === 'p1').status = 'cancelled'
  await h.flush()
  assert.deepEqual(client.state.calls, ['p1'])
  assert.equal(db.orders.some((o) => o.id === 'p1'), false)
  assert.equal(errors.length, before)
  assert.notEqual(syncEntries['ออร์เดอร์']?.state, 'failed')
  h.stop()
})

test('ออร์เดอร์รับเงินที่ระบบปฏิเสธ → เข้าคิวผู้จัดการ ออกจากเครื่อง และไม่ค้างเป็นล้มเหลว', async () => {
  const client = fakeOrdersClient(() => REJECT)
  const db = { orders: [] }
  const queuedNotes = []
  const h = await startOrdersSync({ client, db, canWrite: true, onError: () => {}, onRecode() {}, onCreated() {}, onQueued: (list) => queuedNotes.push(list.map((o) => o.id)), numbering: null, debounceMs: 60000, retryDelay: 1 })
  db.orders.push(order('p2', { payments: [cash] }))
  await h.flush()
  assert.deepEqual(client.state.review.map((r) => r.order_id), ['p2'])
  assert.equal(db.orders.some((o) => o.id === 'p2'), false)
  assert.deepEqual(queuedNotes, [['p2']])
  assert.notEqual(syncEntries['ออร์เดอร์']?.state, 'failed')
  h.stop()
})
