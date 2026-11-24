// ค่าส่งพัสดุ = ค่าธรรมเนียมร้าน (เหมาต่อออเดอร์) + ค่ากล่อง + ค่าขนส่งจากตาราง กล่อง×ขั้นน้ำหนัก (ฟังก์ชันล้วน · ใช้ทั้งแอปและ Edge Function ผ่าน schedlib)
// กล่อง: เลือกกล่องที่เล็กที่สุดซึ่งปริมาตรรวมของสินค้าใส่ได้ · น้ำหนักที่คิด = น้ำหนักสินค้ารวม + น้ำหนักกล่องที่เลือก
// ขั้น: ขั้นแรกที่น้ำหนักที่คิด ≤ steps[i] · ราคาขนส่ง = prices[ชื่อกล่อง][i] · เกินขั้นสูงสุด = overweight

export const PARCEL_LIMITS = {
  weightG: 50000, dimCm: 200, boxG: 50000, stepG: 100000, price: 100000, qty: 10000,
  steps: 43, boxes: 20, sumCm: 120, maxSideCm: 60,
}
export const DEFAULT_PARCEL = { fee: 0, boxes: [], steps: [], prices: {} }
// ตาราง EMS ในประเทศ (โปสเตอร์ปี 2023 · [น้ำหนักไม่เกิน กรัม, ราคาบาท]) · ค่าเดียวทุกพื้นที่ ใช้เป็นค่าตั้งต้นให้ร้านแก้ได้
export const EMS_DOMESTIC = [
  [20, 32], [100, 37], [250, 42], [500, 52], [1000, 67], [1500, 82], [2000, 97], [2500, 100], [3000, 105], [3500, 110],
  [4000, 120], [4500, 120], [5000, 120], [5500, 130], [6000, 140], [6500, 150], [7000, 160], [7500, 170], [8000, 180], [8500, 190],
  [9000, 200], [9500, 210], [10000, 220], [11000, 230], [12000, 240], [13000, 250], [14000, 260], [15000, 270], [16000, 280],
  [17000, 290], [18000, 300], [19000, 310], [20000, 320], [21000, 330], [22000, 340], [23000, 350], [24000, 360], [25000, 380],
  [26000, 400], [27000, 420], [28000, 440], [29000, 460], [30000, 480],
]

const isNum = (v) => (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '')) && Number.isFinite(Number(v))
const toNum = (v) => (isNum(v) ? Number(v) : NaN)
const int = (v, lo, hi) => { const n = toNum(v); return Number.isInteger(n) && n >= lo && n <= hi }
const dim = (v) => { const n = toNum(v); return Number.isFinite(n) && n > 0 && n <= PARCEL_LIMITS.dimCm }
const blank = (v) => v == null || String(v).trim() === ''
const money = (v) => isNum(v) && toNum(v) >= 0 && toNum(v) <= PARCEL_LIMITS.price

// กล่องหนึ่งใบ: ขนาดแต่ละด้านเป็นจำนวนเต็ม 1–60 ซม. และรวมสามด้านไม่เกิน 120 ซม. (ขนาดมาตรฐาน)
const boxDimOk = (v) => int(v, 1, PARCEL_LIMITS.maxSideCm)
const boxSizeOk = (d) => !!d && boxDimOk(d.w) && boxDimOk(d.l) && boxDimOk(d.h) && toNum(d.w) + toNum(d.l) + toNum(d.h) <= PARCEL_LIMITS.sumCm

const boxOf = (b) => {
  if (!b || typeof b.name !== 'string' || b.name.trim() === '' || !boxSizeOk(b.dims)) return null
  if (!int(b.boxG, 0, PARCEL_LIMITS.boxG) || !money(b.price)) return null
  const d = { w: toNum(b.dims.w), l: toNum(b.dims.l), h: toNum(b.dims.h) }
  return { name: b.name.trim(), dims: d, volumeCm3: d.w * d.l * d.h, boxG: toNum(b.boxG), price: toNum(b.price) }
}

// ตั้งค่าที่ผ่านการตรวจแล้ว (เรียงกล่องตามปริมาตร และขั้นตามน้ำหนัก) · ค่าที่ผิดรูปแบบถูกตัดทิ้ง
export function cleanParcelConfig(raw) {
  const c = raw || {}
  const fee = money(c.fee) ? toNum(c.fee) : 0
  const boxes = (Array.isArray(c.boxes) ? c.boxes : []).map(boxOf).filter(Boolean)
    .slice(0, PARCEL_LIMITS.boxes).sort((a, b) => a.volumeCm3 - b.volumeCm3)
  const steps = [...new Set((Array.isArray(c.steps) ? c.steps : []).filter((s) => int(s, 1, PARCEL_LIMITS.stepG)).map(toNum))]
    .sort((a, b) => a - b).slice(0, PARCEL_LIMITS.steps)
  const prices = {}
  for (const b of boxes) prices[b.name] = Array.isArray(c.prices?.[b.name]) ? c.prices[b.name].map((p) => (money(p) ? toNum(p) : null)) : []
  return { fee, boxes, steps, prices }
}

// ข้อความตรวจตั้งค่าก่อนบันทึก ('' = ผ่าน) · ตั้งค่าว่างทั้งหมดผ่านได้
export function parcelConfigError(raw) {
  const c = raw || {}
  if (c.fee !== undefined && !money(c.fee)) return 'ค่าธรรมเนียมร้านต้องเป็นตัวเลข 0–100000'
  const boxes = Array.isArray(c.boxes) ? c.boxes : []
  if (boxes.length > PARCEL_LIMITS.boxes) return `ตั้งได้ไม่เกิน ${PARCEL_LIMITS.boxes} กล่อง`
  const names = new Set()
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i] || {}
    const at = `กล่องที่ ${i + 1}`
    if (typeof b.name !== 'string' || b.name.trim() === '') return `${at}: ใส่ชื่อกล่อง`
    if (names.has(b.name.trim())) return `${at}: ชื่อกล่องซ้ำ`
    names.add(b.name.trim())
    const d = b.dims || {}
    if (![d.w, d.l, d.h].every(boxDimOk)) return `${at}: ขนาดแต่ละด้านต้องเป็นจำนวนเต็ม 1–${PARCEL_LIMITS.maxSideCm} ซม.`
    if (toNum(d.w) + toNum(d.l) + toNum(d.h) > PARCEL_LIMITS.sumCm) return `${at}: กว้าง+ยาว+สูง ต้องไม่เกิน ${PARCEL_LIMITS.sumCm} ซม.`
    if (!int(b.boxG, 0, PARCEL_LIMITS.boxG)) return `${at}: น้ำหนักกล่องต้องเป็นจำนวนเต็มกรัม 0–50000`
    if (!money(b.price)) return `${at}: ราคากล่องต้องเป็นตัวเลข 0–100000`
  }
  const steps = Array.isArray(c.steps) ? c.steps : []
  if (steps.length > PARCEL_LIMITS.steps) return `ตั้งได้ไม่เกิน ${PARCEL_LIMITS.steps} ขั้น`
  for (let i = 0; i < steps.length; i++) {
    if (!int(steps[i], 1, PARCEL_LIMITS.stepG)) return `ขั้นที่ ${i + 1}: น้ำหนักต้องเป็นจำนวนเต็มกรัม 1–100000`
    if (i > 0 && toNum(steps[i]) <= toNum(steps[i - 1])) return `ขั้นที่ ${i + 1}: น้ำหนักต้องมากกว่าขั้นก่อนหน้า`
  }
  for (const b of boxes) {
    const row = c.prices?.[b.name?.trim?.()] || []
    if (row.length !== steps.length) return `${b.name}: กรอกราคาให้ครบทุกขั้น`
    for (let i = 0; i < row.length; i++) {
      if (!money(row[i])) return `${b.name} ขั้นที่ ${i + 1}: ราคาต้องเป็นตัวเลข 0–100000`
      if (i > 0 && toNum(row[i]) < toNum(row[i - 1])) return `${b.name}: ราคาต้องไม่ลดลงเมื่อน้ำหนักมากขึ้น`
    }
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

// เลือกกล่องจากปริมาตรรวมของสินค้า (กล่องเล็กสุดที่ใส่ได้) · คืน {ok, box, weightG, volumeCm3} หรือ {ok:false, error, itemId?}
export function parcelBox(lines, retailItems, cfg) {
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
  if (c.boxes.length === 0) return { ok: false, error: 'no_boxes' }
  let weightG = 0
  let volumeCm3 = 0
  for (const [id, qty] of need) {
    const it = byId.get(id)
    weightG += qty * it.weightG
    volumeCm3 += qty * it.dimsCm.w * it.dimsCm.l * it.dimsCm.h
  }
  const box = c.boxes.find((b) => volumeCm3 <= b.volumeCm3)
  if (!box) return { ok: false, error: 'too_big' }
  return { ok: true, box, weightG, volumeCm3 }
}

// ค่าส่งรวม = ค่าธรรมเนียมร้าน + ค่ากล่อง + ค่าขนส่ง · คืน {ok, fee, boxPrice, shipping, total, box, weightG, chargeableG, step, volumeCm3} หรือ {ok:false, error, itemId?}
export function parcelFee(lines, retailItems, cfg) {
  const b = parcelBox(lines, retailItems, cfg)
  if (!b.ok) return b
  const c = cleanParcelConfig(cfg)
  if (c.steps.length === 0) return { ok: false, error: 'no_steps' }
  const chargeableG = b.weightG + b.box.boxG
  const idx = c.steps.findIndex((s) => chargeableG <= s)
  if (idx < 0) return { ok: false, error: 'overweight' }
  const shipping = c.prices[b.box.name]?.[idx]
  if (!Number.isFinite(shipping)) return { ok: false, error: 'no_price' }
  const total = c.fee + b.box.price + shipping
  return {
    ok: true,
    fee: c.fee,
    boxPrice: b.box.price,
    shipping,
    total,
    box: { name: b.box.name, price: b.box.price, boxG: b.box.boxG },
    weightG: b.weightG,
    chargeableG,
    step: c.steps[idx],
    volumeCm3: b.volumeCm3,
  }
}
