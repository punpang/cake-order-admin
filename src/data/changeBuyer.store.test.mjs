// ทดสอบเปลี่ยนผู้ซื้อของออร์เดอร์ที่มีคะแนนค้าง (ระดับ store จริง) · โหมดเซิร์ฟเวอร์ต้องคืนคะแนนผ่าน RPC punpang_remove_points "ก่อน" เปลี่ยนผู้ซื้อเสมอ
// กติกาฝั่งฐานข้อมูลอยู่ที่ supabase/tests/points_clear_guard.test.sql
// รัน: node src/data/changeBuyer.store.test.mjs
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { createServer } from 'vite'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const server = await createServer({ root: ROOT, server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' })
let fails = 0
try {
  const demo = await server.ssrLoadModule('/src/data/demo.js')
  const S = await server.ssrLoadModule('/src/data/store.js')
  demo.seedDemo()
  const { db, addCustomer, changeBuyer, pointsHook } = S
  let seq = 0
  // ผู้ซื้อเดิม: ก้อนคะแนน 100 (เหลือ 60) และรายการใช้ 40 ที่ยังไม่คืน
  const buyerWithSpend = () => {
    const n = ++seq
    const c = addCustomer({ name: 'ผู้ซื้อเดิม ' + n, phone: '0877' + String(100000 + n) })
    c.ledger = [
      { id: 'pl' + n, at: new Date().toISOString(), delta: 100, remaining: 60, expiresAt: '2099-01-01', reason: 'ซื้อ' },
      { id: 'ps' + n, at: new Date().toISOString(), delta: -40, reason: 'ใช้คะแนนลดราคา', orderId: null, takes: [{ lotId: 'pl' + n, n: 40 }] },
    ]
    return c
  }
  const newBuyer = () => { const n = ++seq; return addCustomer({ name: 'ผู้ซื้อใหม่ ' + n, phone: '0866' + String(100000 + n) }) }
  const spendOf = (c) => ({ points: 40, amount: 40, entryId: c.ledger[1].id })
  const mkOrder = (customerId, pointsUsed) => {
    const o = { id: 'cb' + ++seq, code: 'CB-' + seq, createdAt: new Date().toISOString(), customerId, channel: 'web', items: [{ id: 'i1', name: 'เค้ก', unitPrice: 100, qty: 1 }], couponsUsed: [], payments: [], adjustment: { amount: 0, reason: '' }, fulfillment: 'pickup', shippingFee: 0, vat: undefined, pointsUsed, history: [], status: 'awaiting_payment', loyalty: null }
    db.orders.unshift(o)
    return o
  }
  const calls = []
  const check = async (name, fn) => {
    pointsHook.call = null
    calls.length = 0
    try { await fn(); console.log('PASS ' + name) } catch (e) { fails++; console.log('FAIL ' + name + ' — ' + e.message) } finally { pointsHook.call = null }
  }

  await check('โหมดเซิร์ฟเวอร์: คืนคะแนนก่อนเปลี่ยนผู้ซื้อ และเปลี่ยนในอ็อบเจกต์ที่อยู่ในรายการหลังรีเฟรช', async () => {
    const from = buyerWithSpend(), to = newBuyer()
    const o = mkOrder(from.id, spendOf(from))
    let buyerSeenByRpc = null
    pointsHook.call = async (fn, args, ids) => {
      calls.push({ fn, args, ids })
      buyerSeenByRpc = db.orders.find((x) => x.id === o.id).customerId
      // จำลองการรีเฟรชแถวจากเซิร์ฟเวอร์: แทนที่อ็อบเจกต์ในรายการ (เหมือน tableSync.mergeRows)
      db.orders.splice(db.orders.findIndex((x) => x.id === o.id), 1, { ...o, pointsUsed: null, history: [...o.history] })
      return { ok: true }
    }
    const r = await changeBuyer(o, to.id, 'ทดสอบ')
    assert.equal(r.ok, true)
    assert.deepEqual(calls.map((c) => c.fn), ['punpang_remove_points'])
    assert.deepEqual(calls[0].args, { p_order: o.id })
    assert.deepEqual(calls[0].ids, { order: o.id, customer: from.id })
    assert.equal(buyerSeenByRpc, from.id, 'ต้องคืนคะแนนก่อนเปลี่ยนผู้ซื้อ')
    const cur = db.orders.find((x) => x.id === o.id)
    assert.equal(cur.customerId, to.id, 'การเปลี่ยนผู้ซื้อต้องอยู่ในอ็อบเจกต์ที่อยู่ในรายการ')
    assert.equal(cur.pointsUsed, null)
  })

  await check('โหมดเซิร์ฟเวอร์: คืนคะแนนไม่สำเร็จ → ไม่เปลี่ยนผู้ซื้อ และคะแนนยังอยู่ในออร์เดอร์', async () => {
    const from = buyerWithSpend(), to = newBuyer()
    const o = mkOrder(from.id, spendOf(from))
    pointsHook.call = async (fn) => { calls.push(fn); return { error: 'invalid' } }
    const r = await changeBuyer(o, to.id)
    assert.ok(r.error)
    assert.equal(o.customerId, from.id)
    assert.deepEqual(o.pointsUsed, spendOf(from))
    assert.equal(calls.length, 1)
  })

  await check('โหมดเซิร์ฟเวอร์: เครือข่ายขัดข้อง → ไม่เปลี่ยนผู้ซื้อ และไม่โยนข้อผิดพลาดออกไป', async () => {
    const from = buyerWithSpend(), to = newBuyer()
    const o = mkOrder(from.id, spendOf(from))
    pointsHook.call = async () => { throw new Error('เครือข่ายขัดข้อง') }
    const r = await changeBuyer(o, to.id)
    assert.equal(r.error, 'เครือข่ายขัดข้อง')
    assert.equal(o.customerId, from.id)
    assert.notEqual(o.pointsUsed, null)
  })

  await check('โหมดเซิร์ฟเวอร์: คะแนนถูกคืนไปแล้ว (none) → เปลี่ยนผู้ซื้อได้', async () => {
    const from = buyerWithSpend(), to = newBuyer()
    const o = mkOrder(from.id, spendOf(from))
    pointsHook.call = async () => ({ error: 'none' })
    const r = await changeBuyer(o, to.id)
    assert.equal(r.ok, true)
    assert.equal(o.customerId, to.id)
    assert.equal(o.pointsUsed, null)
  })

  await check('ไม่มีคะแนนค้าง: ไม่เรียกเซิร์ฟเวอร์ และเปลี่ยนผู้ซื้อได้', async () => {
    const from = buyerWithSpend(), to = newBuyer()
    const o = mkOrder(from.id, null)
    pointsHook.call = async (fn) => { calls.push(fn); return {} }
    const r = await changeBuyer(o, to.id)
    assert.equal(r.ok, true)
    assert.equal(calls.length, 0)
    assert.equal(o.customerId, to.id)
  })

  await check('โหมดเครื่องเดียว: คืนคะแนนในเครื่องให้ผู้ซื้อเดิม แล้วเปลี่ยนผู้ซื้อ', async () => {
    const from = buyerWithSpend(), to = newBuyer()
    const o = mkOrder(from.id, spendOf(from))
    const r = await changeBuyer(o, to.id)
    assert.equal(r.ok, true)
    assert.equal(from.ledger[0].remaining, 100)
    assert.equal(o.customerId, to.id)
    assert.equal(o.pointsUsed, null)
  })
} catch (e) {
  fails++
  console.log('ERROR', e?.stack || e)
} finally {
  await server.close()
}
console.log(fails ? `ไม่ผ่าน ${fails} กรณี` : 'ผ่านทุกกรณี')
process.exitCode = fails ? 1 : 0
