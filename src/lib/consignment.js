// สินค้าฝากขาย (consignment): ยอดขายแยกตามผู้ฝากขาย · สรุปเป็นรอบตามช่วงวันที่ที่กำหนดเอง · จ่ายผู้ฝากขายแล้วจึงล็อกรอบ
// ฟังก์ชันล้วน ไม่แตะฐานข้อมูล · ยอดขาย = ยอดสุทธิของรายการสินค้าฝากขาย (หลังส่วนลดรายการ) ไม่รวมส่วนลดทั้งบิล/คูปอง/ค่าส่ง
export const CONSIGN_PAYOUTS = [
  { v: 'percent', l: 'แบ่งเปอร์เซ็นต์จากยอดขาย' },
  { v: 'fixed', l: 'จ่ายค่าคงที่ต่อรอบ' },
]
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100

// ข้อตกลงของสินค้าฝากขาย (snapshot ตอนขาย) · ไม่ใช่สินค้าฝากขาย = null
export function consignTermsOf(item) {
  if (!item?.consign) return null
  const c = item.consign
  const name = String(c.name ?? '').trim()
  if (!name) return null
  const payout = c.payout === 'fixed' ? 'fixed' : 'percent'
  return { name, payout, percent: Number(c.percent) || 0, fixed: round2(Number(c.fixed) || 0) }
}

// ตรวจข้อตกลงที่แอดมินกรอก · คืนข้อความผิดพลาด หรือ '' ถ้าผ่าน
export function consignTermsError({ consignment, consignorName, consignPayout, consignPercent, consignFixed }) {
  if (!consignment) return ''
  if (!String(consignorName ?? '').trim()) return 'สินค้าฝากขายต้องระบุชื่อผู้ฝากขาย'
  if (consignPayout === 'fixed') {
    const f = Number(consignFixed)
    if (!(f >= 0) || consignFixed === '' || consignFixed == null) return 'กรอกค่าคงที่ต่อรอบ (0 ขึ้นไป)'
    return ''
  }
  const p = Number(consignPercent)
  if (!(p > 0 && p <= 100)) return 'เปอร์เซ็นต์ต้องมากกว่า 0 และไม่เกิน 100'
  return ''
}

export function validRange(from, to) {
  return DATE_RE.test(String(from)) && DATE_RE.test(String(to)) && String(from) <= String(to)
}

// ยอดจ่ายผู้ฝากขายในรอบ: เปอร์เซ็นต์ = ยอดขาย × % · ค่าคงที่ = จำนวนที่ตั้งไว้ (ไม่เกินยอดขายเมื่อยอดขายน้อยกว่า)
export function payoutOf(terms, sales) {
  const s = round2(Math.max(0, Number(sales) || 0))
  if (terms.payout === 'fixed') return round2(Math.min(terms.fixed, s))
  return round2((s * terms.percent) / 100)
}

// รายการขายของผู้ฝากขายในช่วงวันที่ (orders: ออร์เดอร์ที่ส่งมอบแล้ว · dayOf(order) = วันที่ของออร์เดอร์ 'YYYY-MM-DD' ตามเวลาร้าน)
export function consignLinesOf({ orders = [], consignor, from, to, dayOf }) {
  const out = []
  for (const o of orders) {
    if (!o || o.status !== 'delivered') continue
    const day = dayOf(o)
    if (day < from || day > to) continue
    for (const it of o.items || []) {
      if (!it || it.promoGift) continue
      const t = consignTermsOf(it)
      if (!t || t.name !== consignor) continue
      out.push({ orderId: o.id, code: o.code || '', day, item: it.name || '', qty: Number(it.qty) || 0, amount: round2((Number(it.unitPrice) || 0) * (Number(it.qty) || 0)), terms: t })
    }
  }
  return out
}

// สรุปรอบของผู้ฝากขาย: ยอดขาย ยอดจ่าย ส่วนร้าน และรายการที่รวม · terms = ข้อตกลงของผู้ฝากขายคนนั้น (ตัวล่าสุดในรายการ)
export function settlementOf({ orders, consignor, from, to, dayOf }) {
  if (!validRange(from, to)) return { ok: false, error: 'ช่วงวันที่ไม่ถูกต้อง' }
  const lines = consignLinesOf({ orders, consignor, from, to, dayOf })
  const terms = lines.length ? lines[lines.length - 1].terms : null
  const sales = round2(lines.reduce((s, l) => s + l.amount, 0))
  const payout = terms ? payoutOf(terms, sales) : 0
  return { ok: true, lines, sales, payout, shop: round2(sales - payout), orderIds: [...new Set(lines.map((l) => l.orderId))], terms }
}

// รอบที่ทับช่วงเดียวกับผู้ฝากขายคนเดิมหรือไม่ (ห้ามสรุปซ้ำซ้อน)
export function overlapsRound(rounds, consignor, from, to) {
  return (rounds || []).some((r) => r.consignor === consignor && !(r.to < from || r.from > to))
}

// วันที่ของออร์เดอร์ตามเวลาไทย (UTC+7 คงที่) 'YYYY-MM-DD'
export function bkkDay(iso) {
  const t = Date.parse(String(iso || ''))
  return Number.isFinite(t) ? new Date(t + 7 * 3600e3).toISOString().slice(0, 10) : ''
}
