// คืนเงินตอนยกเลิก (ฟังก์ชันล้วน): แบ่งยอดคืนได้หลายช่องทาง เงินสด / ธนาคาร(โอน) / คะแนนสะสม
export const REFUND_METHODS = { cash: 'เงินสด', transfer: 'ธนาคาร (โอน)', points: 'คะแนนสะสม' }
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100

// ช่องทางคืนตั้งต้นจากวิธีที่ลูกค้าจ่าย (เงินสด → เงินสด · อื่น ๆ → โอน)
export const defaultRefundMethod = (payMethod) => (payMethod === 'เงินสด' || payMethod === 'cash' ? 'cash' : 'transfer')

// รูปแบบเก่า { refundAmount, refundMethod } → รายการใหม่
export function normalizeRefunds(c, paid = 0) {
  if (Array.isArray(c?.refunds)) {
    return c.refunds.map((x) => ({ method: x.method, amount: r2(x.amount), ...(x.points != null ? { points: x.points } : {}) })).filter((x) => x.amount > 0)
  }
  const amount = r2(c?.refundAmount)
  return amount > 0 ? [{ method: defaultRefundMethod(c?.refundMethod), amount }] : []
}

// ตรวจรายการคืน → ข้อความผิดพลาด ('' = ผ่าน)
// opts: { paid, canPoints (ลูกค้ามีบัญชีสะสมคะแนน), pointValue (บาทต่อคะแนน) }
export function refundErrors(rows, { paid = 0, canPoints = false, pointValue = 1 } = {}) {
  const seen = new Set()
  let sum = 0
  for (const x of rows) {
    if (!REFUND_METHODS[x.method]) return 'ช่องทางคืนไม่ถูกต้อง'
    const a = Number(x.amount)
    if (!(a > 0)) return 'ยอดคืนแต่ละช่องทางต้องมากกว่า 0 (ลบแถวที่ไม่ใช้)'
    if (seen.has(x.method)) return 'ช่องทางเดียวกันใส่ซ้ำ รวมเป็นแถวเดียว'
    seen.add(x.method)
    sum += a
    if (x.method === 'points') {
      if (!canPoints) return 'คืนเป็นคะแนนไม่ได้ (ไม่มีลูกค้า/บัญชีสะสมคะแนนในออร์เดอร์นี้)'
      const q = a / (pointValue || 1)
      if (Math.abs(q - Math.round(q)) > 1e-9) return `ยอดคืนเป็นคะแนนต้องหารด้วย ${pointValue} ลงตัว (1 คะแนน = ${pointValue} บาท)`
    }
  }
  if (r2(sum) > r2(paid)) return `คืนรวมเกินยอดที่ชำระแล้ว (${r2(paid)} บาท)`
  return ''
}

// คืนเงินบางส่วนโดยไม่ยกเลิก: order.returns = [{ id, at, by, reason, note, refunds, amount }]
// returnsOf = เฉพาะรายการที่ยังไม่ยกเลิก (entry.cancelled = { at, by, reason }) · allReturnsOf = ทั้งหมด (ไว้แสดงประวัติ)
export const allReturnsOf = (order) => (Array.isArray(order?.returns) ? order.returns : [])
export const returnsOf = (order) => allReturnsOf(order).filter((x) => !x.cancelled)
export const returnedTotal = (order) => r2(returnsOf(order).reduce((s, x) => s + (Number(x.amount) || 0), 0))
// ยอดคืนบางส่วนแยกช่องทาง { cash, transfer, points }
export function returnedByMethod(order) {
  const m = { cash: 0, transfer: 0, points: 0 }
  for (const r of returnsOf(order)) for (const x of r.refunds || []) m[x.method] = r2((m[x.method] || 0) + (Number(x.amount) || 0))
  return m
}

// รายการคืนสำหรับแสดงผล [{ label, amount, points }] (รองรับรูปแบบเก่า)
export function refundList(cancel) {
  if (!cancel) return []
  const rows = Array.isArray(cancel.refunds) ? cancel.refunds : Number(cancel.refundAmount) > 0 ? [{ method: null, amount: cancel.refundAmount, legacy: cancel.refundMethod }] : []
  return rows.map((x) => ({ label: x.method ? REFUND_METHODS[x.method] || x.method : x.legacy || 'คืนเงิน', amount: Number(x.amount) || 0, points: x.points ?? null }))
}

// ---------- คืนสินค้ารายชิ้น (เฉพาะบิล POS) ----------
// จำนวนที่คืนแล้วของรายการในบิล (นับเฉพาะการคืนที่ยังไม่ถูกยกเลิก)
export const returnedQtyOf = (order, itemId) =>
  returnsOf(order).reduce((n, r) => n + (r.items || []).filter((x) => x.id === itemId).reduce((s, x) => s + (Number(x.qty) || 0), 0), 0)
// จำนวนที่คืนเข้าสต็อกแล้วของรายการในบิล (นับเฉพาะการคืนที่ยังไม่ถูกยกเลิก)
export const restockedQtyOf = (order, itemId) =>
  returnsOf(order).reduce((n, r) => n + (r.items || []).filter((x) => x.id === itemId).reduce((s, x) => s + (Number(x.restock) || 0), 0), 0)
// ยอดคืนของรายการ = ราคาหลังส่วนลดของรายการ × จำนวนที่คืน
export const itemReturnAmount = (item, qty) => r2((Number(item?.unitPrice) || 0) * (Number(qty) || 0))
// จำนวนที่ควรคืนเข้าสต็อก: ไม่เกินจำนวนที่ตัดสต็อกไว้ตอนขาย ลบจำนวนที่คืนเข้าสต็อกไปแล้ว · ตอนขายไม่ได้ตัดสต็อก = 0
export function restockUnits(item, qty, restockedSoFar = 0, restock = true) {
  if (!restock || item?.stockTaken == null) return 0
  return Math.max(0, Math.min(Number(qty) || 0, (Number(item.stockTaken) || 0) - (Number(restockedSoFar) || 0)))
}
