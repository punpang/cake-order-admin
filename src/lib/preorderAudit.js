// ตรวจค่าส่งและแต้มของออร์เดอร์สั่งล่วงหน้าที่ให้แต้มแล้ว (เฟส 4 ข้อ 2 · ใช้โดย Edge Function preorder-audit)
// • ค่าส่งพัสดุ: คิดใหม่จาก parcelFee ด้วยตารางของร้าน (ณ เวลาสร้าง) แล้วหักส่วนลดค่าส่งตามขั้น → เทียบกับ shippingFee ที่บันทึก
//   ต่างเกิน 0.01 บาท = ผิด · ส่วนลดค่าส่งใช้ขั้นปัจจุบันของแคมเปญ (ออร์เดอร์ไม่เก็บ shipDiscount แยก)
// • แต้ม: คิดใหม่จากฐานเดียวกับ punpang_preorder_award_delivery (ยอดสุทธิก่อน VAT ไม่รวมค่าส่งและสินค้า noPoints)
//   ใช้ตัวคูณที่เก็บไว้ใน loyalty.mult · ต่างได้ 0 แต้ม · ไม่มี mult (ออร์เดอร์เก่า) → ไม่เทียบแต้ม แจ้งเป็น check
// ไม่แก้ข้อมูล · ตรวจเฉพาะออร์เดอร์ที่ส่งมอบ/ยกเลิกและมี loyalty แล้ว
import { parcelFee } from './parcelShipping.js'
import { shipOffDiscount, cleanShipOff } from './shipDiscount.js'
import { orderTotals } from './pricing.js'

const SHIP_EPS = 0.01
const AUDITED_STATUS = new Set(['delivered', 'cancelled'])
const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0)
const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100

// ฐานแต้มของออร์เดอร์สั่งล่วงหน้า (ตรงกับ punpang_preorder_award_delivery)
export function preorderBasePoints(order) {
  const items = Array.isArray(order?.items) ? order.items : []
  const sub = items.reduce((s, i) => s + num(i.unitPrice) * num(i.qty), 0)
  const coupons = Array.isArray(order?.couponsUsed) ? order.couponsUsed : []
  const bill = Math.max(0, -num(order?.adjustment?.amount)) + num(order?.pointsUsed?.amount) + coupons.reduce((s, c) => s + num(c?.amount), 0)
  const k = sub > 0 ? Math.max(0, 1 - bill / sub) : 0
  const rate = num(order?.vat?.rate)
  const inclusive = rate > 0 && order?.vat?.mode !== 'exclusive'
  const base = items
    .filter((i) => !i.noPoints)
    .reduce((s, i) => {
      const gross = num(i.unitPrice) * num(i.qty) * k
      return s + (inclusive ? (gross * 100) / (100 + rate) : gross)
    }, 0)
  return r2(base)
}

// แต้มที่ควรได้ = ฐาน × ตัวคูณ ÷ แต้มต่อบาท (ปัดลง) · earnPer ไม่ตั้ง = 100 · ต่ำสุด 0.01 (ตรงกับฝั่งฐานข้อมูล)
export function expectedPoints(base, mult, earnPer) {
  const per = earnPer == null || !Number.isFinite(Number(earnPer)) ? 100 : Math.max(Number(earnPer), 0.01)
  return Math.floor(num(base) * num(mult) / per + 1e-9)
}

// ออร์เดอร์หนึ่งใบ → { ok, flags: [{ code, severity, detail }], skipped? }
// catalog = แคตาล็อกที่ย้อนไปเวลาสร้างออร์เดอร์แล้ว (catalogAt) · shipOff = ขั้นส่วนลดค่าส่งของแคมเปญ · earnPer = ค่าแต้มต่อบาทปัจจุบัน
export function auditPreorderOrder(order, { catalog = null, shipOff = [], earnPer = 100 } = {}) {
  if (!AUDITED_STATUS.has(order?.status) || order?.loyalty == null) return { ok: true, flags: [], skipped: 'not_applicable' }
  const flags = []
  const flag = (code, severity, detail) => flags.push({ code, severity, detail })

  if (order.fulfillment === 'delivery') {
    const pf = parcelFee(Array.isArray(order.lines) ? order.lines : [], catalog?.retailItems || [], catalog?.shop?.parcel)
    if (!pf.ok) {
      flag('cannot_price_shipping', 'check', `คำนวณค่าส่งใหม่ไม่ได้: ${pf.error}`)
    } else {
      const goodsExVat = orderTotals({ ...order, shippingFee: 0, payments: order.payments ?? [] }).beforeVat
      const disc = pf.total > 0 ? shipOffDiscount({ goodsExVat, shippingFee: pf.total, tiers: cleanShipOff(shipOff) }).amount : 0
      const expected = r2(pf.total - disc)
      if (Math.abs(num(order.shippingFee) - expected) > SHIP_EPS) flag('shipping_mismatch', 'high', `ค่าส่ง ${order.shippingFee} ควรเป็น ${expected}`)
    }
  }

  const lo = order.loyalty
  if (lo.mult == null) {
    flag('mult_unrecorded', 'check', 'ไม่ได้เก็บตัวคูณไว้ จึงไม่เทียบแต้ม')
  } else {
    const base = preorderBasePoints(order)
    const expected = expectedPoints(base, lo.mult, earnPer)
    if (num(lo.points) !== expected) flag('points_mismatch', 'high', `แต้ม ${lo.points} ควรเป็น ${expected} (ฐาน ${base})`)
  }

  return { ok: !flags.some((f) => f.severity !== 'info'), flags }
}
