// ทดสอบคิวรอตรวจของผู้จัดการ: ฝั่งเครื่องพนักงาน (ออร์เดอร์ใหม่ที่มีการเงินถูกปฏิเสธถาวร → เก็บลงคิวก่อน แล้วจึงเอาออกจากเครื่อง · ชั่วคราว/ถาวรของการเก็บคิว · ออร์เดอร์ที่เคยบันทึกแล้วไม่เข้าคิว)
// และฝั่งผู้จัดการ (ส่งซ้ำเฉพาะบิลหน้าร้าน · ปรับสถานะเฉพาะรายการที่ยังเปิด · ปิดต้องมีเหตุผล) · รัน: node src/lib/syncReview.test.mjs
import { fileURLToPath } from 'node:url'
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const server = await createServer({ root: ROOT, server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' })
after(() => server.close())
const { reviewRowOf, queueForReview, resendReview, closeReview, paymentsOf, withPayments, paymentsError } = await server.ssrLoadModule('/src/lib/syncReview.js')
const { pushOrders } = await server.ssrLoadModule('/src/lib/ordersSync.js')

const REJECT = { error: { code: 'P0001', message: 'punpang_customer_deleted: ลูกค้าถูกลบแล้ว' }, status: 400 }
const cash = { id: 'pay1', status: 'confirmed', amount: 100, posMethod: 'cash' }
const order = (id, extra = {}) => ({
  id, code: 'OR-' + id, customerId: 'c1', status: 'pos_pending', fulfillment: 'pickup', channel: 'pos',
  items: [{ id: 'i-' + id, name: 'คัพเค้ก', qty: 1, unitPrice: 100 }], payments: [], history: [], ...extra,
})
const deps = (extra = {}) => ({ held: new Set(), known: new Set(), slips: new Map(), retryDelay: 1, ...extra })

// ไคลเอนต์จำลองฝั่งเครื่องพนักงาน: punpang_orders (ผลตามที่กำหนด) · punpang_sync_review (เก็บตามผลที่กำหนด)
function fakeClient({ orderErr = null, reviewErr = null } = {}) {
  const calls = { orders: [], review: [], update: [] }
  const orderResult = () => (orderErr ? { error: orderErr.error, status: orderErr.status } : { error: null })
  return {
    calls,
    from(table) {
      if (table === 'punpang_sync_review') {
        return { insert: async (row) => { calls.review.push(row); return reviewErr ? { error: reviewErr.error, status: reviewErr.status } : { error: null } } }
      }
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

// ไคลเอนต์จำลองฝั่งผู้จัดการ: บันทึกค่าที่ส่งและตัวกรอง id/status ของการปรับสถานะ
function fakeManagerClient({ insertErr = null, updateCount = 1, updateErr = null } = {}) {
  const calls = { insert: [], update: [] }
  return {
    calls,
    from(table) {
      if (table === 'punpang_orders') {
        return { insert: async (row) => { calls.insert.push(row.id); return insertErr ? { error: insertErr, status: 400 } : { error: null } } }
      }
      return {
        update: (values, opts) => {
          const rec = { values, count: opts?.count }
          calls.update.push(rec)
          const b = {
            eq: (col, val) => { rec[col] = val; return b },
            then: (res, rej) => Promise.resolve({ error: updateErr, count: updateErr ? null : updateCount }).then(res, rej),
          }
          return b
        },
      }
    },
  }
}

// ---------- รูปแบบแถวและการเก็บลงคิว ----------
test('reviewRowOf: เก็บต้นฉบับเป็น JSON และไม่เก็บค่าเวอร์ชันที่อยู่ในเครื่อง', () => {
  const o = order('r1', { payments: [cash] })
  Object.defineProperty(o, '_v', { value: '2026-11-21T06:00:00.000000+00:00', enumerable: false })
  const row = reviewRowOf(o, { code: 'P0001', message: 'ยอดเกินบิล' })
  assert.equal(row.order_id, 'r1')
  assert.equal(row.order_code, 'OR-r1')
  assert.equal(row.channel, 'pos')
  assert.equal(row.reason_code, 'P0001')
  assert.equal(row.reason_message, 'ยอดเกินบิล')
  assert.deepEqual(row.payload.payments, [cash])
  assert.equal('_v' in row.payload, false)
})

test('reviewRowOf: ข้อความยาวถูกตัดที่ 500 ตัวอักษร · ไม่มีช่องทางหรือรหัสเหตุผลให้ค่าว่าง', () => {
  const row = reviewRowOf({ id: 'r2', code: 'X', items: [] }, { message: 'ก'.repeat(900) })
  assert.equal(row.reason_message.length, 500)
  assert.equal(row.channel, null)
  assert.equal(row.reason_code, '')
})

test('queueForReview: เก็บสำเร็จ หรือมีรายการเปิดของออร์เดอร์นี้อยู่แล้ว (23505) = สำเร็จ', async () => {
  assert.deepEqual(await queueForReview(fakeClient(), order('q1'), REJECT.error), { ok: true })
  const dup = fakeClient({ reviewErr: { error: { code: '23505', message: 'duplicate key punpang_sync_review_open_uniq' }, status: 409 } })
  assert.deepEqual(await queueForReview(dup, order('q2'), REJECT.error), { ok: true })
})

test('queueForReview: ชั่วคราว (เน็ตหลุด/เซิร์ฟเวอร์ล่ม) ลองใหม่ได้ · ถาวร (ไม่มีสิทธิ์) ไม่ลองซ้ำ', async () => {
  const net = await queueForReview(fakeClient({ reviewErr: { error: { message: 'fetch failed' }, status: 0 } }), order('q3'), REJECT.error)
  assert.equal(net.ok, false)
  assert.equal(net.transient, true)
  const down = await queueForReview(fakeClient({ reviewErr: { error: { message: 'bad gateway' }, status: 503 } }), order('q4'), REJECT.error)
  assert.equal(down.transient, true)
  const denied = await queueForReview(fakeClient({ reviewErr: { error: { code: '42501', message: 'new row violates row-level security' }, status: 403 } }), order('q5'), REJECT.error)
  assert.equal(denied.ok, false)
  assert.equal(denied.transient, false)
})

// ---------- การส่งออร์เดอร์ (pushOrders) ----------
test('ออร์เดอร์ใหม่มีการเงินถูกปฏิเสธถาวร → เก็บเข้าคิวก่อน แล้วเอาออกจากเครื่อง (ไม่ค้างเป็นล้มเหลว)', async () => {
  const client = fakeClient({ orderErr: REJECT })
  const d = deps()
  const r = await pushOrders(client, { upserts: [order('m1', { payments: [cash] })] }, d)
  assert.equal(r.error, undefined)
  assert.equal(r.rejected, undefined)
  assert.deepEqual(r.queued.map((o) => o.id), ['m1'])
  assert.equal(d.held.has('m1'), false)
  assert.equal(client.calls.review.length, 1)
  assert.equal(client.calls.review[0].order_id, 'm1')
  assert.equal(client.calls.review[0].reason_code, 'P0001')
  assert.equal(client.calls.review[0].payload.payments[0].amount, 100)
})

test('เก็บเข้าคิวชั่วคราวไม่ได้ → ออร์เดอร์ยังอยู่ในเครื่อง ไม่เป็นปฏิเสธ และหยุดรอบนี้ให้ลองใหม่', async () => {
  const client = fakeClient({ orderErr: REJECT, reviewErr: { error: { message: 'fetch failed' }, status: 0 } })
  const d = deps()
  const r = await pushOrders(client, { upserts: [order('m2', { payments: [cash] }), order('n2')] }, d)
  assert.match(r.error, /^OR-m2: /)
  assert.equal(d.held.has('m2'), false)
  assert.equal(client.calls.orders.length, 1) // ออร์เดอร์ถัดไปยังไม่ถูกส่งในรอบนี้
})

test('เก็บเข้าคิวถาวรไม่ได้ (ไม่มีสิทธิ์) → ค้างในเครื่องให้เห็นเป็นรายการล้มเหลว', async () => {
  const client = fakeClient({ orderErr: REJECT, reviewErr: { error: { code: '42501', message: 'permission denied' }, status: 403 } })
  const d = deps()
  const r = await pushOrders(client, { upserts: [order('m3', { payments: [cash] })] }, d)
  assert.equal(r.queued, undefined)
  assert.equal(r.rejected[0].id, 'm3')
  assert.equal(r.rejected[0].errCode, 'review')
  assert.equal(d.held.has('m3'), true)
})

test('ปิดการเก็บคิว (reviewQueue:false) หรือไม่มีการเงิน → ค้างในเครื่องตามเดิม ไม่เก็บคิว', async () => {
  const c1 = fakeClient({ orderErr: REJECT })
  const d1 = deps()
  const r1 = await pushOrders(c1, { upserts: [order('m4', { payments: [cash] })] }, { ...d1, reviewQueue: false })
  assert.equal(r1.rejected[0].id, 'm4')
  assert.equal(d1.held.has('m4'), true)
  assert.equal(c1.calls.review.length, 0)
  const c2 = fakeClient({ orderErr: REJECT })
  const d2 = deps()
  const r2 = await pushOrders(c2, { upserts: [order('n4')] }, d2)
  assert.equal(r2.rejected[0].id, 'n4')
  assert.equal(d2.held.has('n4'), true)
  assert.equal(c2.calls.review.length, 0)
})

test('ออร์เดอร์ที่เคยบันทึกขึ้นเซิร์ฟเวอร์แล้วไม่เข้าคิว (ฉบับบนเซิร์ฟเวอร์ยังอยู่)', async () => {
  const client = fakeClient({ orderErr: REJECT })
  const d = deps({ known: new Set(['k1']) })
  const r = await pushOrders(client, { upserts: [order('k1', { payments: [cash] })] }, d)
  assert.equal(r.queued, undefined)
  assert.equal(r.rejected[0].id, 'k1')
  assert.equal(d.held.has('k1'), true)
  assert.equal(client.calls.review.length, 0)
})

test('ออร์เดอร์ใหม่ที่ไม่มีการเงิน หรือมีรูปในเครื่องที่ยังไม่อัปโหลด → ไม่เข้าคิว', async () => {
  const c1 = fakeClient({ orderErr: REJECT })
  const d1 = deps()
  const r1 = await pushOrders(c1, { upserts: [order('n5')] }, d1)
  assert.equal(r1.queued, undefined)
  assert.equal(d1.held.has('n5'), true)
  assert.equal(c1.calls.review.length, 0)
  const withPhoto = order('p5', { payments: [cash], items: [{ id: 'i-p5', name: 'คัพเค้ก', qty: 1, unitPrice: 100, images: ['data:image/png;base64,iVBORw0KGgo='] }] })
  const c2 = fakeClient({ orderErr: REJECT })
  const d2 = deps()
  const r2 = await pushOrders(c2, { upserts: [withPhoto] }, d2)
  assert.equal(r2.queued, undefined)
  assert.equal(d2.held.has('p5'), true)
  assert.equal(c2.calls.review.length, 0)
})

// ---------- ฝั่งผู้จัดการ ----------
test('ส่งซ้ำบิลหน้าร้าน: เขียนออร์เดอร์แล้วปรับสถานะเป็นส่งซ้ำแล้ว เฉพาะรายการที่ยังเปิด', async () => {
  const client = fakeManagerClient()
  const row = { id: 'rv1', channel: 'pos', payload: order('s1', { payments: [cash] }) }
  assert.deepEqual(await resendReview(client, row, row.payload), { ok: true })
  assert.deepEqual(client.calls.insert, ['s1'])
  const u = client.calls.update[0]
  assert.equal(u.values.status, 'resent')
  assert.equal(u.id, 'rv1')
  assert.equal(u.status, 'open')
  assert.equal(u.count, 'exact')
})

test('ส่งซ้ำ: ออร์เดอร์มีอยู่แล้ว (pkey ซ้ำ) = เคยส่งไปแล้ว → ปรับสถานะต่อ', async () => {
  const client = fakeManagerClient({ insertErr: { code: '23505', message: 'duplicate key value violates unique constraint "punpang_orders_pkey"' } })
  const row = { id: 'rv2', channel: 'pos', payload: order('s2') }
  assert.deepEqual(await resendReview(client, row, row.payload), { ok: true })
  assert.equal(client.calls.update[0].values.status, 'resent')
})

test('ส่งซ้ำ: รหัสออร์เดอร์ซ้ำ (ไม่ใช่ pkey) ไม่นับว่าส่งแล้ว และไม่ปรับสถานะ', async () => {
  const client = fakeManagerClient({ insertErr: { code: '23505', message: 'duplicate key value violates unique constraint "punpang_orders_code_key"' } })
  const row = { id: 'rv3', channel: 'pos', payload: order('s3') }
  const r = await resendReview(client, row, row.payload)
  assert.ok(r.error)
  assert.equal(client.calls.update.length, 0)
})

test('ส่งซ้ำ: ถูกปฏิเสธซ้ำ → แสดงเหตุผลของระบบและไม่ปรับสถานะ', async () => {
  const client = fakeManagerClient({ insertErr: { code: 'P0001', message: 'ยอดเกินบิล' } })
  const row = { id: 'rv4', channel: 'pos', payload: order('s4') }
  assert.deepEqual(await resendReview(client, row, row.payload), { error: 'ยอดเกินบิล' })
  assert.equal(client.calls.update.length, 0)
})

test('ส่งซ้ำ: ช่องทางอื่นไม่รองรับที่หน้านี้ → ไม่เขียนอะไร', async () => {
  const client = fakeManagerClient()
  const row = { id: 'rv5', channel: 'web', payload: order('s5', { channel: 'web' }) }
  assert.ok((await resendReview(client, row, row.payload)).error)
  assert.equal(client.calls.insert.length, 0)
  assert.equal(client.calls.update.length, 0)
})

test('ปิดพร้อมเหตุผล: ตัดช่องว่างหัวท้าย และไม่ปิดถ้ารายการถูกเปลี่ยนไปแล้ว', async () => {
  const ok = fakeManagerClient()
  assert.deepEqual(await closeReview(ok, { id: 'c1' }, '  โอนคืนแล้ว  '), { ok: true })
  assert.equal(ok.calls.update[0].values.status, 'closed')
  assert.equal(ok.calls.update[0].values.resolution_note, 'โอนคืนแล้ว')
  const gone = fakeManagerClient({ updateCount: 0 })
  assert.match((await closeReview(gone, { id: 'c2' }, 'x')).error, /เปลี่ยนไปแล้ว/)
})

test('การชำระที่แก้ได้: ยอดต้องมากกว่า 0 และแปลงยอดเป็นตัวเลข', () => {
  const list = paymentsOf(order('e1', { payments: [cash] }))
  assert.equal(paymentsError(list), '')
  assert.equal(paymentsError([{ amount: 0 }]), 'ยอดของทุกรายการต้องมากกว่า 0')
  assert.equal(paymentsError([{ amount: '' }]), 'ยอดของทุกรายการต้องมากกว่า 0')
  const next = withPayments(order('e1'), [{ id: 'p', amount: '80' }])
  assert.equal(next.payments[0].amount, 80)
  assert.deepEqual(list[0], cash) // ไม่แก้ค่าต้นฉบับ
})
