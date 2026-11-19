// ทดสอบการดึงเฉพาะแถวที่เปลี่ยน (delta) ของ startSync · รัน: node src/lib/tableSync.delta.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { startSync, fillArray, syncMetrics, withVer, FULL_EVERY_MS } from './tableSync.js'

// เซิร์ฟเวอร์จำลอง: แถว { id, status, n } + updated_at · นับจำนวนแถวที่ส่งออกไปทั้งหมด
function fakeServer(count) {
  let clock = Date.parse('2026-11-19T00:00:00Z')
  const tick = () => new Date((clock += 1000)).toISOString()
  const rows = new Map()
  for (let i = 0; i < count; i++) rows.set('r' + i, { id: 'r' + i, status: 'open', n: 0, updated_at: tick() })
  const out = (r) => withVer({ id: r.id, status: r.status, n: r.n }, r.updated_at)
  const srv = {
    sent: 0,
    update(id, patch) { Object.assign(rows.get(id), patch, { updated_at: tick() }) },
    remove(id) { rows.delete(id) },
    load: async ({ open = true } = {}) => { const items = [...rows.values()].filter((r) => !open || r.status === 'open').map(out); srv.sent += items.length; return { items } },
    loadSince: async (since) => { const items = [...rows.values()].filter((r) => Date.parse(r.updated_at) >= Date.parse(since)).map(out); srv.sent += items.length; return { items } },
  }
  return srv
}
function sync(srv, opts = {}) {
  const local = []
  let t = 0
  return startSync({
    list: () => local, replace: (items) => fillArray(local, items),
    load: () => srv.load(), loadSince: (s) => srv.loadSince(s),
    keep: (r) => r.status === 'open', canWrite: false, poll: true, label: opts.label || 'ทดสอบ',
    now: () => t, ...opts,
  }).then((h) => ({ h, local, advance: (ms) => { t += ms } }))
}

test('ช่วง 0: 100,000 แถว — โหลดเต็มส่ง 100,000 แถว · ดึงเฉพาะที่เปลี่ยนส่งแค่แถวในช่วงเผื่อเวลา', async () => {
  const srv = fakeServer(100000)
  const { h, local } = await sync(srv, { label: 'วัด100k' })
  assert.equal(local.length, 100000)
  assert.equal(srv.sent, 100000)
  srv.sent = 0
  srv.update('r5', { n: 1 })
  srv.update('r6', { n: 2 })
  assert.equal(await h.refresh(), true)
  // ส่งเฉพาะแถวที่แก้ + แถวท้าย ๆ ที่อยู่ในช่วงเผื่อ 2 นาที (เวลาจำลองห่างกันแถวละ 1 วินาที)
  assert.ok(srv.sent <= 125, `ส่ง ${srv.sent} แถว`)
  assert.equal(local.find((r) => r.id === 'r5').n, 1)
  assert.equal(syncMetrics['วัด100k'].delta.count, 1)
  console.log('100k: โหลดเต็ม =', syncMetrics['วัด100k'].full.rows, 'แถว · delta =', syncMetrics['วัด100k'].delta.rows, 'แถว')
})

test('แถวที่ปิดแล้ว (keep = false) ถูกเอาออกจากเครื่อง · แถวใหม่ถูกเพิ่ม', async () => {
  const srv = fakeServer(10)
  const { h, local } = await sync(srv)
  srv.update('r2', { status: 'closed' })
  await h.refresh()
  assert.equal(local.some((r) => r.id === 'r2'), false)
  assert.equal(local.length, 9)
})

test('full: true และครบเวลา FULL_EVERY_MS → โหลดเต็ม (เก็บแถวที่ถูกลบ)', async () => {
  const srv = fakeServer(10)
  const { h, local, advance } = await sync(srv)
  srv.remove('r3')
  await h.refresh() // delta ไม่รู้ว่าถูกลบ
  assert.equal(local.length, 10)
  await h.refresh({ full: true })
  assert.equal(local.length, 9)
  srv.remove('r4')
  advance(FULL_EVERY_MS + 1)
  await h.refresh() // ครบรอบโหลดเต็มอัตโนมัติ
  assert.equal(local.length, 8)
})

test('ไม่มี loadSince = โหลดเต็มทุกครั้งเหมือนเดิม', async () => {
  const srv = fakeServer(5)
  const { h } = await sync(srv, { loadSince: null })
  srv.sent = 0
  srv.update('r1', { n: 9 })
  await h.refresh()
  assert.equal(srv.sent, 5)
})

test('fillArray: 300,000 รายการ ไม่ล้น call stack (splice แบบ spread ล้น)', () => {
  const big = Array.from({ length: 300000 }, (_, i) => ({ id: i }))
  const arr = [1, 2, 3]
  fillArray(arr, big, [{ id: 'x' }])
  assert.equal(arr.length, 300001)
  assert.throws(() => { const a = []; a.splice(0, 0, ...Array.from({ length: 300000 }, (_, i) => i)) }, RangeError)
})
