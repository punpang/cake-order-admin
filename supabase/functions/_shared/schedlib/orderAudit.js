// ตรวจออร์เดอร์ที่บันทึกแล้ว — ไม่บล็อกการสร้างหรือการขาย
// • บิลหน้าร้าน (channel pos) → auditPosOrder (src/lib/posAudit.js)
// • ออร์เดอร์ตรง → คำนวณราคาใหม่ด้วยตรรกะชุดเดียวกับใบเสนอ (buildQuotePayload) ณ เวลาที่สร้างออร์เดอร์ แล้วเทียบกับที่บันทึกไว้
//   ไม่ตรวจการชำระเงิน ค่าส่ง คะแนน และคูปอง (ตรวจตอนบันทึกที่ฐานข้อมูลแล้ว หรือเป็นสิทธิ์ที่ออกแบบไว้เดิม)
//   ไม่ตรวจการปิดรับนัด (ตรวจตอนสร้างแล้ว และร้านอาจเปลี่ยนเวลาเปิดปิดภายหลัง)
//   ข้ามออร์เดอร์จากใบเสนอ (ราคาล็อกตอนบันทึกแล้ว) · ร่างไม่อยู่ในขอบเขต (ยังแก้ได้)
// ข้อจำกัด: ถ้าราคาในแคตาล็อกเปลี่ยนหลังสร้าง การตรวจจะรายงานเป็นรายการให้ดู — ดู docs/security.md
import { buildQuotePayload } from './quotePrice.js'
import { auditPosOrder } from './posAudit.js'
import { deliveryFee } from './delivery.js'
import { orderTotals } from './pricing.js'

const ALLOWED_DISCOUNT = new Set(['special', 'bundle', 'promo', 'gift'])
const EPS = 0.01
const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0)
const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100
const vatKey = (v) => (v && Number(v.rate) > 0 ? `${Number(v.rate)}|${v.mode === 'exclusive' ? 'exclusive' : 'inclusive'}` : '')

// จุดเข้าเดียว: แยกตามช่องทาง · transfers (ไม่บังคับ) = แจ้งเตือนเงินเข้า [{ amount, ref }] ใช้จับคู่การโอนที่มีรหัสสุ่มของออร์เดอร์ตรง
export function auditOrder(order, catalog, { nowMs, transfers } = {}) {
  return order?.channel === 'pos' ? auditPosOrder(order, catalog) : auditDirectOrder(order, catalog, { nowMs, transfers })
}

// ออร์เดอร์ตรง → { ok, flags: [{ code, severity, detail }] } · nowMs = เวลาที่สร้างออร์เดอร์ (ใช้เลือกโปรและราคาชุดที่ใช้ได้ ณ ตอนนั้น)
export function auditDirectOrder(order, catalog, { nowMs, transfers } = {}) {
  const flags = []
  const flag = (code, severity, detail) => flags.push({ code, severity, detail })
  if (order?.quoteId) return { ok: true, flags: [{ code: 'skipped_quote', severity: 'info', detail: 'ออร์เดอร์จากใบเสนอ ราคาล็อกตอนบันทึกแล้ว' }] }
  const stored = Array.isArray(order?.items) ? order.items : []
  const base = stored.filter((i) => !i.promoGift)
  const storedGifts = stored.filter((i) => i.promoGift)
  if (!base.length) return { ok: true, flags: [] }

  const built = buildQuotePayload({
    draft: { fulfillment: order.fulfillment, pickupAt: order.pickupAt, items: base, birthday: order.birthday ?? null },
    customerId: order.customerId ?? null,
    catalog,
    nowMs,
    checkClosure: false,
  })
  if (!built.ok) {
    flag('cannot_price', 'check', `คำนวณราคาใหม่ไม่ได้: ${built.error}`)
    return { ok: false, flags }
  }
  const exp = built.payload
  const expBase = exp.items.filter((i) => !i.promoGift)
  const expGifts = exp.items.filter((i) => i.promoGift)

  base.forEach((s, k) => {
    const e = expBase[k]
    if (!e) return
    const at = `รายการ ${k + 1}`
    if (Math.abs(num(s.unitPrice) - num(e.unitPrice)) > EPS) flag('unit_price_mismatch', 'high', `${at}: ราคาต่อชิ้น ${s.unitPrice} ควรเป็น ${e.unitPrice}`)
    if (Math.abs(num(s.fullPrice) - num(e.fullPrice)) > EPS) flag('full_price_mismatch', 'high', `${at}: ราคาเต็ม ${s.fullPrice} ควรเป็น ${e.fullPrice}`)
    if (s.kind === 'retail' && Math.abs(num(s.retailPrice) - num(e.retailPrice)) > EPS) flag('base_price_mismatch', 'high', `${at}: ราคาฐาน ${s.retailPrice} ควรเป็น ${e.retailPrice}`)
    const sd = Array.isArray(s.discounts) ? s.discounts : []
    for (const d of sd) if (!ALLOWED_DISCOUNT.has(d.kind)) flag('unknown_discount', 'high', `${at}: ส่วนลดประเภท ${d.kind} ไม่อยู่ในรายการที่ใช้ได้`)
    const sumS = sd.reduce((x, d) => x + num(d.amount), 0)
    const sumE = (e.discounts || []).reduce((x, d) => x + num(d.amount), 0)
    if (Math.abs(sumS - sumE) > EPS * (1 + sd.length)) flag('discount_mismatch', 'high', `${at}: ส่วนลดรวม ${r2(sumS)} ควรเป็น ${r2(sumE)}`)
  })

  const giftsStored = storedGifts.map((g) => g.retailId).sort().join(',')
  const giftsExpected = expGifts.map((g) => g.retailId).sort().join(',')
  if (giftsStored !== giftsExpected) flag('gift_mismatch', 'high', `ของแถมที่บันทึก [${giftsStored}] ควรเป็น [${giftsExpected}]`)

  if (vatKey(order.vat) !== vatKey(exp.vat)) flag('vat_mismatch', 'check', 'VAT ที่บันทึกไม่ตรงค่าร้านปัจจุบัน')
  if (!!order.shipPromo?.free !== !!exp.shipPromo?.free) flag('ship_promo_mismatch', 'check', 'ส่งฟรีไม่ตรงกับโปรที่ใช้ได้ ณ เวลาสร้าง')

  const subtotal = base.reduce((s, i) => s + num(i.unitPrice) * num(i.qty), 0)
  const adj = num(order.adjustment?.amount)
  if (adj > EPS) flag('adjustment_positive', 'check', `ปรับราคาเป็นบวก ${adj}`)
  if (-adj > subtotal + EPS) flag('adjustment_too_large', 'high', `ปรับราคา ${-adj} เกินยอดสินค้า ${r2(subtotal)}`)

  // ค่าส่ง: ถ้าไม่ได้ตั้งเอง ต้องตรงกับสูตรจากระยะทางและการตั้งค่าการจัดส่งของร้าน ณ ตอนนี้ · รับที่ร้านต้องไม่มีค่าส่ง
  const ship = num(order.shippingFee)
  if (order.fulfillment !== 'delivery') {
    if (ship > EPS) flag('shipping_on_pickup', 'high', `รับที่ร้านแต่มีค่าส่ง ${ship}`)
  } else if (!order.feeManual) {
    const km = order.distanceKm
    const expShip = km == null || km === '' ? null : deliveryFee(km, catalog.shop?.delivery)
    if (expShip == null) {
      if (ship > EPS) flag('shipping_unverified', 'check', `มีค่าส่ง ${ship} แต่คิดจากระยะทางไม่ได้`)
    } else if (Math.abs(ship - expShip) > EPS) flag('shipping_mismatch', 'high', `ค่าส่ง ${ship} ควรเป็น ${expShip} ตามระยะทาง ${km} กม.`)
  }

  // การรับชำระที่ยืนยันแล้ว (ตรวจภายในเท่านั้น ยังไม่ได้เทียบกับเงินเข้าบัญชีจริง): โอนเงินต้องมีสลิปแนบ · ยอดสุทธิที่รับต้องไม่เกินยอดบิล
  if (order.status !== 'cancelled') {
    const paid = (order.payments || []).filter((p) => p.status === 'confirmed')
    for (const p of paid) if (p.method === 'โอนเงิน' && !p.slip) flag('transfer_without_slip', 'check', `ยืนยันโอนเงิน ${p.amount} โดยไม่มีสลิปแนบ`)
    // โอนที่มีรหัสสุ่ม (QR) ต้องตรงกับแจ้งเตือนเงินเข้า: จับคู่ทีละรายการ (รหัสเดียวกัน + ยอดห่างไม่เกิน 0.01 · แจ้งเตือนแต่ละรายการใช้ได้ครั้งเดียว)
    // ไม่พบแจ้งเตือนของรหัสนี้เลย = check (อาจยังไม่เข้า) · พบรหัสแต่ยอดไม่ตรง = high
    if (Array.isArray(transfers)) {
      const pool = transfers.map((t) => ({ ref: String(t?.ref ?? ''), amount: num(t?.amount), used: false }))
      for (const p of paid) {
        if (p.method !== 'โอนเงิน' || !p.qrRef) continue
        const ref = String(p.qrRef)
        const same = pool.filter((t) => t.ref === ref)
        const hit = same.find((t) => !t.used && Math.abs(t.amount - num(p.amount)) <= EPS)
        if (hit) hit.used = true
        else if (same.length) flag('transfer_amount_mismatch', 'high', `ยืนยันโอน ${num(p.amount)} รหัส ${ref} ไม่ตรงแจ้งเตือนธนาคาร [${same.map((t) => t.amount).join(', ')}]`)
        else flag('transfer_unmatched', 'check', `ยังไม่พบแจ้งเตือนเงินเข้ารหัส ${ref} (ยอด ${num(p.amount)})`)
      }
    }
    const t = orderTotals({ ...order, items: base, payments: order.payments || [] })
    if (t.paidNet > t.total + 0.01) flag('overpaid', 'check', `รับชำระสุทธิ ${r2(t.paidNet)} มากกว่ายอดบิล ${r2(t.total)}`)
  }
  return { ok: flags.length === 0, flags }
}
