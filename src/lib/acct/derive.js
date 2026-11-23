// ดึงรายการบัญชีอัตโนมัติจากข้อมูลระบบ (ฟังก์ชันล้วน) · คำนวณจากสถานะปัจจุบันของออร์เดอร์ ไม่ต้อง hook ทุกจุด
// จึงรองรับแก้/ยกเลิก/คืนเงิน/เปลี่ยนผู้ซื้อ · เงินคิดเป็นสตางค์จำนวนเต็ม
import { orderTotals } from '../pricing'
import { orderCost } from '../materials'
import { toDateStr } from '../format'
import { toS, toB, allocate } from './money'
import { CASH, BANK, AR, INV, DEPOSIT, OUTPUT_VAT, POINTS_LIAB, COUPON_LIAB, HOLD } from './chart'

const dateOf = (ts) => (ts ? toDateStr(new Date(ts)) : '')
const isCash = (p) => p.posMethod === 'cash' || p.method === 'เงินสด'
const cashAcc = (p) => (isCash(p) ? CASH : BANK)

// รวมบรรทัดบัญชีเดียวกัน + แปลงสตางค์ → บาท (ตัดบรรทัดศูนย์)
function pack(lines) {
  const m = new Map()
  for (const l of lines) {
    // poolable = รหัสบัญชีภาระที่ตัดได้ (2310 / 2320) · เก็บรหัสไว้ทั้งก้อนเพื่อให้รู้ว่าตัดจากภาระบัญชีใด
    const k = `${l.account}|${l.side}|${l.poolable || ''}`
    const cur = m.get(k) || { account: l.account, side: l.side, s: 0, poolable: l.poolable || null }
    cur.s += l.s
    m.set(k, cur)
  }
  return [...m.values()].filter((x) => x.s !== 0).map((x) => ({ account: x.account, [x.side]: toB(x.s), ...(x.poolable ? { poolable: x.poolable } : {}) }))
}
const entry = (id, date, memo, source, lines, tax = null) => ({ id, date, memo, source, lines: pack(lines), auto: true, ...(tax && tax.length ? { tax } : {}) })
const swap = (lines) => lines.map((l) => ({ ...l, side: l.side === 'dr' ? 'cr' : 'dr' }))
const dr = (account, s, extra = {}) => ({ account, side: 'dr', s, ...extra })
const cr = (account, s, extra = {}) => ({ account, side: 'cr', s, ...extra })
// บัญชีที่ลงช่องทางคืนเงิน: คะแนน → 2310 · คูปองคืนเงิน → 2320 (ไม่ใช่เงินออก) · เงินสด → 1010 · โอน → 1020
const refundAccount = (m) => (m === 'points' ? POINTS_LIAB : m === 'credit' ? COUPON_LIAB : m === 'cash' ? CASH : BANK)

function deliveredAtOf(o) {
  if (o.deliveredAt) return o.deliveredAt
  const h = (o.history || []).find((x) => /ส่งมอบ/.test(x.text) && !/ไม่ได้/.test(x.text))
  return h ? h.at : o.status === 'delivered' ? o.createdAt : null
}

// ctx = { groups, retail, ingredients, pointValue }
export function orderEntries(o, ctx) {
  if (o.status === 'draft') return []
  const t = orderTotals(o)
  const total = Math.max(0, toS(t.total))
  const vatS = total > 0 ? Math.min(Math.max(0, toS(t.vat)), total) : 0
  const out = []
  const code = o.code
  const rate = Number(o.vat?.rate) || 0
  const cust = ctx.customerOf?.(o) || null
  const party = cust ? { party: cust.name || '', taxId: cust.taxId || '' } : {}
  const tx = (kind, baseS, vatS2, ref) => (vatS2 !== 0 || baseS !== 0 ? [{ kind, base: toB(baseS), vat: toB(vatS2), rate, docNo: ref || code, orderId: o.id, ...party }] : [])
  // ---- รับชำระแต่ละงวด ----
  // เงินพัก (ซ่อนเงิน/ดึงเงิน) ชำระก่อนเสมอ: งวดแรกๆ เข้าภาระ 2330 จนครบ ส่วนที่เหลือของงวดคือยอดสินค้า/บริการ
  let holdLeft = toS(t.hold)
  let vatBooked = 0
  const booked = [] // งวดที่ยังคงอยู่ (confirmed) { amtS, goodsS, holdP, vatP, netP }
  for (const p of o.payments || []) {
    const wasConfirmed = p.status === 'confirmed' || (p.status === 'cancelled' && p.confirmedBy)
    if (!wasConfirmed) continue
    const amtS = toS(p.amount)
    if (!(amtS > 0)) continue
    const holdP = Math.min(amtS, holdLeft)
    holdLeft -= holdP
    const goodsS = amtS - holdP
    const vatP = total > 0 ? Math.min(Math.round((goodsS * vatS) / total), vatS - vatBooked) : 0
    vatBooked += vatP
    const netP = goodsS - vatP
    const date = (p.paidAt ? String(p.paidAt).slice(0, 10) : '') || dateOf(p.confirmedAt) || dateOf(o.createdAt)
    const lines = [dr(cashAcc(p), amtS), ...(holdP > 0 ? [cr(HOLD, holdP)] : []), cr(DEPOSIT, netP), cr(OUTPUT_VAT, vatP)]
    out.push(entry(`pay:${o.id}:${p.id}`, date, `รับชำระ ${code}`, { type: 'order-pay', orderId: o.id, paymentId: p.id }, lines, vatP > 0 ? tx('output', netP, vatP) : null))
    if (p.status === 'cancelled') {
      out.push(entry(`payx:${o.id}:${p.id}`, dateOf(p.cancelledAt) || date, `ยกเลิกยอดชำระ ${code}`, { type: 'order-payx', orderId: o.id, paymentId: p.id }, swap(lines), vatP > 0 ? tx('output', -netP, -vatP) : null))
    } else booked.push({ amtS, goodsS, holdP, vatP, netP, p })
  }
  const sumAmt = booked.reduce((a, b) => a + b.amtS, 0)
  const sumVat = booked.reduce((a, b) => a + b.vatP, 0)
  const sumNet = booked.reduce((a, b) => a + b.netP, 0)
  const sumGoods = booked.reduce((a, b) => a + b.goodsS, 0) // เงินที่ชำระเป็นสินค้า/บริการ (ไม่รวมเงินพัก)
  const holdPaid = booked.reduce((a, b) => a + b.holdP, 0)

  // ---- คืนเงินบางส่วน (ไม่ยกเลิก): Dr 4950 (หักรายได้) + Dr ภาษีขายส่วนที่คืน / Cr เงินสด|ธนาคาร|หนี้คะแนน · ใช้ได้ทั้งก่อน/หลังส่งมอบ ---
  let retNet = 0 // ส่วนสุทธิ (ไม่รวม VAT) ที่คืนบางส่วนไปแล้วทั้งหมด
  for (const r of o.returns || []) {
    const rows = (r.refunds || []).filter((x) => Number(x.amount) > 0)
    const F = rows.reduce((a, x) => a + toS(x.amount), 0)
    if (!(F > 0) || !(sumAmt > 0)) continue
    const fv = Math.round((F * sumVat) / sumAmt)
    const fn = F - fv
    if (!r.cancelled) retNet += fn // ที่ยกเลิกแล้วหักล้างกันเอง (ret + retx) ไม่ต้องนับ
    const lines = [dr('4950', fn), dr(OUTPUT_VAT, fv)]
    for (const x of rows) lines.push(cr(refundAccount(x.method), toS(x.amount)))
    out.push(entry(`ret:${o.id}:${r.id}`, dateOf(r.at) || dateOf(o.createdAt), `คืนเงินบางส่วน ${code}`, { type: 'order-return', orderId: o.id, returnId: r.id }, lines, fv > 0 ? tx('output', -fn, -fv) : null))
    // ยกเลิกการคืน: กลับรายการ (ลงวันที่ยกเลิก)
    if (r.cancelled) out.push(entry(`retx:${o.id}:${r.id}`, dateOf(r.cancelled.at) || dateOf(r.at), `ยกเลิกการคืนเงิน ${code}`, { type: 'order-return-void', orderId: o.id, returnId: r.id }, swap(lines), fv > 0 ? tx('output', fn, fv) : null))
  }

  // ---- ส่งมอบ: รับรู้รายได้ + ต้นทุน + ค่าคะแนน/คูปอง ----
  const dAt = (o.status === 'delivered' || o.status === 'cancelled') ? deliveredAtOf(o) : null
  const delivered = o.status === 'delivered' || (o.status === 'cancelled' && !!dAt && (o.deliveredAt || (o.history || []).some((x) => /ส่งมอบ/.test(x.text) && !/ไม่ได้/.test(x.text))))
  let deliveryLines = null
  let restBase = 0
  let restVat = 0
  let cogsLines = null
  if (delivered && dAt) {
    const X = toS(t.pointsDiscount)
    const Y = toS(t.couponDiscount)
    // ส่วนลดจากคูปองคืนเงิน (ตัดภาระ 2320 ที่คืนไว้) แยกจากส่วนลดคูปองทั่วไป (5420)
    const Yc = Math.min(Y, (o.couponsUsed || []).filter((u) => u.credit).reduce((a, u) => a + toS(u.amount), 0))
    const netRev = Math.max(0, total - vatS)
    const R = netRev + X + Y
    const weights = [...o.items.map((i) => Math.max(0, toS(i.unitPrice * i.qty))), Math.max(0, toS(t.shipping))]
    const parts = weights.reduce((a, b) => a + b, 0) > 0 ? allocate(R, weights) : [R, ...Array(weights.length - 1).fill(0)]
    const rev = []
    o.items.forEach((i, k) => rev.push(cr(i.kind === 'retail' ? '4200' : '4100', parts[k])))
    rev.push(cr('4300', parts[o.items.length]))
    if (weights.reduce((a, b) => a + b, 0) <= 0 && R > 0) { rev.length = 0; rev.push(cr('4200', R)) }
    const unpaid = Math.max(0, total - sumGoods)
    // เงินพักส่งคืนลูกค้าพร้อมสินค้า: ตัดภาระ 2330 เครดิตเงินสด (ไม่ผ่านรายได้)
    const holdOut = holdPaid > 0 ? [dr(HOLD, holdPaid), cr(CASH, holdPaid)] : []
    deliveryLines = [dr(DEPOSIT, sumNet), dr(AR, unpaid), dr('5410', X, { poolable: POINTS_LIAB }), dr('5420', Y - Yc), dr('5420', Yc, { poolable: COUPON_LIAB }), ...rev, cr(OUTPUT_VAT, vatS - sumVat), ...holdOut]
    const cost = toS(orderCost(o, ctx.groups, ctx.retail, ctx.ingredients))
    cogsLines = cost > 0 ? [dr('5100', cost), cr(INV, cost)] : []
    // ค่าส่ง: รับรู้เป็นรายได้ (4300) และเป็นค่าใช้จ่ายค่าขนส่ง (5500) ยอดเดียวกัน — ต้องจ่ายคนส่งเต็มจำนวน (จ่ายเงินสดตอนส่งมอบ) · อยู่ในชุดเดียวกับต้นทุนเพื่อกลับรายการพร้อมกันตอนยกเลิก
    const shipS = weights.reduce((a2, b2) => a2 + b2, 0) > 0 ? parts[o.items.length] : 0
    if (shipS > 0) cogsLines.push(dr('5500', shipS), cr(CASH, shipS))
    restBase = Math.max(0, netRev - sumNet)
    restVat = vatS - sumVat
    out.push(entry(`dlv:${o.id}`, dateOf(dAt), `ส่งมอบ ${code} รับรู้รายได้`, { type: 'order-deliver', orderId: o.id }, [...deliveryLines, ...cogsLines], restVat > 0 ? tx('output', restBase, restVat) : null))
  }

  // ---- ยกเลิก: กลับรายการส่งมอบ (ถ้าเคยส่งมอบ) + คืนเงิน + ริบมัดจำ ----
  if (o.status === 'cancelled') {
    const cDate = dateOf(o.cancel?.at) || dateOf(dAt) || dateOf(o.createdAt)
    if (deliveryLines) out.push(entry(`dlvx:${o.id}`, cDate, `ยกเลิก ${code} กลับรายการรายได้`, { type: 'order-cancel-rev', orderId: o.id }, swap([...deliveryLines, ...cogsLines]), restVat > 0 ? tx('output', -restBase, -restVat) : null))
    const refunds = (o.cancel?.refunds || []).filter((r) => Number(r.amount) > 0)
    const F = refunds.reduce((a, r) => a + toS(r.amount), 0)
    if (sumAmt > 0) {
      const fv = Math.round((F * sumVat) / sumAmt)
      const fn = F - fv
      const lines = [dr(DEPOSIT, fn), dr(OUTPUT_VAT, fv)]
      for (const r of refunds) lines.push(cr(refundAccount(r.method), toS(r.amount)))
      // ที่คืนบางส่วนไปก่อนแล้ว: กลับรายการ 4950 (ออร์เดอร์ถูกยกเลิก ไม่ใช่ส่วนลด) และไม่นับเป็นเงินมัดจำที่ริบ
      if (retNet > 0) lines.push(dr(DEPOSIT, retNet), cr('4950', retNet))
      // เงินพัก: คืนตาม cancel.holdRefund (เงินสด) · ส่วนที่เหลือโอนเข้า 2300 (มี VAT ตามส่วนนั้น) แล้วริบเหมือนมัดจำ
      const holdRefund = Math.min(holdPaid, toS(o.cancel?.holdRefund))
      const holdRest = holdPaid - holdRefund
      const vatT = holdRest > 0 && total > 0 ? Math.min(Math.round((holdRest * vatS) / total), vatS - sumVat) : 0
      const transferNet = holdRest - vatT
      if (holdRefund > 0) lines.push(dr(HOLD, holdRefund), cr(CASH, holdRefund))
      if (holdRest > 0) lines.push(dr(HOLD, holdRest), cr(DEPOSIT, transferNet), cr(OUTPUT_VAT, vatT))
      const ret = sumNet + transferNet - fn - retNet
      if (ret > 0) lines.push(dr(DEPOSIT, ret), cr('4900', ret))
      const taxRows = [...(fv > 0 ? tx('output', -fn, -fv) : []), ...(vatT > 0 ? tx('output', transferNet, vatT) : [])]
      out.push(entry(`cxl:${o.id}`, cDate, `ยกเลิก ${code} คืนเงิน/ริบมัดจำ`, { type: 'order-cancel', orderId: o.id }, lines, taxRows))
    }
  }
  return out
}

// ของรางวัลที่มอบแล้ว: ตั้งต้นทุนโดยประมาณจากคะแนนที่แลก
function rewardEntries(ctx) {
  const out = []
  for (const cp of ctx.coupons || []) {
    if (cp.type !== 'reward' || cp.status !== 'delivered' || !cp.deliveredAt) continue
    const rw = (ctx.rewards || []).find((x) => x.id === cp.rewardId)
    const cost = toS((Number(rw?.points) || 0) * (Number(ctx.pointValue) || 1))
    if (!(cost > 0)) continue
    out.push(entry(`rwd:${cp.id}`, dateOf(cp.deliveredAt), `มอบของรางวัล ${cp.name}`, { type: 'reward', couponId: cp.id }, [dr('5430', cost), cr(INV, cost)]))
  }
  return out
}

// ทุกรายการอัตโนมัติ (เรียงตามวัน) · แยกส่วนลดคะแนนที่หักจากภาระ 2310 (pool) ตามลำดับเวลา
// extra = ตัวสร้างรายการอื่น ๆ (ค่าเสื่อม ตัดจำหน่าย ฯลฯ) เป็นฟังก์ชัน (ctx) → รายการ[]
export function deriveAll(ctx, extra = []) {
  const all = []
  for (const o of ctx.orders) all.push(...orderEntries(o, ctx))
  all.push(...rewardEntries(ctx))
  for (const g of extra) all.push(...g(ctx))
  all.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1))
  // ภาระคงค้างตามบัญชี (2310 คะแนน · 2320 คูปองคืนเงิน): ส่วนลดที่ใช้ตัดภาระก่อน ส่วนที่เหลือไปค่าใช้จ่าย
  const pools = { [POINTS_LIAB]: 0, [COUPON_LIAB]: 0 }
  for (const e of all) {
    const lines = []
    for (const l of e.lines) {
      if (pools[l.account] !== undefined && l.cr) pools[l.account] += toS(l.cr)
      if (pools[l.account] !== undefined && l.dr) pools[l.account] -= toS(l.dr)
      if (l.poolable && l.dr) {
        const liab = l.poolable === true ? POINTS_LIAB : l.poolable
        const take = Math.min(toS(l.dr), Math.max(0, pools[liab]))
        pools[liab] -= take
        if (take > 0) lines.push({ account: liab, dr: toB(take) })
        if (toS(l.dr) - take > 0) lines.push({ account: l.account, dr: toB(toS(l.dr) - take) })
      } else { const { poolable, ...rest } = l; lines.push(rest) }
    }
    e.lines = lines
  }
  return all
}
