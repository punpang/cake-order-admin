// ทดสอบคูปองคืนเงิน/แปลงคะแนน/คะแนนค้างที่ระดับ store จริง (โหลดผ่าน Vite SSR แบบเดียวกับแอป)
// เส้นทางที่แตะเซิร์ฟเวอร์ใช้ couponHook แบบจำลองในไฟล์นี้ · กติกาฝั่งฐานข้อมูลทดสอบที่ supabase/tests/credit_coupons.test.sql
// รัน: node src/data/creditCoupons.store.test.mjs
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { createServer } from 'vite'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const DAY = 86400000
const server = await createServer({ root: ROOT, server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' })
let fails = 0
try {
  const demo = await server.ssrLoadModule('/src/data/demo.js')
  const S = await server.ssrLoadModule('/src/data/store.js')
  const { orderTotals } = await server.ssrLoadModule('/src/lib/pricing.js')
  const { couponQuoteOf } = await server.ssrLoadModule('/src/lib/coupons.js')
  demo.seedDemo()
  const { db, session, can, customerPoints, refundOrder, cancelRefund, applyCoupon, removeCoupon, claimAndApplyCoupon, claimPosCoupons, releaseCoupons, convertPointsRemote, applyPointsRemote, removePointsRemote, adjustPoints, redeemReward, spinGacha, addCustomer, openShift, posSale, editPosPending, posItems, couponHook, saveOrderItem, CONVERT_DAYS } = S

  // ---------- ตัวช่วย ----------
  const future = () => new Date(Date.now() + DAY).toISOString()
  const past = () => new Date(Date.now() - DAY).toISOString()
  let seq = 0
  const lot = (n, expiresAt = '2099-01-01') => ({ id: 'tl' + ++seq, at: new Date().toISOString(), delta: n, reason: 'ทดสอบ', orderId: null, expiresAt, remaining: n })
  const newCustomer = (ledger = []) => {
    const c = addCustomer({ name: 'ลูกค้าทดสอบ ' + ++seq, phone: '0899' + String(100000 + seq) })
    c.ledger = ledger
    return c
  }
  const creditCoupon = (customerId, balance) => {
    const cp = { id: 'cc' + ++seq, customerId, type: 'discount', mode: 'credit', name: 'คูปองคืนเงินทดสอบ', amount: balance, balance, holds: {}, status: 'pending', expiresAt: null, activatedUntil: null, source: 'refund', createdAt: new Date().toISOString() }
    db.coupons.unshift(cp)
    return cp
  }
  const paidOrder = (min) => db.orders.find((o) => o.customerId && !['draft', 'cancelled'].includes(o.status) && !(o.returns || []).length && orderTotals(o).paidNet > min)
  const tmplAll = db.orders.flatMap((o) => o.items || []).filter((i) => i.kind === 'retail' && i.retailId && !i.promoGift && Number(i.unitPrice) > 0)
  const tmpl = [...tmplAll].sort((a, b) => a.unitPrice - b.unitPrice)[0]
  const mkOrder = (id, customerId, qty, item = tmpl) => ({ id, code: id, createdAt: new Date().toISOString(), customerId, channel: 'web', items: [{ ...item, id: 'i1', qty }], couponsUsed: [], payments: [], adjustment: { amount: 0, reason: '' }, fulfillment: 'pickup', shippingFee: 0, vat: undefined, pointsUsed: null, history: [], status: 'draft' })
  const totalOf = (o) => orderTotals({ ...o, couponsUsed: [] }).total
  // เซิร์ฟเวอร์จำลองสำหรับคูปองคืนเงิน: กติกาเดียวกับ punpang_hold_credit / punpang_release_coupon (ทำทีละคำขอ)
  const fakeCreditServer = () => {
    const bal = {}, holds = {}, calls = []
    return {
      bal, holds, calls,
      seed: (cp) => { bal[cp.id] = cp.balance; holds[cp.id] = {} },
      claim: async (cid, oid, amount) => {
        calls.push({ cid, oid, amount })
        if (amount == null) return 'ok'
        if (!(cid in bal)) return 'missing'
        if (oid in holds[cid]) return holds[cid][oid] === amount ? 'ok' : 'invalid'
        if (amount > bal[cid]) return 'insufficient'
        bal[cid] -= amount
        holds[cid][oid] = amount
        return 'ok'
      },
      release: async (cid, oid) => {
        calls.push({ release: true, cid, oid })
        if (cid in holds && oid in holds[cid]) { bal[cid] += holds[cid][oid]; delete holds[cid][oid] }
      },
    }
  }
  const withServer = async (fn) => {
    const srv = fakeCreditServer()
    const prev = { claim: couponHook.claim, release: couponHook.release }
    Object.assign(couponHook, { claim: srv.claim, release: srv.release })
    try { await fn(srv) } finally { Object.assign(couponHook, prev) }
  }

  // ---------- เคส ----------
  const cases = []
  const t = (name, fn) => cases.push([name, fn])

  // A) คืนเป็นคูปอง
  t('คืนเป็นคูปองคืนเงิน 50 บาท: ได้คูปองยอด 50 ไม่มีวันหมดอายุ ผูกกับลูกค้าของออร์เดอร์', () => {
    const order = paidOrder(500)
    assert.ok(order, 'ไม่มีออร์เดอร์ตัวอย่างที่ผูกลูกค้าและจ่ายแล้ว')
    const r = refundOrder(order, { reason: 'ทดสอบคืนเป็นคูปอง', refunds: [{ method: 'credit', amount: 50 }], notify: false, sms: false })
    assert.equal(r.ok, true, r.error)
    const cp = db.coupons.find((x) => x.id === r.entry.refunds[0].couponId)
    assert.deepEqual([cp.mode, cp.balance, cp.expiresAt, cp.customerId], ['credit', 50, null, order.customerId])
  })

  t('ยกเลิกการคืนที่ยังไม่ถูกใช้ → คูปองเป็น void และยอดเป็น 0', () => {
    const order = paidOrder(500)
    const r = refundOrder(order, { reason: 'ทดสอบยกเลิก', refunds: [{ method: 'credit', amount: 50 }], notify: false, sms: false })
    const cp = db.coupons.find((x) => x.id === r.entry.refunds[0].couponId)
    const c = cancelRefund(order, r.entry.id, { reason: 'ทดสอบยกเลิกการคืน' })
    assert.equal(c.ok, true, c.error)
    assert.deepEqual([cp.status, cp.balance], ['void', 0])
  })

  t('ยกเลิกการคืนไม่ได้เมื่อคูปองคืนเงินถูกใช้หรือจองแล้ว และคืนยอดกลับได้เมื่อเอาคูปองออก', () => {
    const order = paidOrder(500)
    const r = refundOrder(order, { reason: 'ทดสอบ', refunds: [{ method: 'credit', amount: 120 }], notify: false, sms: false })
    const cp = db.coupons.find((x) => x.id === r.entry.refunds[0].couponId)
    const o = mkOrder('A3', order.customerId, 1)
    applyCoupon(o, cp.id)
    assert.ok(o.couponsUsed.length === 1, 'ใช้คูปองกับออร์เดอร์ไม่ได้')
    assert.ok(cancelRefund(order, r.entry.id, { reason: 'ควรถูกปฏิเสธ' }).error, 'ยกเลิกการคืนทั้งที่คูปองถูกจองอยู่')
    removeCoupon(o, cp.id)
    assert.equal(cp.balance, 120)
    assert.equal(Object.keys(cp.holds).length, 0)
    assert.equal(cp.status, 'pending')
  })

  // B) ใช้คูปองคืนเงิน
  t('ยอดบิลน้อยกว่าคูปอง → ตัดเท่ายอดบิล ยอดที่เหลือยังอยู่ในคูปอง', () => {
    const cu = newCustomer()
    const o = mkOrder('B1', cu.id, 1)
    const total = totalOf(o)
    const cp = creditCoupon(cu.id, total + 100)
    assert.equal(applyCoupon(o, cp.id), true)
    assert.equal(o.couponsUsed[0].amount, total)
    assert.equal(cp.balance, 100)
    assert.equal(cp.holds.B1, total)
  })

  t('ใช้จนหมดยอด → สถานะ used ใช้กับออร์เดอร์อื่นไม่ได้ และคืนยอดเมื่อเอาออกจากออร์เดอร์แรก', () => {
    const cu = newCustomer()
    const o1 = mkOrder('B2a', cu.id, 1)
    const total = totalOf(o1)
    const cp = creditCoupon(cu.id, total)
    applyCoupon(o1, cp.id)
    assert.deepEqual([cp.balance, cp.status], [0, 'used'])
    const o2 = mkOrder('B2b', cu.id, 1)
    applyCoupon(o2, cp.id)
    assert.equal(o2.couponsUsed.length, 0, 'คูปองที่ยอดหมดแล้วยังถูกใช้กับออร์เดอร์ใหม่')
    removeCoupon(o1, cp.id)
    assert.deepEqual([cp.balance, cp.status], [total, 'pending'])
  })

  t('แก้จำนวนสินค้าให้ยอดลด → ยอดจองลดตาม ส่วนเกินคืนเข้าคูปอง', () => {
    const cu = newCustomer()
    const qtyBig = Math.ceil(600 / Number(tmpl.unitPrice))
    const o = mkOrder('B4', cu.id, qtyBig)
    const cp = creditCoupon(cu.id, 500)
    applyCoupon(o, cp.id)
    assert.equal(o.couponsUsed[0].amount, Math.min(500, totalOf(o)))
    saveOrderItem(o, { ...tmpl, id: 'i1', qty: 2 })
    const want = Math.min(500, totalOf(o))
    assert.equal(o.couponsUsed[0].amount, want)
    assert.equal(cp.holds.B4, want)
    assert.equal(cp.balance, 500 - want)
    removeCoupon(o, cp.id)
    assert.equal(cp.balance, 500)
  })

  t('POS 2 เครื่องใช้คูปองคืนเงินใบเดียว: เครื่องที่จองทีหลังถูกปฏิเสธ ยอดไม่ติดลบ และจองใหม่ด้วยยอดที่เหลือได้', async () => {
    const cu = newCustomer()
    const cp = creditCoupon(cu.id, 500)
    cp.activatedUntil = future()
    await withServer(async (srv) => {
      srv.seed(cp)
      const a = await claimPosCoupons([cp.id], { orderId: 'BILL-A', amounts: { [cp.id]: 300 } })
      assert.equal(a.ok, true)
      const b = await claimPosCoupons([cp.id], { orderId: 'BILL-B', amounts: { [cp.id]: 300 } })
      assert.match(b.error, /ไม่พอ/)
      assert.equal(srv.bal[cp.id], 200)
      assert.equal('BILL-B' in srv.holds[cp.id], false)
      const b2 = await claimPosCoupons([cp.id], { orderId: 'BILL-B', amounts: { [cp.id]: 200 } })
      assert.equal(b2.ok, true)
      assert.equal(srv.bal[cp.id], 0)
    })
  })

  t('POS ไม่ส่งยอดคูปองคืนเงิน → ปฏิเสธก่อนเรียกเซิร์ฟเวอร์', async () => {
    const cu = newCustomer()
    const cp = creditCoupon(cu.id, 500)
    await withServer(async (srv) => {
      srv.seed(cp)
      const r = await claimPosCoupons([cp.id], { orderId: 'BILL-C', amounts: {} })
      assert.ok(r.error)
      assert.equal(srv.calls.length, 0)
    })
  })

  t('คูปองแบบเดิม (ไม่ใช่คืนเงิน) จองโดยไม่ส่งยอด', async () => {
    const cu = newCustomer()
    const fixed = { id: 'cc' + ++seq, customerId: cu.id, type: 'discount', mode: 'fixed', name: 'ลด 50', amount: 50, minSpend: 0, status: 'pending', expiresAt: null, createdAt: new Date().toISOString() }
    db.coupons.unshift(fixed)
    await withServer(async (srv) => {
      const r = await claimPosCoupons([fixed.id], { orderId: 'BILL-F', amounts: {} })
      assert.equal(r.ok, true)
      assert.equal(srv.calls[0].amount, null)
    })
  })

  t('ปล่อยการจองด้วยรหัสบิลเดิมเมื่อขายไม่สำเร็จ → ยอดกลับเข้าคูปอง', async () => {
    const cu = newCustomer()
    const cp = creditCoupon(cu.id, 500)
    await withServer(async (srv) => {
      srv.seed(cp)
      await claimPosCoupons([cp.id], { orderId: 'BILL-R', amounts: { [cp.id]: 150 } })
      assert.equal(srv.bal[cp.id], 350)
      await releaseCoupons([cp.id], 'BILL-R')
      assert.equal(srv.bal[cp.id], 500)
      assert.equal('BILL-R' in srv.holds[cp.id], false)
    })
  })

  t('คูปองคืนเงินผ่านออร์เดอร์ปกติ (claimAndApplyCoupon) จองยอดตามที่คิดจริง', async () => {
    const cu = newCustomer()
    const o = mkOrder('B10', cu.id, Math.ceil(600 / Number(tmpl.unitPrice)))
    const cp = creditCoupon(cu.id, 500)
    await withServer(async (srv) => {
      srv.seed(cp)
      const want = Math.min(cp.balance, totalOf(o))
      const r = await claimAndApplyCoupon(o, cp.id, {})
      assert.ok(!r.error, r.error)
      assert.equal(srv.calls.at(-1).amount, want)
      assert.equal(srv.calls.at(-1).oid, 'B10')
    })
  })

  t('POS แก้บิลค้างแล้วเพิ่มคูปองคืนเงิน: จองด้วยรหัสบิลเดิม และบิลผูกคูปองตามยอดที่จอง', async () => {
    session.role = 'admin'
    openShift(0)
    const cu = newCustomer()
    // ยอดคูปองน้อยกว่าบิลหลังแก้ (ไม่งั้นยอดเหลือ 0 ต่ำกว่าที่รับไปแล้ว และบันทึกไม่ได้ตามกติกา)
    const cp = creditCoupon(cu.id, 40)
    cp.activatedUntil = future()
    const cart1 = [{ kind: 'retail', refId: tmpl.retailId, qty: 1, mods: [] }]
    const pending = posSale({ cart: cart1, customerId: cu.id, couponIds: [], lines: [{ method: 'cash', amount: 1, received: 1 }], partial: true, billId: 'PEND-1' })
    assert.equal(pending?.status, 'pos_pending', 'สร้างบิลค้างไม่ได้')
    await withServer(async (srv) => {
      srv.seed(cp)
      const cart2 = [{ kind: 'retail', refId: tmpl.retailId, qty: 2, mods: [] }]
      const want = couponQuoteOf(cp, { ...pending, items: posItems(cart2, new Date()), couponsUsed: [] }).amount
      assert.equal(want, 40)
      const c = await claimPosCoupons([cp.id], { orderId: pending.id, amounts: { [cp.id]: want } })
      assert.equal(c.ok, true)
      const r = editPosPending(pending, cart2, { addCouponIds: [cp.id] })
      assert.equal(r.error, undefined, r.error)
      assert.equal(r.order.couponsUsed.find((x) => x.couponId === cp.id)?.amount, want)
      assert.equal(srv.holds[cp.id]['PEND-1'], want)
      assert.equal(srv.bal[cp.id], 0)
    })
  })

  t('แก้บิลค้างแล้วบันทึกไม่สำเร็จ → คืนยอดที่จองไว้ (ลำดับเดียวกับ saveEdit ใน Pos.vue)', async () => {
    session.role = 'admin'
    openShift(0)
    const cu = newCustomer()
    const cp = creditCoupon(cu.id, 500)
    cp.activatedUntil = past() // หมดเวลาแสดงที่ร้านแล้ว → บันทึกการแก้ไขต้องไม่ผ่าน
    const pending = posSale({ cart: [{ kind: 'retail', refId: tmpl.retailId, qty: 1, mods: [] }], customerId: cu.id, couponIds: [], lines: [{ method: 'cash', amount: 1, received: 1 }], partial: true, billId: 'PEND-2' })
    assert.equal(pending?.status, 'pos_pending')
    await withServer(async (srv) => {
      srv.seed(cp)
      const claim = await claimPosCoupons([cp.id], { orderId: pending.id, amounts: { [cp.id]: 100 } })
      assert.equal(claim.ok, true)
      const r = editPosPending(pending, [{ kind: 'retail', refId: tmpl.retailId, qty: 2, mods: [] }], { addCouponIds: [cp.id] })
      assert.ok(r.error, 'บันทึกการแก้ไขทั้งที่คูปองหมดเวลาแล้ว')
      await releaseCoupons(claim.claimed, pending.id)
      assert.equal(srv.bal[cp.id], 500)
      assert.equal('PEND-2' in srv.holds[cp.id], false)
    })
  })

  // C) แปลงคะแนนเป็นคูปอง
  t('แปลงคะแนนที่ใช้ได้เป็นคูปองยอดคงที่ ใช้ครั้งเดียว หมดอายุตาม CONVERT_DAYS และคะแนนเหลือ 0', async () => {
    session.role = 'admin'
    const cu = newCustomer([lot(100), lot(60, '2000-01-01'), lot(50, '2099-06-01')])
    const before = customerPoints(cu)
    assert.equal(before, 150)
    const conv = await convertPointsRemote(cu.id)
    assert.equal(conv.ok, true, conv.error)
    assert.equal(conv.points, 150)
    assert.equal(conv.amount, 150)
    const cp = db.coupons.find((x) => x.id === conv.couponId)
    assert.deepEqual([cp.mode, cp.amount, cp.source], ['fixed', 150, 'convert'])
    const days = Math.round((new Date(cp.expiresAt) - new Date(Date.now())) / DAY)
    assert.ok(days >= CONVERT_DAYS - 1 && days <= CONVERT_DAYS + 1, `หมดอายุ ${days} วัน`)
    assert.equal(customerPoints(cu), 0)
    assert.equal((await convertPointsRemote(cu.id)).error, 'ไม่มีคะแนนที่ใช้ได้ให้แปลง')
  })

  t('ผู้ไม่มีสิทธิ์ปรับคะแนน (sales) แปลงคะแนนไม่ได้ และสมุดคะแนนไม่เปลี่ยน', async () => {
    const cu = newCustomer([lot(100)])
    session.role = 'sales'
    try {
      assert.equal(can('adjustPoints'), false)
      const r = await convertPointsRemote(cu.id)
      assert.equal(r.error, 'ไม่มีสิทธิ์แปลงคะแนน')
      assert.equal(customerPoints(cu), 100)
      assert.equal(db.coupons.some((x) => x.customerId === cu.id), false)
    } finally { session.role = 'admin' }
  })

  // D) ถอดการใช้คะแนนลดราคา + ข้อมูลเดิม + ฟีเจอร์คะแนนอื่นยังทำงาน
  t('ใช้คะแนนลดราคาใหม่ไม่ได้ (ปฏิเสธทุกกรณี)', async () => {
    const r = await applyPointsRemote()
    assert.ok(r.error)
  })

  t('ออร์เดอร์ค้างที่ใช้คะแนนไว้ก่อนถอดฟีเจอร์: ยังหักส่วนลดเดิม และยกเลิกการใช้คะแนนแล้วคืนคะแนนได้', async () => {
    session.role = 'admin'
    const cu = newCustomer([lot(100)])
    adjustPoints(cu.id, -40, 'จำลองการตัดคะแนนเดิม')
    const spend = cu.ledger.at(-1)
    const o = mkOrder('D2', cu.id, 2)
    o.pointsUsed = { points: 40, amount: 40, entryId: spend.id }
    const withoutPts = orderTotals({ ...o, pointsUsed: null }).total
    assert.equal(withoutPts - orderTotals(o).total, 40, 'ส่วนลดคะแนนเดิมหายไปจากยอดออร์เดอร์')
    const r = await removePointsRemote(o, { notify: false, sms: false })
    assert.equal(r.ok, true, r.error)
    assert.equal(o.pointsUsed, null)
    assert.equal(customerPoints(cu), 100)
    assert.equal(orderTotals(o).total, withoutPts)
  })

  t('แลกของรางวัลด้วยคะแนนยังหักคะแนนตามราคา และไม่แลกเมื่อคะแนนไม่พอ', () => {
    const rw = db.rewards.find((x) => x.active !== false && x.points <= 600)
    const cu = newCustomer([lot(600)])
    const got = redeemReward(cu, rw.id)
    assert.ok(got, 'แลกของรางวัลไม่ได้ทั้งที่คะแนนพอ')
    assert.equal(customerPoints(cu), 600 - rw.points)
    const poor = newCustomer([lot(rw.points - 1)])
    assert.equal(redeemReward(poor, rw.id), null)
    assert.equal(customerPoints(poor), rw.points - 1)
  })

  t('หมุนกาชาด้วยคะแนนยังหักค่าหมุนตามที่ตั้ง และไม่หมุนเมื่อคะแนนไม่พอ', () => {
    const cost = db.loyalty.spinCost
    const cu = newCustomer([lot(cost + 10)])
    const prize = spinGacha(cu, true)
    assert.ok(prize, 'หมุนไม่ได้ทั้งที่คะแนนพอ')
    const earned = prize.type === 'points' ? Number(prize.value) || 0 : 0
    assert.equal(customerPoints(cu), cost + 10 - cost + earned)
    const poor = newCustomer([lot(cost - 1)])
    assert.equal(spinGacha(poor, true), null)
    assert.equal(customerPoints(poor), cost - 1)
  })

  for (const [name, fn] of cases) {
    try { await fn(); console.log(`PASS ${name}`) } catch (e) { fails++; console.log(`FAIL ${name}: ${e.message}`) }
  }
} catch (e) {
  fails++
  console.log('ERROR', e?.stack || e)
} finally {
  await server.close()
}
console.log(fails ? `ไม่ผ่าน ${fails} กรณี` : 'ผ่านทุกกรณี')
process.exitCode = fails ? 1 : 0
