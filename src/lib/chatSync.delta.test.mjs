// ทดสอบแชทแบบดึงเฉพาะที่เปลี่ยน: ดึงเฉพาะแถวที่แก้ · แชทที่มีข้อความใหม่ขึ้นบนสุด · บอทถูกเรียก · บันทึกครั้งถัดไปใช้เวอร์ชันใหม่ (ไม่ชน)
// รัน: node src/lib/chatSync.delta.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { startChatSync, RECENT_CHATS } from './chatSync.js'

// เซิร์ฟเวอร์จำลอง (เฉพาะคำสั่งที่ตัวซิงก์แชท/ใบเสนอใช้) · นับแถวที่ส่งออก · จดเวอร์ชันที่ใช้ตอนแก้แถว
function fakeServer(rows) {
  const tables = { punpang_chats: rows, punpang_quotes: [] }
  const log = { sent: 0, updates: [] }
  let clock = Date.parse('2026-11-19T10:00:00Z')
  const tick = () => new Date((clock += 1000)).toISOString()
  const from = (table) => {
    const f = []
    const ord = []
    let lim = null
    let upd = null
    let sel = false
    const run = (a = 0, b = Infinity) => {
      let r = tables[table].filter((x) => f.every((g) => g(x)))
      if (upd) {
        const out = []
        for (const x of r) { Object.assign(x, upd, { updated_at: tick() }); out.push({ updated_at: x.updated_at }) }
        log.updates.push({ table, n: out.length })
        return { data: sel ? out : null, error: null }
      }
      for (const [c, asc] of [...ord].reverse()) r = [...r].sort((p, q) => (String(p[c]) < String(q[c]) ? -1 : String(p[c]) > String(q[c]) ? 1 : 0) * (asc ? 1 : -1))
      if (lim != null) r = r.slice(0, lim)
      r = r.slice(a, b + 1)
      if (table === 'punpang_chats') log.sent += r.length
      return { data: r.map((x) => ({ ...x })), error: null }
    }
    const q = {
      select() { sel = true; return q },
      update(cols) { upd = cols; sel = false; return q },
      eq(c, v) { f.push((x) => x[c] === v); if (c === 'updated_at') log.updates.push({ ver: v }); return q },
      in(c, v) { f.push((x) => v.includes(x[c])); return q },
      gte(c, v) { f.push((x) => String(x[c]) >= v); return q },
      order(c, o) { ord.push([c, o?.ascending !== false]); return q },
      limit(n) { lim = n; return q },
      range(a, b) { return Promise.resolve(run(a, b)) },
      maybeSingle() { const r = run(); return Promise.resolve({ data: r.data?.[0] || null, error: null }) },
      then(res, rej) { return Promise.resolve(run()).then(res, rej) },
    }
    return q
  }
  return { client: { from }, tables, log, tick }
}
const iso = (n) => new Date(Date.UTC(2026, 10, 1) + n * 60000).toISOString()
const chatRow = (i) => ({ id: `ch${i}`, channel: 'facebook', external_id: `p${i}`, customer_id: null, data: { profileName: `ลูกค้า ${i}`, messages: [], unreadStaff: 0, updatedAt: iso(i) }, updated_at: iso(i) })

test('แชทที่มีข้อความลูกค้าใหม่: ดึงเฉพาะที่เปลี่ยน · ขึ้นบนสุด · เรียกบอท · บันทึกต่อใช้เวอร์ชันใหม่', async () => {
  const srv = fakeServer(Array.from({ length: 200 }, (_, i) => chatRow(i)))
  const db = { chats: [], quotes: [] }
  const inbound = []
  const [h] = await startChatSync({ client: srv.client, db, canWrite: true, debounceMs: 5, onError: (m) => { throw new Error(m) }, onInbound: (chatId, mid) => inbound.push([chatId, mid]) })
  assert.equal(db.chats.length, RECENT_CHATS)
  assert.equal(db.chats[0].id, 'ch199')

  // เซิร์ฟเวอร์ (webhook) ได้ข้อความใหม่ในแชทกลางรายการ
  const row = srv.tables.punpang_chats.find((x) => x.id === 'ch100')
  const at = new Date().toISOString()
  row.data = { ...row.data, messages: [{ id: 'm1', from: 'customer', text: 'สวัสดีค่ะ', fbMid: 'mid-1', at }], unreadStaff: 1, updatedAt: at }
  row.updated_at = srv.tick()
  srv.log.sent = 0
  assert.equal(await h.refresh(), true)
  await new Promise((r) => setTimeout(r, 20))

  assert.ok(srv.log.sent < 10, `ดึง ${srv.log.sent} แถว (ไม่ใช่ทั้ง ${RECENT_CHATS})`)
  assert.equal(db.chats[0].id, 'ch100', 'แชทที่มีข้อความใหม่ขึ้นบนสุด')
  assert.equal(db.chats[0].messages.length, 1)
  assert.deepEqual(inbound, [['ch100', 'mid-1']], 'บอทถูกเรียกกับข้อความใหม่')

  // พนักงานอ่านแชท → บันทึกต้องใช้เวอร์ชันล่าสุด (ถ้ายังเป็นเวอร์ชันเก่าจะชนและแจ้งข้อผิดพลาด)
  srv.log.updates.length = 0
  db.chats[0].unreadStaff = 0
  assert.equal(await h.flush(), true)
  assert.ok(srv.log.updates.some((u) => u.ver === row.updated_at || u.table), 'ส่งแก้แถว')
  assert.equal(srv.log.updates.filter((u) => u.ver).length, 1, 'แก้ได้ในครั้งเดียว (ไม่ต้องรวมแล้วลองใหม่)')
})

// ตัวซิงก์แชทตั้งรอบล้างข้อความเก่า (setInterval 6 ชม.) เมื่อเขียนได้ → ปิดโปรเซสเมื่อเทสต์จบ
test.after(() => setImmediate(() => process.exit(process.exitCode || 0)))
