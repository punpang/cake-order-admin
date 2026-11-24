// ส่วนลดค่าส่งตามขั้นยอดซื้อ (ฟังก์ชันล้วน · ใช้ทั้งแอปและ Edge Function ผ่าน schedlib)
// ขั้น = [{min, value}] (บาท) · ใช้ขั้นสูงสุดที่ฐาน ≥ min เพียงขั้นเดียว · ลดได้ไม่เกินค่าส่ง

export const SHIP_OFF_LIMITS = { rows: 10, price: 100000 }

const isNum = (v) => (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '')) && Number.isFinite(Number(v))
const toNum = (v) => (isNum(v) ? Number(v) : NaN)
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100

// ตัดแถวผิดรูปแบบทิ้ง เรียงตาม min และให้เหลือไม่เกินจำนวนขั้นที่กำหนด
export function cleanShipOff(raw) {
  const rows = (Array.isArray(raw) ? raw : [])
    .filter((r) => r && Number.isInteger(toNum(r.min)) && toNum(r.min) >= 1 && isNum(r.value) && toNum(r.value) >= 0 && toNum(r.value) <= SHIP_OFF_LIMITS.price)
    .map((r) => ({ min: toNum(r.min), value: round2(toNum(r.value)) }))
  const byMin = new Map()
  for (const r of rows) if (!byMin.has(r.min)) byMin.set(r.min, r)
  return [...byMin.values()].sort((a, b) => a.min - b.min).slice(0, SHIP_OFF_LIMITS.rows)
}

// ข้อความตรวจก่อนบันทึก ('' = ผ่าน)
export function shipOffError(raw) {
  const rows = Array.isArray(raw) ? raw : []
  if (rows.length > SHIP_OFF_LIMITS.rows) return `ตั้งได้ไม่เกิน ${SHIP_OFF_LIMITS.rows} ขั้น`
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] || {}
    if (!Number.isInteger(toNum(r.min)) || toNum(r.min) < 1) return `ขั้นที่ ${i + 1}: ยอดซื้อต้องเป็นจำนวนเต็มบาท ≥ 1`
    if (!isNum(r.value) || toNum(r.value) < 0 || toNum(r.value) > SHIP_OFF_LIMITS.price) return `ขั้นที่ ${i + 1}: ส่วนลดต้องเป็นตัวเลข 0–${SHIP_OFF_LIMITS.price}`
    if (i > 0 && toNum(r.min) <= toNum(rows[i - 1].min)) return `ขั้นที่ ${i + 1}: ยอดซื้อต้องมากกว่าขั้นก่อนหน้า`
  }
  return ''
}

// ขั้นที่ใช้ = ขั้นสูงสุดที่ goodsExVat ≥ min · ส่วนลด = min(value, shippingFee)
export function shipOffDiscount({ goodsExVat, shippingFee, tiers }) {
  const goods = Number(goodsExVat) || 0
  const fee = Math.max(0, Number(shippingFee) || 0)
  let hit = null
  for (const t of cleanShipOff(tiers)) if (goods >= t.min) hit = t
  if (!hit) return { tier: null, amount: 0 }
  return { tier: hit.min, amount: round2(Math.min(hit.value, fee)) }
}
