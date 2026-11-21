// ทดสอบการส่งออร์เดอร์: แถวที่ถูกปฏิเสธถาวรไม่บล็อกแถวอื่น · ข้อผิดพลาดชั่วคราวหยุดชุดแล้วลองใหม่ · รัน: node src/lib/ordersSync.partial.test.mjs
import { fileURLToPath } from 'node:url'
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const server = await createServer({ root: ROOT, server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' })
after(() => server.close())
const { pushOrders } = await server.ssrLoadModule('/src/lib/ordersSync.js')

// ไคลเอนต์จำลอง: เขียนตรงลงตาราง (บิลหน้าร้าน channel = pos) · script = ผลที่ต้องการของแต่ละรหัสออร์เดอร์ (ว่าง = สำเร็จ)
function fakeClient(script) {
  const calls = []
  return {
    calls,
    from() {
      return {
        insert: async (row) => {
          calls.push(row.id)
          const s = script[row.id]
          if (!s) return { error: null }
          const { httpStatus, ...err } = s // httpStatus = สถานะ HTTP ที่ PostgREST คืนมาในผลลัพธ์
          return { error: err, status: httpStatus ?? 0 }
        },
      }
    },
  }
}

const order = (id, qty = 1) => ({
  id, code: 'OR-' + id, customerId: 'c1', status: 'pos_pending', fulfillment: 'pickup', channel: 'pos',
  items: [{ id: 'i-' + id, name: 'คัพเค้ก', qty, unitPrice: 100 }], payments: [], history: [],
})

test('แถวที่ถูกปฏิเสธถาวร 1 แถว → แถวถัดไปยังถูกส่ง และแถวนั้นถูกรายงานว่าค้าง', async () => {
  const client = fakeClient({ bad: { code: 'P0001', message: 'punpang_over_bill: ยอดเกินบิล' } })
  const held = new Set()
  const known = new Set()
  let reported = null
  const r = await pushOrders(client, { upserts: [order('bad'), order('good')] }, { held, known, slips: new Map(), onRejected: (list) => { reported = list } })
  assert.equal(r.error, undefined)
  assert.deepEqual(client.calls, ['bad', 'good']) // แถวปกติถูกส่งต่อ ไม่ถูกบล็อก
  assert.equal(r.rejected.length, 1)
  assert.equal(r.rejected[0].id, 'bad')
  assert.equal(r.rejected[0].errCode, 'P0001')
  assert.equal(reported.length, 1)
  assert.ok(held.has('bad'))
  assert.ok(!held.has('good'))
  assert.ok(known.has('good'))
})

test('แก้แถวที่ถูกปฏิเสธแล้วส่งใหม่สำเร็จ → หลุดจากรายการค้าง', async () => {
  const client = fakeClient({})
  const held = new Set(['bad'])
  const r = await pushOrders(client, { upserts: [order('bad', 2)] }, { held, known: new Set(), slips: new Map() })
  assert.equal(r.error, undefined)
  assert.equal(r.rejected, undefined)
  assert.equal(held.has('bad'), false)
})

test('ลูกค้ายังไม่ซิงก์ (23503) ลองซ้ำครบแล้ว → ยังไม่ปฏิเสธถาวร หยุดชุดแล้วลองใหม่ตามรอบ', async () => {
  const client = fakeClient({ fk: { code: '23503', message: 'customer not synced yet' } })
  const held = new Set()
  const r = await pushOrders(client, { upserts: [order('fk'), order('later')] }, { held, known: new Set(), slips: new Map(), retryDelay: 1 })
  assert.ok(r.error)
  assert.equal(r.rejected, undefined)
  assert.equal(held.size, 0)
  assert.ok(client.calls.every((id) => id === 'fk'))
})

test('เซสชันหมดอายุ (HTTP 401) เป็นข้อผิดพลาดชั่วคราว: หยุดชุดแล้วลองใหม่ ไม่ปฏิเสธถาวร', async () => {
  const client = fakeClient({ jwt: { httpStatus: 401, code: 'PGRST301', message: 'JWT expired' } })
  const held = new Set()
  const r = await pushOrders(client, { upserts: [order('jwt'), order('later')] }, { held, known: new Set(), slips: new Map() })
  assert.ok(r.error)
  assert.equal(r.rejected, undefined)
  assert.equal(held.size, 0)
  assert.deepEqual(client.calls, ['jwt'])
})

test('ข้อผิดพลาดชั่วคราว (เน็ตหลุด) หยุดชุดนี้ และไม่ส่งแถวที่เหลือ', async () => {
  const client = fakeClient({ net: { message: 'Failed to fetch' } }) // ไม่มีรหัส = ชั่วคราว
  const held = new Set()
  const r = await pushOrders(client, { upserts: [order('net'), order('later')] }, { held, known: new Set(), slips: new Map() })
  assert.ok(r.error)
  assert.deepEqual(client.calls, ['net'])
  assert.equal(held.size, 0)
})
