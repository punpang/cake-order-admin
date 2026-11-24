// ค่าส่งพัสดุไปรษณีย์จากน้ำหนัก/ขนาดสินค้า (ฟังก์ชันล้วน · ใช้ทั้งแอปและ Edge Function ผ่าน schedlib)
// น้ำหนักที่คิด = max(น้ำหนักจริงรวมกล่อง, น้ำหนักปริมาตร) · น้ำหนักปริมาตร = Σ(กว้าง×ยาว×สูง×จำนวน) ÷ ตัวหาร (ซม.³/กก.) ×1000 กรัม
// ราคา = ขั้นแรกที่น้ำหนักที่คิด ≤ upToG · เกินขั้นสูงสุด = overweight

export const DEFAULT_PARCEL = { boxG: 0, volDivisor: 5000, rates: [] }
export const PARCEL_LIMITS = { weightG: 50000, dimCm: 200, boxG: 50000, rateG: 100000, price: 100000, rows: 30, divMin: 1000, divMax: 20000, qty: 10000 }

const isNum = (v) => (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '')) && Number.isFinite(Number(v))
const toNum = (v) => (isNum(v) ? Number(v) : NaN)
const int = (v, lo, hi) => { const n = toNum(v); return Number.isInteger(n) && n >= lo && n <= hi }
const dim = (v) => { const n = toNum(v); return Number.isFinite(n) && n > 0 && n <= PARCEL_LIMITS.dimCm }
const blank = (v) => v == null || String(v).trim() === ''

export function cleanParcelConfig(raw) {
  const c = raw || {}
  const boxG = int(c.boxG, 0, PARCEL_LIMITS.boxG) ? toNum(c.boxG) : 0
  const volDivisor = int(c.volDivisor, PARCEL_LIMITS.divMin, PARCEL_LIMITS.divMax) ? toNum(c.volDivisor) : DEFAULT_PARCEL.volDivisor
  const valid = (Array.isArray(c.rates) ? c.rates : []).filter((r) => r && int(r.upToG, 1, PARCEL_LIMITS.rateG) && isNum(r.price) && toNum(r.price) >= 0 && toNum(r.price) <= PARCEL_LIMITS.price)
  const byWeight = new Map()
  for (const r of valid) byWeight.set(toNum(r.upToG), { upToG: toNum(r.upToG), price: toNum(r.price) })
  const rates = [...byWeight.values()].sort((a, b) => a.upToG - b.upToG).slice(0, PARCEL_LIMITS.rows)
  return { boxG, volDivisor, rates }
}

// ข้อความตรวจตั้งค่าก่อนบันทึก ('' = ผ่าน) · ตารางว่างผ่านได้
export function parcelConfigError(raw) {
  const c = raw || {}
  if (c.boxG !== undefined && !int(c.boxG, 0, PARCEL_LIMITS.boxG)) return 'น้ำหนักกล่องต้องเป็นจำนวนเต็มกรัม 0–50000'
  if (c.volDivisor !== undefined && !int(c.volDivisor, PARCEL_LIMITS.divMin, PARCEL_LIMITS.divMax)) return 'ตัวหารปริมาตรต้องเป็นจำนวนเต็ม 1000–20000'
  const rows = Array.isArray(c.rates) ? c.rates : []
  if (rows.length > PARCEL_LIMITS.rows) return 'ตั้งได้ไม่เกิน 30 ขั้น'
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] || {}
    if (!int(r.upToG, 1, PARCEL_LIMITS.rateG) || !isNum(r.price) || toNum(r.price) < 0 || toNum(r.price) > PARCEL_LIMITS.price) {
      return `ขั้นที่ ${i + 1}: กรอกน้ำหนักสูงสุด (กรัม) และราคาให้ครบ`
    }
  }
  const sorted = rows.map((r) => ({ w: toNum(r.upToG), p: toNum(r.price) })).sort((a, b) => a.w - b.w)
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].w === sorted[i - 1].w) return 'น้ำหนักของขั้นซ้ำกัน'
    if (sorted[i].p < sorted[i - 1].p) return 'ราคาต้องไม่ลดลงเมื่อน้ำหนักมากขึ้น'
  }
  return ''
}

// ค่าฟอร์มของสินค้า: น้ำหนักกรัม + ขนาดสามด้าน (สตริง เว้นว่างเมื่อไม่มีข้อมูล)
export function parcelFormOf(item) {
  const s = (v) => (v == null ? '' : String(v))
  return { weightG: s(item?.weightG), dimW: s(item?.dimsCm?.w), dimL: s(item?.dimsCm?.l), dimH: s(item?.dimsCm?.h) }
}

// ค่าที่บันทึกลงสินค้า: ว่างทั้งหมด = null ทั้งคู่ (ไม่กรอกก็บันทึกได้)
export function parcelFieldsOf(form) {
  if ([form.weightG, form.dimW, form.dimL, form.dimH].some(blank)) return { weightG: null, dimsCm: null }
  return { weightG: Number(form.weightG), dimsCm: { w: Number(form.dimW), l: Number(form.dimL), h: Number(form.dimH) } }
}

// ตรวจฟอร์มสินค้า ('' = ผ่าน) · เว้นว่างทั้งหมดผ่าน · กรอกบางส่วนไม่ผ่าน
export function parcelDimsError(form) {
  const all = [form.weightG, form.dimW, form.dimL, form.dimH]
  if (all.every(blank)) return ''
  if (all.some(blank)) return 'กรอกน้ำหนักและขนาดให้ครบ หรือเว้นว่างทั้งหมด'
  if (!(/^\d+$/.test(String(form.weightG).trim()) && int(form.weightG, 1, PARCEL_LIMITS.weightG))) return 'น้ำหนักต้องเป็นจำนวนเต็มกรัม 1–50000'
  if (![form.dimW, form.dimL, form.dimH].every(dim)) return 'ขนาดแต่ละด้านต้องมากกว่า 0 และไม่เกิน 200 ซม.'
  return ''
}

export function hasParcelDims(item) {
  return !!item && int(item.weightG, 1, PARCEL_LIMITS.weightG) && !!item.dimsCm && dim(item.dimsCm.w) && dim(item.dimsCm.l) && dim(item.dimsCm.h)
}

// น้ำหนักสินค้ารวม (ไม่รวมกล่อง) และน้ำหนักปริมาตร · คืน error ถ้ารายการไม่ถูกต้อง
export function parcelWeight(lines, retailItems, cfg) {
  if (!Array.isArray(lines) || lines.length === 0) return { ok: false, error: 'empty' }
  const byId = new Map((retailItems || []).map((x) => [x.id, x]))
  const need = new Map()
  for (const ln of lines) {
    if (typeof ln?.qty !== 'number' || !Number.isInteger(ln.qty) || ln.qty < 1 || ln.qty > PARCEL_LIMITS.qty) return { ok: false, error: 'bad_qty' }
    const item = byId.get(ln.retailId)
    if (!item) return { ok: false, error: 'bad_item', itemId: ln.retailId }
    if (!hasParcelDims(item)) return { ok: false, error: 'missing_dims', itemId: ln.retailId }
    need.set(ln.retailId, (need.get(ln.retailId) || 0) + ln.qty)
  }
  const c = cleanParcelConfig(cfg)
  if (c.rates.length === 0) return { ok: false, error: 'no_rates' }
  let weightG = 0
  let volume = 0
  for (const [id, qty] of need) {
    const d = byId.get(id).dimsCm
    weightG += qty * byId.get(id).weightG
    volume += qty * d.w * d.l * d.h
  }
  const volumetricG = (volume * 1000) / c.volDivisor
  return { ok: true, weightG, boxG: c.boxG, volumetricG, config: c }
}

// ค่าส่งพัสดุ: {ok, fee, detail} หรือ {ok:false, error, itemId?}
export function parcelFee(lines, retailItems, cfg) {
  const w = parcelWeight(lines, retailItems, cfg)
  if (!w.ok) return w
  const actual = w.weightG + w.boxG
  // ปัดทศนิยมก่อนปัดขึ้น กันสัญญาณรบกวนของจุดลอยตัว
  const chargeableG = Math.ceil(Math.round(Math.max(actual, w.volumetricG) * 1000) / 1000)
  const tier = w.config.rates.find((r) => chargeableG <= r.upToG)
  if (!tier) return { ok: false, error: 'overweight' }
  return {
    ok: true,
    fee: tier.price,
    detail: { weightG: w.weightG, boxG: w.boxG, volumetricG: w.volumetricG, chargeableG, tierUpToG: tier.upToG, tierPrice: tier.price },
  }
}
