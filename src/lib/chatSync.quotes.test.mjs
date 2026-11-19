// ทดสอบการโหลดใบเสนอเฉพาะที่ใช้ · รัน: node src/lib/chatSync.quotes.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { loadQuotesFor, OPEN_QUOTE_STATUSES, searchQuoteChatIds } from './chatSync.js'

function fakeClient(rows) {
  const from = () => {
    const f = []
    const api = {
      select() { return api },
      in(c, v) { f.push((r) => v.includes(r[c])); return api },
      gte(c, v) { f.push((r) => r[c] >= v); return api },
      ilike(c, v) { const t = v.replace(/%/g, '').toLowerCase(); f.push((r) => String(r[c]).toLowerCase().includes(t)); return api },
      order() { return api },
      limit() { return Promise.resolve({ data: rows.filter((r) => f.every((x) => x(r))), error: null }) },
      range(a, b) { return Promise.resolve({ data: rows.filter((r) => f.every((x) => x(r))).slice(a, b + 1), error: null }) },
    }
    return api
  }
  return { from }
}
const q = (id, chat, status) => ({ id, code: 'QT-' + id, chat_id: chat, customer_id: null, status, order_id: null, data: { createdAt: '2026-11-1' + id.slice(-1) }, updated_at: '2026-11-19T00:00:00Z' })
const rows = [q('q1', 'ch1', 'accepted'), q('q2', 'ch2', 'accepted'), q('q3', 'ch9', 'customer_ok'), q('q4', 'ch8', 'superseded'), q('q5', 'ch7', 'pending')]

test('โหลดใบเสนอของแชทที่อยู่ในเครื่อง + ที่ยังต้องดำเนินการ ไม่โหลดทั้งหมด', async () => {
  const r = await loadQuotesFor(fakeClient(rows), ['ch1'])
  const ids = r.items.map((x) => x.id).sort()
  assert.deepEqual(ids, ['q1', 'q3', 'q5']) // q1 = แชทในเครื่อง · q3/q5 = ยังต้องดำเนินการ · q2/q4 = แชทอื่นที่ปิดแล้ว
  assert.ok(r.items.every((x) => x._v), 'มีเวอร์ชัน (ใช้ดึงเฉพาะที่เปลี่ยน)')
  assert.ok(OPEN_QUOTE_STATUSES.includes('customer_ok'), 'ลูกค้ากดยืนยันแล้วต้องถูกโหลดเสมอ')
})

test('แชทเก่าที่เพิ่งเปิด: โหลดใบเสนอของแชทนั้นอย่างเดียว', async () => {
  const r = await loadQuotesFor(fakeClient(rows), ['ch8'], { open: false })
  assert.deepEqual(r.items.map((x) => x.id), ['q4'])
})

test('ค้นด้วยเลขใบเสนอ → ได้แชทของใบเสนอนั้น', async () => {
  assert.deepEqual((await searchQuoteChatIds(fakeClient(rows), 'qt-q4')).ids, ['ch8'])
  assert.deepEqual((await searchQuoteChatIds(fakeClient(rows), 'q')).ids, [])
})
