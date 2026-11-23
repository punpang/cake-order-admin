// ทดสอบแจ้งทีม (Telegram) ของ POS ที่ระดับ store จริง (โหลดผ่าน Vite SSR แบบเดียวกับแอป): ปิดบิล · มีส่วนลด · ยกเลิกบิลพร้อมคืนเงิน
// รัน: node src/data/posTeam.store.test.mjs
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { createServer } from 'vite'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const server = await createServer({ root: ROOT, server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' })
let fails = 0
try {
  const S = await server.ssrLoadModule('/src/data/store.js')
  const { db, openShift, posSale, voidPosSale } = S
  db.integrations.telegram.enabled = true
  openShift(0)
  const item = db.retailItems.find((x) => x.active !== false && (x.price > 0)) || db.retailItems[0]
  const cart = [{ kind: 'retail', refId: item.id, qty: 1 }]
  const team = (ev) => db.outbox.filter((m) => m.event === ev && m.channel === 'telegram')

  const cases = [
    ['ปิดบิล POS (เงินสด) → แจ้ง Telegram 1 ข้อความ มีพนักงาน/ยอด/วิธีชำระ', () => {
      db.outbox.length = 0
      const o = posSale({ cart, method: 'cash', received: 100000 })
      assert.ok(o, 'ขายไม่สำเร็จ')
      const m = team('team_pos_sale')
      assert.equal(m.length, 1)
      assert.match(m[0].text, /ปิดบิล POS/)
      assert.match(m[0].text, /พนักงาน แอดมิน/)
      assert.match(m[0].text, /เงินสด/)
      assert.doesNotMatch(m[0].text, /ส่วนลดหน้าร้าน/)
    }],
    ['ปิดบิลที่มีส่วนลดหน้าร้าน → ข้อความมีบรรทัดส่วนลด', () => {
      db.outbox.length = 0
      const o = posSale({ cart, discount: 1, method: 'cash', received: 100000 })
      assert.ok(o, 'ขายไม่สำเร็จ')
      assert.match(team('team_pos_sale')[0].text, /ส่วนลดหน้าร้าน/)
    }],
    ['ยกเลิกบิล POS พร้อมคืนเงิน → แจ้ง team_pos_cancel มีเหตุผลและยอดคืน', () => {
      const o = posSale({ cart, method: 'cash', received: 100000 })
      db.outbox.length = 0
      const r = voidPosSale(o, 'ลูกค้าขอยกเลิก', [{ method: 'cash', amount: o.payments.reduce((n, p) => n + p.amount, 0) }], '')
      assert.equal(r.error, undefined, String(r.error))
      const m = team('team_pos_cancel')
      assert.equal(m.length, 1)
      assert.match(m[0].text, /ยกเลิกบิล POS/)
      assert.match(m[0].text, /คืนเงิน/)
      assert.match(m[0].text, /ลูกค้าขอยกเลิก/)
    }],
    ['แลกสินค้า POS ที่มีคืนเงิน → แจ้ง team_pos_exchange (ไม่แจ้ง team_pos_sale ซ้ำสำหรับบิลใหม่)', () => {
      const first = posSale({ cart, method: 'cash', received: 100000 })
      db.outbox.length = 0
      const total = first.payments.reduce((n, p) => n + p.amount, 0)
      const r = S.exchangeSale({ order: first, returnItems: [{ id: first.items[0].id, qty: 1 }], restock: true, refunds: [{ method: 'cash', amount: total }], newCart: [{ kind: 'retail', refId: item.id, qty: 1 }], method: 'cash', received: 100000, reason: 'เปลี่ยนรส' })
      assert.equal(r.error, undefined, String(r.error))
      const m = team('team_pos_exchange')
      assert.equal(m.length, 1)
      assert.match(m[0].text, /แลกสินค้า POS/)
      assert.match(m[0].text, /บิลใหม่/)
      assert.equal(team('team_pos_sale').length, 0)
    }],
  ]
  for (const [name, fn] of cases) {
    try { fn(); console.log(`PASS ${name}`) } catch (e) { fails++; console.log(`FAIL ${name}: ${e.message}`) }
  }
} finally {
  await server.close()
}
if (fails) {
  console.log(`\n✗ ล้ม ${fails} ข้อ`)
  process.exit(1)
}
console.log('\n✓ ผ่านทั้งหมด')
