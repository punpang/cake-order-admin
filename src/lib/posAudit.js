// ตรวจบิลหน้าร้าน (channel pos) หลังซิงก์ — ไม่บล็อกการขาย: บิลยังบันทึกในเครื่องก่อนได้เหมือนเดิม (ขายตอนเน็ตหลุดได้)
// ตรวจเฉพาะสิ่งที่ตรวจซ้ำได้จากแคตาล็อกและตัวบิลเอง: ราคาฐานของสินค้า · ราคาตัวเลือก · การคำนวณในแต่ละรายการ · ส่วนลดท้ายบิล · ยอดชำระเทียบยอดบิล
// ไม่ตรวจซ้ำโปรโมชัน (ช่วงเวลาโปรเปลี่ยนได้หลังขาย) และไม่รู้ว่ารับเงินจริงหรือไม่ — ดูข้อจำกัดใน docs/security.md
// ผลต้องตรงกับ src/lib/posAudit.golden.json (สร้างจากโค้ดขายหน้าร้านของแอป) · เทสต์ src/lib/posAudit.test.mjs
import { orderTotals } from './pricing.js'

const ALLOWED_DISCOUNT = new Set(['promo', 'bundle', 'gift', 'special'])
const PAID = new Set(['payment_confirmed', 'delivered'])
const EPS = 0.005
const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0)
const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100

// บิลหนึ่งใบ → { ok, flags: [{ code, severity: 'high' | 'check', detail }] } · severity high = ควรตรวจทันที · check = อาจเป็นเหตุผลปกติ
export function auditPosOrder(order, cat = {}) {
  const flags = []
  const flag = (code, severity, detail) => flags.push({ code, severity, detail })
  const items = Array.isArray(order?.items) ? order.items : []
  const products = new Map((cat.retailItems || []).map((p) => [p.id, p]))
  const modPrice = new Map()
  for (const g of cat.posModifiers || []) for (const o of g.options || []) modPrice.set(`${g.id}|${o.id}`, num(o.price))

  items.forEach((it, i) => {
    const at = `รายการ ${i + 1}`
    if (it.kind !== 'retail') {
      flag('unexpected_kind', 'high', `${at}: หน้าร้านขายเฉพาะสินค้าหน้าร้าน (${it.kind})`)
      return
    }
    const p = products.get(it.retailId)
    if (!p) {
      flag('unknown_item', 'check', `${at}: ไม่พบสินค้า ${it.retailId} ในแคตาล็อก (อาจถูกลบหลังขาย)`)
    } else {
      let expMods = 0
      for (const m of it.mods || []) {
        const want = modPrice.get(`${m.groupId}|${m.optionId}`)
        if (want === undefined) {
          flag('unknown_modifier', 'check', `${at}: ตัวเลือก ${m.name ?? ''} ไม่อยู่ในการตั้งค่า`)
          expMods += num(m.price)
          continue
        }
        if (Math.abs(num(m.price) - want) > EPS) flag('modifier_price_mismatch', 'high', `${at}: ตัวเลือก ${m.name} ราคา ${m.price} ควรเป็น ${want}`)
        expMods += want
      }
      const expected = num(p.price) + expMods
      if (Math.abs(num(it.retailPrice) - expected) > EPS) flag('base_price_mismatch', 'high', `${at}: ราคาฐาน ${it.retailPrice} ควรเป็น ${expected} (${p.name ?? p.id})`)
    }
    if (Math.abs(num(it.fullPrice) - num(it.retailPrice)) > EPS) flag('full_price_mismatch', 'high', `${at}: ราคาเต็ม ${it.fullPrice} ไม่ตรงราคาฐาน ${it.retailPrice}`)
    const unit = num(it.unitPrice)
    if (unit < -EPS) flag('negative_price', 'high', `${at}: ราคาต่อชิ้นติดลบ ${it.unitPrice}`)
    const disc = Array.isArray(it.discounts) ? it.discounts : []
    let sum = 0
    for (const d of disc) {
      if (!ALLOWED_DISCOUNT.has(d.kind)) flag('unknown_discount', 'high', `${at}: ส่วนลดประเภท ${d.kind} ไม่อยู่ในรายการที่ใช้ได้`)
      if (num(d.amount) < -EPS) flag('negative_discount', 'high', `${at}: ส่วนลดติดลบ ${d.amount}`)
      sum += num(d.amount)
    }
    // ราคาเต็ม = ราคาสุทธิต่อชิ้น + ส่วนลดทุกแหล่ง (ปัดเศษต่อชิ้น จึงให้คลาดเคลื่อนได้เล็กน้อยตามจำนวนรายการส่วนลด)
    if (Math.abs(num(it.fullPrice) - unit - sum) > 0.02 * (1 + disc.length)) flag('line_math', 'high', `${at}: ราคาเต็ม ${it.fullPrice} − ราคาสุทธิ ${it.unitPrice} ≠ ส่วนลดรวม ${r2(sum)}`)
  })

  const subtotal = items.reduce((s, i) => s + num(i.unitPrice) * num(i.qty), 0)
  const adj = num(order?.adjustment?.amount)
  if (adj > EPS) flag('adjustment_positive', 'high', `ส่วนลดท้ายบิลเป็นบวก ${adj}`)
  else if (-adj > subtotal + EPS) flag('adjustment_too_large', 'high', `ส่วนลดท้ายบิล ${-adj} เกินยอดสินค้า ${r2(subtotal)}`)

  if (PAID.has(order?.status)) {
    const t = orderTotals({ ...order, items, payments: Array.isArray(order.payments) ? order.payments : [] })
    if (t.paid <= EPS && t.total > EPS) flag('paid_without_payment', 'high', 'สถานะชำระแล้ว แต่ไม่มีการรับชำระ')
    else if (Math.abs(t.paid - t.total) > 0.01) flag('payment_mismatch', 'high', `รับชำระ ${t.paid} ≠ ยอดบิล ${t.total}`)
  }
  return { ok: flags.length === 0, flags }
}
