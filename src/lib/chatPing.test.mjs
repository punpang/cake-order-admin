// ทดสอบสัญญาณเรียลไทม์ของแชทลูกค้า (ไคลเอนต์ปลอม) · รัน: node src/lib/chatPing.test.mjs
import assert from 'node:assert/strict'
import { startChatPing, PING_EVENT, LIVE_POLL_MS } from './chatPing.js'

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
        on(type, filter, cb) { this.handlers.push({ type, filter, cb }); return this },
        subscribe(cb) { this.statusCb = cb; return this },
      }
      made.push(ch)
      return ch
    },
    removeChannel(ch) { removed.push(ch) },
  }
}

t('ไม่มีไคลเอนต์หรือไม่มีชื่อช่อง = ไม่เชื่อม และไม่พัง', () => {
  assert.equal(startChatPing(null, 'chat-x', () => {}).isLive(), false)
  assert.equal(startChatPing(fakeClient(), '', () => {}).isLive(), false)
})
t('SUBSCRIBED = เชื่อมอยู่ · สถานะอื่น = ไม่ถือว่าเชื่อม', () => {
  const c = fakeClient()
  const p = startChatPing(c, 'chat-abc', () => {})
  assert.equal(p.isLive(), false)
  c.made[0].statusCb('SUBSCRIBED')
  assert.equal(p.isLive(), true)
  c.made[0].statusCb('CHANNEL_ERROR')
  assert.equal(p.isLive(), false)
})
t('สัญญาณ msg เรียก onPing · เหตุการณ์อื่นไม่เรียก', () => {
  const c = fakeClient()
  let n = 0
  startChatPing(c, 'chat-abc', () => { n++ })
  const h = c.made[0].handlers[0]
  assert.equal(h.type, 'broadcast')
  assert.equal(h.filter.event, PING_EVENT)
  h.cb({})
  assert.equal(n, 1)
})
t('หยุดแล้วถอดช่อง ไม่เชื่อมอีก และไม่เรียก onPing', () => {
  const c = fakeClient()
  let n = 0
  const p = startChatPing(c, 'chat-abc', () => { n++ })
  c.made[0].statusCb('SUBSCRIBED')
  p.stop()
  c.made[0].statusCb('SUBSCRIBED') // ตอบกลับช้าหลังหยุดแล้ว ต้องไม่ทำให้กลับมาเชื่อม
  c.made[0].handlers[0].cb({})
  assert.equal(c.removed.length, 1)
  assert.equal(p.isLive(), false)
  assert.equal(n, 0)
})
t('โพลล์สำรองตอนเชื่อมอยู่ = 10 วินาที', () => {
  assert.equal(LIVE_POLL_MS, 10000)
})

if (fail) { console.log(`\nFAIL ${fail} รายการ`); process.exit(1) }
