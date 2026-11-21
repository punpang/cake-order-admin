// ทดสอบ W-2: การจัดประเภทข้อผิดพลาดของการอัปโหลดรูป (ชั่วคราว = หยุดชุดนี้ · ถาวร = ข้ามเฉพาะออร์เดอร์นั้น) และ W-6: 5xx ตอนเขียนออร์เดอร์
// รัน: node src/lib/ordersSync.images.test.mjs
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
          const { httpStatus, ...err } = s
          return { error: err, status: httpStatus ?? 0 }
        },
      }
    },
  }
}
const order = (id, extra = {}) => ({
  id, code: 'OR-' + id, customerId: 'c1', status: 'pos_pending', fulfillment: 'pickup', channel: 'pos',
  items: [{ id: 'i-' + id, name: 'คัพเค้ก', qty: 1, unitPrice: 100 }], payments: [], history: [], ...extra,
})
const failWith = (msg, props) => Object.assign(new Error(msg), props)
// อัปโหลดรูปล้มเหลวเฉพาะออร์เดอร์ id ที่กำหนด (แทน externalizeOrderImages ที่ต่อเซิร์ฟเวอร์ไฟล์จริง)
const imageFailsFor = (id, err) => async (_client, o) => { if (o.id === id) throw err }

test('W-2 รูปใหญ่เกินกำหนด (ถาวร) → ข้ามเฉพาะออร์เดอร์นั้น ส่งอื่นต่อ และค้างให้แก้รูป', async () => {
  const client = fakeClient({})
  const held = new Set()
  const err = failWith('รูปใหญ่เกิน 2 MB', { code: 'IMAGE_TOO_LARGE' })
  const r = await pushOrders(client, { upserts: [order('big'), order('good')] }, { held, known: new Set(), slips: new Map(), externalize: imageFailsFor('big', err) })
  assert.equal(r.error, undefined)
  assert.deepEqual(client.calls, ['good'])
  assert.equal(r.rejected.length, 1)
  assert.equal(r.rejected[0].id, 'big')
  assert.equal(r.rejected[0].errCode, 'IMAGE_TOO_LARGE')
  assert.ok(held.has('big'))
  assert.ok(!held.has('good'))
})

test('W-2 อัปโหลดรูปตอบ 403 (ถาวร) → ข้ามออร์เดอร์นั้น ไม่บล็อกชุด', async () => {
  const client = fakeClient({})
  const held = new Set()
  const err = failWith('ไม่มีสิทธิ์อัปโหลดไฟล์', { status: 403 })
  const r = await pushOrders(client, { upserts: [order('nope'), order('good')] }, { held, known: new Set(), slips: new Map(), externalize: imageFailsFor('nope', err) })
  assert.equal(r.error, undefined)
  assert.deepEqual(client.calls, ['good'])
  assert.equal(r.rejected[0].errCode, '403')
  assert.ok(held.has('nope'))
})

for (const [label, err] of [
  ['เซิร์ฟเวอร์ไฟล์ตอบ 503', failWith('เซิร์ฟเวอร์ไฟล์ไม่พร้อม', { status: 503 })],
  ['เน็ตหลุดระหว่างอัปโหลด', new TypeError('Failed to fetch')],
  ['เซสชันหมดอายุ 401', failWith('JWT expired', { status: 401 })],
]) {
  test(`W-2 อัปโหลดรูปชั่วคราว (${label}) → หยุดชุดนี้ ไม่เขียนออร์เดอร์ใด และไม่ค้างเป็นถาวร`, async () => {
    const client = fakeClient({})
    const held = new Set()
    const r = await pushOrders(client, { upserts: [order('img'), order('later')] }, { held, known: new Set(), slips: new Map(), externalize: imageFailsFor('img', err) })
    assert.ok(r.error)
    assert.equal(r.rejected, undefined)
    assert.deepEqual(client.calls, [])
    assert.equal(held.size, 0)
  })
}

test('W-2 รูปในเครื่องอ่านไม่ได้ (ถาวร) จริงผ่านการอัปโหลด → ข้ามออร์เดอร์นั้น ไม่บล็อกชุด', async () => {
  const client = fakeClient({})
  const held = new Set()
  const bad = order('bad', { payments: [{ id: 'p1', slip: 'data:image/png;base64,%%%' }] })
  const r = await pushOrders(client, { upserts: [bad, order('good')] }, { held, known: new Set(), slips: new Map() })
  assert.equal(r.error, undefined)
  assert.deepEqual(client.calls, ['good'])
  assert.equal(r.rejected[0].errCode, 'IMAGE_UNREADABLE')
  assert.ok(held.has('bad'))
})

test('W-2 รูปในเครื่องเกิน 2 MB จริง (ถาวร) → ข้ามออร์เดอร์นั้น', async () => {
  const client = fakeClient({})
  const held = new Set()
  const big = order('huge', { payments: [{ id: 'p1', slip: 'data:image/png;base64,' + 'A'.repeat(3_000_000) }] })
  const r = await pushOrders(client, { upserts: [big, order('good')] }, { held, known: new Set(), slips: new Map() })
  assert.equal(r.error, undefined)
  assert.deepEqual(client.calls, ['good'])
  assert.equal(r.rejected[0].errCode, 'IMAGE_TOO_LARGE')
  assert.ok(held.has('huge'))
})

test('W-2 รูปในเครื่องแต่ยังไม่ตั้งค่าเซิร์ฟเวอร์ไฟล์ (ถาวร) → ข้ามออร์เดอร์นั้น', { skip: Boolean(process.env.VITE_FILES_URL) }, async () => {
  const client = fakeClient({})
  const held = new Set()
  const noFiles = order('nofiles', { payments: [{ id: 'p1', slip: 'data:image/png;base64,iVBORw0KGgo=' }] })
  const r = await pushOrders(client, { upserts: [noFiles, order('good')] }, { held, known: new Set(), slips: new Map() })
  assert.equal(r.error, undefined)
  assert.deepEqual(client.calls, ['good'])
  assert.equal(r.rejected[0].errCode, 'NO_FILES')
})

test('W-6 เขียนออร์เดอร์ POS แล้วเซิร์ฟเวอร์ตอบ 503 → หยุดชุดนี้ ไม่ส่งแถวที่เหลือ และไม่ค้างเป็นถาวร', async () => {
  const client = fakeClient({ s5: { httpStatus: 503, message: 'Service Unavailable' } })
  const held = new Set()
  const r = await pushOrders(client, { upserts: [order('s5'), order('later')] }, { held, known: new Set(), slips: new Map() })
  assert.ok(r.error)
  assert.deepEqual(client.calls, ['s5'])
  assert.equal(held.size, 0)
})
