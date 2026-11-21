// ทดสอบ W-5 ระดับออร์เดอร์: ออร์เดอร์ POS ที่ฐานข้อมูลปฏิเสธต้องคงฉบับในเครื่องหลังรีเฟรชเต็มและหลังรวมแถว · รัน: node src/lib/ordersSync.held.test.mjs
import { fileURLToPath } from 'node:url'
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const server = await createServer({ root: ROOT, server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' })
after(() => server.close())
const { startOrdersSync } = await server.ssrLoadModule('/src/lib/ordersSync.js')

// ตาราง punpang_orders จำลอง: ทุกการดึงคืนแถวทั้งชุดใน state.rows · insert ตาม script (ว่าง = สำเร็จ)
function fakeOrdersClient(script = {}) {
  const state = { rows: [], calls: [] }
  const builder = () => {
    const b = {
      select: () => b, not: () => b, is: () => b, limit: () => b, order: () => b,
      range: async () => ({ data: state.rows.map((r) => ({ ...r })), error: null }),
      then: (res, rej) => Promise.resolve({ data: [], error: null }).then(res, rej),
      insert: async (row) => {
        state.calls.push(row.id)
        const s = script[row.id]
        return s ? { error: s.error, status: s.status } : { error: null }
      },
    }
    return b
  }
  // ช่องเก็บคิวถูกปฏิเสธด้วยสิทธิ์ → ออร์เดอร์ที่ถูกปฏิเสธค้างในเครื่องเหมือนเดิม
  const reviewDenied = { insert: async () => ({ error: { code: '42501', message: 'permission denied' }, status: 403 }) }
  return { state, from: (table) => (table === 'punpang_sync_review' ? reviewDenied : builder()) }
}
const ITEMS = [{ id: 'i-1', name: 'คัพเค้ก', qty: 1, unitPrice: 100 }]
const posOrder = (id, status = 'pos_pending') => ({ id, code: 'OR-' + id, customerId: 'c1', status, fulfillment: 'pickup', channel: 'pos', items: ITEMS, payments: [], history: [] })
const serverRow = (id, status, updatedAt) => ({ id, code: 'OR-' + id, customer_id: 'c1', status, fulfillment: 'pickup', channel: 'pos', data: { items: ITEMS, payments: [], history: [] }, updated_at: updatedAt })

test('ออร์เดอร์ POS ที่ถูกปฏิเสธค้างในเครื่อง: รีเฟรชเต็มและรวมแถวจากเซิร์ฟเวอร์ไม่ทับฉบับค้าง แถวอื่นยังเข้ามา', async () => {
  const client = fakeOrdersClient({ p1: { error: { code: 'P0001', message: 'punpang_over_bill: ยอดเกินบิล' }, status: 400 } })
  const db = { orders: [] }
  const errors = []
  const h = await startOrdersSync({ client, db, canWrite: true, onError: (m) => errors.push(m), onRecode() {}, onCreated() {}, numbering: null, debounceMs: 60000, retryDelay: 1 })
  db.orders.push(posOrder('p1'))
  await h.flush()
  assert.deepEqual(client.state.calls, ['p1'])
  assert.ok(errors.some((m) => m.includes('ซิงก์ออร์เดอร์ไม่สำเร็จ')))

  // เครื่องอื่นแก้ p1 บนเซิร์ฟเวอร์ และมีออร์เดอร์ใหม่ o2
  client.state.rows = [serverRow('p1', 'pos_done', '2026-11-21T05:00:00.000000+00:00'), serverRow('o2', 'pos_pending', '2026-11-21T05:01:00.000000+00:00')]
  assert.equal(await h.refresh({ full: true }), true)
  assert.equal(db.orders.find((o) => o.id === 'p1').status, 'pos_pending') // ฉบับค้างในเครื่องยังอยู่
  assert.ok(db.orders.some((o) => o.id === 'o2')) // แถวปกติเข้ามา

  h.merge([{ ...posOrder('p1'), status: 'pos_done' }]) // รวมแถวจากเซิร์ฟเวอร์ก็ไม่ทับ
  assert.equal(db.orders.find((o) => o.id === 'p1').status, 'pos_pending')
  h.stop()
})
