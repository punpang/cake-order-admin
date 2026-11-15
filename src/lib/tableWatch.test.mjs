// ทดสอบตัวฟังตาราง (ไคลเอนต์ปลอม) · รัน: node src/lib/tableWatch.test.mjs
import assert from 'node:assert/strict'
import { startTableWatch } from './tableWatch.js'

let fail = 0
const t = (name, fn) => { try { fn(); console.log(`PASS ${name}`) } catch (e) { fail++; console.log(`FAIL ${name}: ${e.message}`) } }

// ไคลเอนต์ปลอม: จำช่องที่ขอ ตัวจัดการเหตุการณ์ และช่องที่ถูกถอด
function fakeClient() {
  const made = []
  const removed = []
  return {
    made, removed,
    channel(name) {
      const ch = {
        name, handlers: [], statusCb: null,
        on(type, cfg, cb) { this.handlers.push({ type, cfg, cb }); return this },
        subscribe(cb) { this.statusCb = cb; return this },
      }
      made.push(ch)
      return ch
    },
    removeChannel(ch) { removed.push(ch) },
  }
}

t('ไม่มีไคลเอนต์ = ไม่เชื่อม และไม่พัง', () => {
  const w = startTableWatch(null, { table: 'x' }, () => {})
  assert.equal(w.isLive(), false)
  w.stop()
})
t('ตาราง/เหตุการณ์/ตัวกรอง ถูกส่งให้ช่องสัญญาณ', () => {
  const c = fakeClient()
  startTableWatch(c, { table: 'punpang_chat_presence', event: '*', filter: 'chat_id=eq.ch1' }, () => {})
  const h = c.made[0].handlers[0]
  assert.equal(h.type, 'postgres_changes')
  assert.deepEqual(h.cfg, { event: '*', schema: 'public', table: 'punpang_chat_presence', filter: 'chat_id=eq.ch1' })
})
t('ไม่มีตัวกรอง = ไม่ส่งคีย์ filter', () => {
  const c = fakeClient()
  startTableWatch(c, { table: 'tungngern_transfers', event: 'INSERT' }, () => {})
  assert.deepEqual(c.made[0].handlers[0].cfg, { event: 'INSERT', schema: 'public', table: 'tungngern_transfers' })
})
t('เหตุการณ์เข้า → onChange รับ payload · SUBSCRIBED = เชื่อม · CLOSED = หลุด', () => {
  const c = fakeClient()
  const got = []
  const w = startTableWatch(c, { table: 't' }, (p) => got.push(p))
  assert.equal(w.isLive(), false)
  c.made[0].statusCb('SUBSCRIBED')
  assert.equal(w.isLive(), true)
  c.made[0].handlers[0].cb({ new: { id: 1 } })
  assert.deepEqual(got, [{ new: { id: 1 } }])
  c.made[0].statusCb('CLOSED')
  assert.equal(w.isLive(), false)
})
t('หยุดแล้วถอดช่อง และไม่รับเหตุการณ์/สถานะอีก', () => {
  const c = fakeClient()
  let n = 0
  const w = startTableWatch(c, { table: 't' }, () => { n++ })
  c.made[0].statusCb('SUBSCRIBED')
  w.stop()
  c.made[0].statusCb('SUBSCRIBED')
  c.made[0].handlers[0].cb({})
  assert.equal(c.removed.length, 1)
  assert.equal(w.isLive(), false)
  assert.equal(n, 0)
})
t('เปิดหลายตัว → ชื่อช่องไม่ซ้ำ', () => {
  const c = fakeClient()
  startTableWatch(c, { table: 't' }, () => {})
  startTableWatch(c, { table: 't' }, () => {})
  assert.notEqual(c.made[0].name, c.made[1].name)
})

if (fail) { console.log(`\nFAIL ${fail} รายการ`); process.exit(1) }
