// รายงานสั่งล่วงหน้า (ฟังก์ชันล้วน): จัดกลุ่มและนับจากรายการออร์เดอร์ที่เซิร์ฟเวอร์ส่งมา
// ไม่เข้าถึง DOM หรือเครือข่าย · ใช้ร่วมกับ Edge Function preorder-admin ผ่าน schedlib
// ออร์เดอร์ = { id, code, status, campaignId, pickupDate, customerName, fulfillment, total, paid, shippingFee, shipping, payDueAt, lines:[{retailId, qty}] }

const INACTIVE = ['cancelled', 'expired']
const money = (n) => Math.round((Number(n) || 0) * 100) / 100

// ออร์เดอร์ที่ยังมีผล: ไม่ถูกยกเลิกและไม่หมดเวลา
export const activeOrders = (orders) => (orders || []).filter((o) => !INACTIVE.includes(o.status))

const dueOf = (o) => money(Math.max(0, (Number(o.total) || 0) - (Number(o.paid) || 0)))
const isPaidFull = (o) => dueOf(o) === 0

// ใบจัดเตรียม: สินค้า × จำนวนรวม ต่อวันรับ · ออร์เดอร์ที่มีปัญหาไปอยู่ในส่วนข้อยกเว้น
/**
 * @param {any[]} orders
 * @param {{names?: Record<string, string>, campaignId?: string, from?: string, to?: string}} [opts]
 */
export function prepSheet(orders, { names = {}, campaignId, from, to } = {}) {
  const byDay = new Map()
  for (const o of activeOrders(orders)) {
    if (campaignId && o.campaignId !== campaignId) continue
    if (from && (!o.pickupDate || o.pickupDate < from)) continue
    if (to && (!o.pickupDate || o.pickupDate > to)) continue
    const day = o.pickupDate || ''
    if (!byDay.has(day)) byDay.set(day, { pickupDate: day, qty: new Map(), orderCount: 0, paidCount: 0, unpaidCount: 0, exceptions: [] })
    const g = byDay.get(day)
    if (!day) { g.exceptions.push({ code: o.code, reason: 'ไม่มีวันรับ' }); continue }
    const lines = Array.isArray(o.lines) ? o.lines : []
    if (lines.length === 0) { g.exceptions.push({ code: o.code, reason: 'ไม่มีรายการสินค้า' }); continue }
    if (lines.some((l) => !Number.isInteger(Number(l.qty)) || Number(l.qty) <= 0)) { g.exceptions.push({ code: o.code, reason: 'จำนวนสินค้าไม่ถูกต้อง' }); continue }
    g.orderCount += 1
    if (isPaidFull(o)) g.paidCount += 1; else g.unpaidCount += 1
    for (const l of lines) g.qty.set(l.retailId, (g.qty.get(l.retailId) || 0) + Number(l.qty))
  }
  return [...byDay.values()]
    .sort((a, b) => (a.pickupDate || '').localeCompare(b.pickupDate || ''))
    .map((g) => ({
      pickupDate: g.pickupDate,
      items: [...g.qty.entries()].map(([retailId, qty]) => ({ retailId, name: names[retailId] || retailId, qty }))
        .sort((x, y) => x.name.localeCompare(y.name, 'th')),
      orderCount: g.orderCount, paidCount: g.paidCount, unpaidCount: g.unpaidCount, exceptions: g.exceptions,
    }))
}

// รายการรับของวันหนึ่ง พร้อมสถานะการชำระ
/**
 * @param {any[]} orders
 * @param {{date?: string}} opts
 */
export function pickupList(orders, { date } = {}) {
  return activeOrders(orders)
    .filter((o) => o.pickupDate === date)
    .map((o) => ({ code: o.code, customerName: o.customerName || '', fulfillment: o.fulfillment || '', paid: money(o.paid), due: dueOf(o), status: o.status }))
    .sort((a, b) => a.code.localeCompare(b.code))
}

// ออร์เดอร์จัดส่งที่ยังไม่มีเลขพัสดุ (ต้องชำระครบก่อนจึงส่งได้)
export function shipQueue(orders) {
  return activeOrders(orders)
    .filter((o) => o.fulfillment === 'delivery' && !o.shipping)
    .map((o) => ({ code: o.code, customerName: o.customerName || '', paidFull: isPaidFull(o), shippingFee: money(o.shippingFee), due: dueOf(o) }))
    .sort((a, b) => a.code.localeCompare(b.code))
}

// ยอดค้างชำระ เรียงตามเวลาหมดเขต ออร์เดอร์ที่เกินเวลาแล้วขึ้นก่อน
/**
 * @param {any[]} orders
 * @param {{nowMs: number}} opts
 */
export function dueList(orders, { nowMs }) {
  return activeOrders(orders)
    .filter((o) => o.status === 'awaiting_payment' && dueOf(o) > 0)
    .map((o) => ({ code: o.code, customerName: o.customerName || '', due: dueOf(o), payDueAt: o.payDueAt || null, overdue: !!o.payDueAt && Date.parse(o.payDueAt) < nowMs }))
    .sort((a, b) => (a.payDueAt || '9999').localeCompare(b.payDueAt || '9999'))
}

// สรุปรายแคมเปญ: จำนวนออร์เดอร์ ยอดขาย ยอดรับแล้ว ยอดค้าง
/**
 * @param {any[]} orders
 * @param {{campaignId: string}} opts
 */
export function campaignSummary(orders, { campaignId }) {
  const rows = activeOrders(orders).filter((o) => o.campaignId === campaignId)
  const sales = money(rows.reduce((a, o) => a + (Number(o.total) || 0), 0))
  const paid = money(rows.reduce((a, o) => a + (Number(o.paid) || 0), 0))
  return { orderCount: rows.length, sales, paid, due: money(sales - paid) }
}

// ยกเลิก หมดเวลา และรายการคืนเงิน พร้อมเหตุผล
export function exceptionList(orders) {
  const out = []
  for (const o of orders || []) {
    if (o.status === 'cancelled') out.push({ code: o.code, status: 'cancelled', reason: 'ยกเลิกแล้ว' })
    else if (o.status === 'expired') out.push({ code: o.code, status: 'expired', reason: 'หมดเวลาชำระ' })
    else if (o.returnRequest) out.push({ code: o.code, status: o.status, reason: 'ขอคืนสินค้า' })
  }
  return out.sort((a, b) => a.code.localeCompare(b.code))
}
