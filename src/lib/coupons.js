// คูปองส่วนลด 3 แบบ: ลดเป็นบาท (แบบเดิม) · ซื้อครบ x บาท ลด y% สูงสุด z บาท · ซื้อสินค้า x ลด y% สูงสุด z บาท
// ส่วนลดคิดจากออร์เดอร์ตอนใช้ (ไม่เก็บยอดตายตัวของแบบ %) · ใช้ร่วมกันทั้งหน้าจัดการ ออร์เดอร์ POS และบัญชีลูกค้า
// เซิร์ฟเวอร์ตรวจซ้ำด้วยกติกาเดียวกันที่ punpang__coupon_entry_ok (migration 20261116160000)
import { money } from './format.js'
import { orderTotals } from './pricing.js'

export const COUPON_MODES = [
  { v: 'fixed', l: 'ลดเป็นบาท' },
  { v: 'spend', l: 'ซื้อครบ ลด %' },
  { v: 'product', l: 'ซื้อสินค้า ลด %' },
]

const num = (x) => {
  const n = Number(x)
  return Number.isFinite(n) ? n : 0
}
const cents = (n) => Math.round((n + Number.EPSILON) * 100) / 100

// ประเภทของคูปอง (ไม่มีค่า = ลดเป็นบาทเหมือนเดิม) · credit = คูปองคืนเงิน ใช้ได้หลายครั้งจนยอดคงเหลือหมด
export const modeOf = (x) => (x?.mode === 'spend' || x?.mode === 'product' || x?.mode === 'credit' ? x.mode : 'fixed')
export const isCredit = (x) => modeOf(x) === 'credit'
// ยอดคงเหลือของคูปองคืนเงิน (ยอดที่ยังไม่ถูกจองกับออร์เดอร์ใด)
export const creditBalanceOf = (x) => cents(Math.max(0, num(x?.balance)))

// ยอดสินค้า = ราคาหลังส่วนลดรายการ × จำนวน (ไม่รวมค่าส่ง ปรับราคา คะแนน คูปอง)
export const goodsOf = (order) => cents((order.items || []).reduce((s, i) => s + num(i.unitPrice) * num(i.qty), 0))

// ยอดของสินค้าที่กำหนด (ไม่นับของแถม) · ไม่กำหนดสินค้า = 0
export function productGoodsOf(order, productId) {
  const id = String(productId ?? '')
  if (!id) return 0
  return cents((order.items || []).filter((i) => i && !i.promoGift && String(i.retailId ?? '') === id).reduce((s, i) => s + num(i.unitPrice) * num(i.qty), 0))
}

// ส่วนลดของคูปองใบหนึ่งกับออร์เดอร์นี้ · ok = เข้าเงื่อนไข · amount = ส่วนลด (บาท) · reason = เหตุผลเมื่อไม่เข้าเงื่อนไข
export function couponQuoteOf(cp, order) {
  const mode = modeOf(cp)
  const total = orderTotals(order).total
  const goods = goodsOf(order)
  if (mode === 'credit') {
    const available = creditBalanceOf(cp)
    if (!(available > 0)) return { ok: false, amount: 0, reason: 'ยอดคงเหลือของคูปองหมดแล้ว' }
    return { ok: true, amount: cents(Math.min(available, total)), reason: '' }
  }
  if (mode === 'fixed') {
    const minSpend = num(cp.minSpend)
    if (minSpend > 0 && goods < minSpend) return { ok: false, amount: 0, reason: `ยอดสินค้าต้องถึง ${money(minSpend)}` }
    return { ok: true, amount: cents(Math.min(Math.max(num(cp.amount), 0), total)), reason: '' }
  }
  const pct = num(cp.pct)
  const cap = num(cp.cap)
  if (!(pct > 0 && pct <= 100 && cap > 0)) return { ok: false, amount: 0, reason: 'ยังไม่ได้ตั้งเปอร์เซ็นต์หรือเพดานของคูปอง' }
  let base
  if (mode === 'spend') {
    const minSpend = num(cp.minSpend)
    if (!(goods > 0) || goods < minSpend) return { ok: false, amount: 0, reason: `ซื้อครบ ${money(minSpend)} ก่อน (ตอนนี้ ${money(goods)})` }
    base = goods
  } else {
    base = productGoodsOf(order, cp.productId)
    if (!(base > 0)) return { ok: false, amount: 0, reason: `ต้องมี${cp.productName ? ` ${cp.productName}` : 'สินค้าที่กำหนด'}ในออร์เดอร์` }
  }
  return { ok: true, amount: cents(Math.min((base * pct) / 100, cap, total)), reason: '' }
}

// คิดส่วนลดคูปองหลายใบตามลำดับ (ใบก่อนหักยอดก่อนใบถัดไป เหมือนตอนบันทึกจริง) · เริ่มจากคูปองที่อยู่ในออร์เดอร์แล้ว (order.couponsUsed)
// used = ใบที่ใช้ได้พร้อมยอด · rejected = ใบที่ไม่เข้าเงื่อนไขพร้อมเหตุผล
export function quoteCouponList(order, coupons) {
  let base = { ...order, couponsUsed: [...(order.couponsUsed || [])] }
  const used = []
  const rejected = []
  for (const cp of coupons) {
    const q = couponQuoteOf(cp, base)
    if (!q.ok) {
      rejected.push({ coupon: cp, reason: q.reason })
      continue
    }
    const row = { couponId: cp.id, name: cp.name, amount: q.amount }
    used.push(row)
    base = { ...base, couponsUsed: [...base.couponsUsed, row] }
  }
  return { used, rejected }
}

// ข้อความเงื่อนไขของคูปอง (ใช้ได้กับทั้งของแลกและคูปองที่แลกแล้ว)
export function couponTermsText(x) {
  const mode = modeOf(x)
  if (mode === 'credit') return `คูปองคืนเงิน ยอดคงเหลือ ${money(creditBalanceOf(x))} ใช้ได้หลายครั้งจนหมด`
  if (mode === 'spend') return `ซื้อครบ ${money(num(x.minSpend))} ลด ${num(x.pct)}% สูงสุด ${money(num(x.cap))}`
  if (mode === 'product') return `ซื้อ${x.productName ? ` ${x.productName}` : 'สินค้าที่กำหนด'} ลด ${num(x.pct)}% สูงสุด ${money(num(x.cap))}`
  return `ส่วนลด ${money(num(x.amount))}${num(x.minSpend) > 0 ? ` (ขั้นต่ำ ${money(num(x.minSpend))})` : ''}`
}

// ฟิลด์ของคูปองที่คัดลอกจากของแลก (ลดเป็นบาท: amount/minSpend · % : pct/cap และ minSpend ของแบบซื้อครบ, productId/productName ของแบบซื้อสินค้า)
// amount ของแบบ % เก็บเท่ากับเพดาน เพื่อให้การตรวจแบบเดิมยังเห็นเพดานส่วนลดของคูปองนี้
export function couponFieldsOf(rw) {
  const mode = modeOf(rw)
  if (mode === 'fixed') return { mode, amount: num(rw.amount), minSpend: num(rw.minSpend), pct: 0, cap: 0, productId: '', productName: '' }
  const cap = num(rw.cap)
  return {
    mode,
    pct: num(rw.pct),
    cap,
    amount: cap,
    minSpend: mode === 'spend' ? num(rw.minSpend) : 0,
    productId: mode === 'product' ? String(rw.productId || '') : '',
    productName: mode === 'product' ? String(rw.productName || '') : '',
  }
}

// ตรวจของแลกประเภทคูปองก่อนบันทึก · คืนข้อความแรกที่ผิด หรือ '' ถ้าถูกต้อง
export function validateCouponReward(rw) {
  const mode = modeOf(rw)
  if (mode === 'fixed') return num(rw.amount) > 0 ? '' : 'กรอกมูลค่าส่วนลด (บาท)'
  if (mode === 'spend' && !(num(rw.minSpend) > 0)) return 'กรอกยอดซื้อขั้นต่ำ (บาท)'
  if (mode === 'product' && !String(rw.productId || '').trim()) return 'เลือกสินค้าที่ต้องซื้อ'
  if (!(num(rw.pct) > 0 && num(rw.pct) <= 100)) return 'ลดกี่ % ต้องมากกว่า 0 และไม่เกิน 100'
  if (!(num(rw.cap) > 0)) return 'กรอกลดสูงสุดกี่บาท (ต้องมากกว่า 0)'
  return ''
}
