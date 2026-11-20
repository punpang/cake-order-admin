// ทดสอบการสร้างคูปองจากคะแนนโหมดจำลองที่ระดับ store จริง (โหลดผ่าน Vite SSR แบบเดียวกับ creditCoupons.store.test.mjs)
// รัน: node src/lib/pointsCouponActions.test.mjs
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { createServer } from 'vite'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const server = await createServer({ root: ROOT, server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' })
let fails = 0
const check = (name, fn) => {
  try { fn(); console.log('PASS', name) } catch (e) { fails++; console.log('FAIL', name, '—', e.message) }
}
try {
  const demo = await server.ssrLoadModule('/src/data/demo.js')
  const S = await server.ssrLoadModule('/src/data/store.js')
  const A = await server.ssrLoadModule('/src/lib/pointsCouponActions.js')
  const { toDateStr } = await server.ssrLoadModule('/src/lib/format.js')
  const { addDays, pointBalance } = await server.ssrLoadModule('/src/lib/loyalty.js')
  demo.seedDemo()
  const { db } = S
  const today = toDateStr(new Date())
  const lot = (n) => ({ id: `l${n}${Math.random()}`, at: new Date().toISOString(), delta: n, reason: 'ทดสอบ', orderId: null, remaining: n })
  const cust = (ledger) => ({ id: `pcT${Math.random()}`, name: 'ทดสอบ', ledger })
  db.coupons.length = 0

  db.loyalty.pointValue = 1
  const c1 = cust([lot(200)])
  const ok = A.makePointsCouponLocal(c1, 50)
  check('ค่าเริ่มต้น 1 บาท/คะแนน: 50 บาทสำเร็จ และคะแนนคงเหลือ 150', () => {
    assert.equal(ok.ok, true)
    assert.equal(pointBalance(c1.ledger, today), 150)
  })
  check('คูปองที่ออกมีฟิลด์ตามกติกา: fixed 50 บาท, source points_coupon, pending, หมดอายุ +15 วัน', () => {
    const cp = db.coupons[0]
    assert.equal(cp.mode, 'fixed'); assert.equal(cp.amount, 50); assert.equal(cp.source, 'points_coupon')
    assert.equal(cp.status, 'pending'); assert.equal(cp.points, 50); assert.equal(cp.customerId, c1.id)
    assert.equal(cp.expiresAt, addDays(today, 15))
  })
  check('มูลค่าไม่ใช่ทวีคูณ 10 → invalid และคะแนนไม่เปลี่ยน', () => {
    const c = cust([lot(200)])
    assert.equal(A.makePointsCouponLocal(c, 15).error, 'invalid')
    assert.equal(pointBalance(c.ledger, today), 200)
  })
  db.loyalty.pointValue = 3
  check('มูลค่าต่อคะแนน 3: 10 บาทไม่ลงตัว → not_divisible และคะแนนไม่เปลี่ยน', () => {
    const c = cust([lot(100)])
    assert.equal(A.makePointsCouponLocal(c, 10).error, 'not_divisible')
    assert.equal(pointBalance(c.ledger, today), 100)
  })
  check('มูลค่าต่อคะแนน 3: 30 บาท = 10 คะแนน สำเร็จ', () => {
    const c = cust([lot(100)])
    assert.equal(A.makePointsCouponLocal(c, 30).ok, true)
    assert.equal(pointBalance(c.ledger, today), 90)
  })
  db.loyalty.pointValue = 1
  check('คะแนนไม่พอ → insufficient', () => {
    const c = cust([lot(5)])
    assert.equal(A.makePointsCouponLocal(c, 50).error, 'insufficient')
    assert.equal(pointBalance(c.ledger, today), 5)
  })
} finally {
  await server.close()
}
console.log(fails ? `\nไม่ผ่าน ${fails} ข้อ` : '\nผ่านทั้งหมด')
process.exitCode = fails ? 1 : 0
