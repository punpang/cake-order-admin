// ทดสอบค่าส่งพัสดุ: ค่าธรรมเนียมร้าน + ค่ากล่อง + ตาราง กล่อง×ขั้นน้ำหนัก (ฟังก์ชันล้วน) · รัน: node src/lib/parcelShipping.test.mjs
import assert from 'node:assert/strict'
import { DEFAULT_PARCEL, EMS_DOMESTIC, PARCEL_LIMITS, cleanParcelConfig, parcelConfigError, parcelBox, parcelFee, parcelFormOf, parcelFieldsOf, parcelDimsError, hasParcelDims } from './parcelShipping.js'

let fail = 0
const t = (name, fn) => { try { fn(); console.log(`PASS ${name}`) } catch (e) { fail++; console.log(`FAIL ${name}: ${e.message}`) } }

// กล่อง S (ปริมาตร 8000) และ M (ปริมาตร 27000 = 30×30×30)
const cfg = {
  fee: 10,
  boxes: [
    { name: 'M', dims: { w: 30, l: 30, h: 30 }, boxG: 300, price: 20 },
    { name: 'S', dims: { w: 20, l: 20, h: 20 }, boxG: 100, price: 15 },
  ],
  steps: [500, 1000, 2000],
  prices: { S: [40, 60, 90], M: [50, 70, 100] },
}
const items = [
  { id: 'A', weightG: 300, dimsCm: { w: 10, l: 10, h: 10 } }, // ปริมาตร 1000
  { id: 'B', weightG: 200, dimsCm: { w: 20, l: 20, h: 20 } }, // ปริมาตร 8000 พอดีกล่อง S
  { id: 'C', weightG: 100, dimsCm: { w: 30, l: 30, h: 30 } }, // ปริมาตร 27000 พอดีกล่อง M
  { id: 'D', weightG: 100, dimsCm: { w: 40, l: 40, h: 40 } }, // ปริมาตร 64000 > กล่องใหญ่สุด
  { id: 'G', dimsCm: { w: 5, l: 5, h: 5 } }, // ไม่มีน้ำหนัก
  { id: 'I', weightG: 400, dimsCm: { w: 10, l: 10, h: 10 } }, // ใช้ทดสอบขอบขั้น 500
  { id: 'J', weightG: 1, dimsCm: { w: 10, l: 10, h: 10 } }, // ใช้ทดสอบขอบขั้น 501
]
const fee = (lines, c = cfg) => parcelFee(lines, items, c)

t('ปริมาตรรวม 1000 เลือกกล่อง S (เล็กสุดที่ใส่ได้)', () => {
  const r = parcelBox([{ retailId: 'A', qty: 1 }], items, cfg)
  assert.equal(r.ok, true)
  assert.equal(r.box.name, 'S')
})
t('ปริมาตรรวมพอดี 8000 ยังเลือกกล่อง S', () => {
  assert.equal(parcelBox([{ retailId: 'B', qty: 1 }], items, cfg).box.name, 'S')
})
t('ปริมาตรรวมเกิน 8000 เลือกกล่อง M', () => {
  assert.equal(parcelBox([{ retailId: 'B', qty: 1 }, { retailId: 'A', qty: 1 }], items, cfg).box.name, 'M')
})
t('ปริมาตรรวมเกินกล่องใหญ่สุด → too_big', () => {
  assert.equal(parcelBox([{ retailId: 'D', qty: 1 }], items, cfg).error, 'too_big')
})
t('ยังไม่มีกล่อง → no_boxes', () => {
  assert.equal(parcelBox([{ retailId: 'A', qty: 1 }], items, { ...cfg, boxes: [] }).error, 'no_boxes')
})
t('ค่าส่งรวม = ค่าธรรมเนียม + ค่ากล่อง + ค่าขนส่ง (A: น้ำหนัก 300+100=400 → ขั้น 500 ราคา S 40)', () => {
  const r = fee([{ retailId: 'A', qty: 1 }])
  assert.equal(r.ok, true)
  assert.equal(r.box.name, 'S')
  assert.equal(r.weightG, 300)
  assert.equal(r.shipping, 40)
  assert.equal(r.boxPrice, 15)
  assert.equal(r.fee, 10)
  assert.equal(r.total, 10 + 15 + 40)
})
t('ขอบขั้น: น้ำหนักรวมกล่องพอดี 500 (I 400 + กล่อง S 100) → ขั้น 500 ราคา S 40', () => {
  const r = fee([{ retailId: 'I', qty: 1 }])
  assert.equal(r.box.name, 'S')
  assert.equal(r.chargeableG, 500)
  assert.equal(r.step, 500)
  assert.equal(r.shipping, 40)
})
t('ขอบขั้น: น้ำหนักรวมกล่อง 501 (I 400 + J 1 + กล่อง S 100) → ขั้น 1000 ราคา S 60', () => {
  const r = fee([{ retailId: 'I', qty: 1 }, { retailId: 'J', qty: 1 }])
  assert.equal(r.box.name, 'S')
  assert.equal(r.step, 1000)
  assert.equal(r.shipping, 60)
})
t('เกินขั้นสูงสุด → overweight', () => {
  const heavy = [{ id: 'H', weightG: 2000, dimsCm: { w: 5, l: 5, h: 5 } }]
  const r = parcelFee([{ retailId: 'H', qty: 1 }], heavy, cfg)
  assert.equal(r.ok, false)
  assert.equal(r.error, 'overweight')
})
t('ไม่มีขั้นตั้งไว้ → no_steps', () => {
  assert.equal(fee([{ retailId: 'A', qty: 1 }], { ...cfg, steps: [] }).error, 'no_steps')
})
t('ราคาของกล่องที่ขั้นนั้นหายไป → no_price', () => {
  assert.equal(fee([{ retailId: 'A', qty: 1 }], { ...cfg, prices: { M: [50, 70, 100] } }).error, 'no_price')
})
t('ค่าธรรมเนียมว่าง/ไม่ได้ตั้ง → 0', () => {
  const r = fee([{ retailId: 'A', qty: 1 }], { ...cfg, fee: undefined })
  assert.equal(r.fee, 0)
  assert.equal(r.total, 0 + 15 + 40)
})
t('สินค้าไม่มีน้ำหนัก/ขนาด → missing_dims พร้อม itemId', () => {
  const r = fee([{ retailId: 'G', qty: 1 }])
  assert.equal(r.error, 'missing_dims')
  assert.equal(r.itemId, 'G')
})
t('จำนวนไม่ถูกต้อง → bad_qty', () => {
  assert.equal(fee([{ retailId: 'A', qty: 0 }]).error, 'bad_qty')
})
t('รายการว่าง → empty', () => {
  assert.equal(fee([]).error, 'empty')
  assert.equal(fee(undefined).error, 'empty')
})

t('cleanParcelConfig: เรียงกล่องตามปริมาตรและขั้นตามน้ำหนัก', () => {
  const c = cleanParcelConfig(cfg)
  assert.deepEqual(c.boxes.map((b) => b.name), ['S', 'M'])
  assert.equal(c.boxes[0].volumeCm3, 8000)
  assert.deepEqual(c.steps, [500, 1000, 2000])
})
t('cleanParcelConfig: รูปเดิม {boxG, volDivisor, rates} → boxes ว่าง', () => {
  const c = cleanParcelConfig({ boxG: 100, volDivisor: 5000, rates: [{ upToG: 500, price: 40 }] })
  assert.deepEqual(c.boxes, [])
  assert.deepEqual(c.steps, [])
})
t('cleanParcelConfig: undefined → DEFAULT_PARCEL', () => {
  assert.deepEqual(cleanParcelConfig(undefined), DEFAULT_PARCEL)
})

t('parcelConfigError: ตั้งค่าที่ถูกต้องผ่าน (ว่าง)', () => {
  assert.equal(parcelConfigError(cfg), '')
  assert.equal(parcelConfigError(undefined), '')
})
t('parcelConfigError: ขั้นซ้ำ', () => {
  assert.notEqual(parcelConfigError({ ...cfg, steps: [500, 500, 2000], prices: { S: [1, 2, 3], M: [1, 2, 3] } }), '')
})
t('parcelConfigError: ขั้นไม่เรียง', () => {
  assert.notEqual(parcelConfigError({ ...cfg, steps: [1000, 500, 2000] }), '')
})
t('parcelConfigError: ราคาลดลงเมื่อน้ำหนักมากขึ้น', () => {
  assert.notEqual(parcelConfigError({ ...cfg, prices: { S: [60, 40, 90], M: [50, 70, 100] } }), '')
})
t('parcelConfigError: ชื่อกล่องซ้ำ', () => {
  assert.notEqual(parcelConfigError({ ...cfg, boxes: [cfg.boxes[0], { ...cfg.boxes[1], name: 'M' }] }), '')
})
t('parcelConfigError: ชื่อกล่องว่าง', () => {
  assert.notEqual(parcelConfigError({ ...cfg, boxes: [{ ...cfg.boxes[0], name: ' ' }] }), '')
})
t('parcelConfigError: ราคาของกล่องยาวไม่เท่าจำนวนขั้น', () => {
  assert.notEqual(parcelConfigError({ ...cfg, prices: { S: [40, 60], M: [50, 70, 100] } }), '')
})
t('parcelConfigError: กล่องด้านเกิน 60 ซม. → ผิด', () => {
  assert.notEqual(parcelConfigError({ ...cfg, boxes: [{ name: 'X', dims: { w: 61, l: 10, h: 10 }, boxG: 0, price: 0 }], steps: [], prices: {} }), '')
})
t('parcelConfigError: ผลรวมด้านของกล่องเกิน 120 ซม. → ผิด', () => {
  assert.notEqual(parcelConfigError({ ...cfg, boxes: [{ name: 'X', dims: { w: 50, l: 50, h: 21 }, boxG: 0, price: 0 }], steps: [], prices: {} }), '')
})
t('parcelConfigError: กล่อง 60×30×30 (รวม 120, ด้านยาวสุด 60) ผ่าน', () => {
  assert.equal(parcelConfigError({ ...cfg, boxes: [{ name: 'X', dims: { w: 60, l: 30, h: 30 }, boxG: 0, price: 0 }], steps: [], prices: {} }), '')
})
t('parcelConfigError: เกิน 43 ขั้น → ผิด', () => {
  const steps = Array.from({ length: 44 }, (_, i) => i + 1)
  const prices = { S: steps.map(() => 1), M: steps.map(() => 1) }
  assert.notEqual(parcelConfigError({ ...cfg, steps, prices }), '')
})
t('parcelConfigError: เพดาน 43 ขั้นพอดี ผ่าน', () => {
  const steps = Array.from({ length: 43 }, (_, i) => i + 1)
  const prices = { S: steps.map(() => 1), M: steps.map(() => 1) }
  assert.equal(parcelConfigError({ ...cfg, steps, prices }), '')
})
t('ตาราง EMS: 43 แถว ขั้นเรียงขึ้น ราคาไม่ลดลง และตั้งค่าได้ครบ', () => {
  assert.equal(EMS_DOMESTIC.length, 43)
  for (let i = 1; i < EMS_DOMESTIC.length; i++) {
    assert.ok(EMS_DOMESTIC[i][0] > EMS_DOMESTIC[i - 1][0])
    assert.ok(EMS_DOMESTIC[i][1] >= EMS_DOMESTIC[i - 1][1])
  }
  assert.deepEqual(EMS_DOMESTIC[0], [20, 32])
  assert.deepEqual(EMS_DOMESTIC[42], [30000, 480])
  const cfg = { steps: EMS_DOMESTIC.map((r) => r[0]), prices: { S: EMS_DOMESTIC.map((r) => r[1]) }, boxes: [{ name: 'S', dims: { w: 20, l: 20, h: 20 }, boxG: 0, price: 0 }] }
  assert.equal(parcelConfigError(cfg), '')
})
t('PARCEL_LIMITS: 43 ขั้น 20 กล่อง ขนาดมาตรฐาน 120/60', () => {
  assert.equal(PARCEL_LIMITS.steps, 43)
  assert.equal(PARCEL_LIMITS.boxes, 20)
  assert.equal(PARCEL_LIMITS.sumCm, 120)
  assert.equal(PARCEL_LIMITS.maxSideCm, 60)
})

t('parcelFormOf/parcelFieldsOf: ค่าว่างทั้งหมดได้ null', () => {
  assert.deepEqual(parcelFieldsOf(parcelFormOf({})), { weightG: null, dimsCm: null })
})
t('parcelDimsError: กรอกบางส่วนไม่ผ่าน', () => {
  assert.notEqual(parcelDimsError({ weightG: '100', dimW: '', dimL: '1', dimH: '1' }), '')
})
t('hasParcelDims: ต้องมีน้ำหนักและขนาดครบ', () => {
  assert.equal(hasParcelDims(items[0]), true)
  assert.equal(hasParcelDims(items[4]), false)
})

if (fail) { console.log(`\n${fail} ล้มเหลว`); process.exit(1) }
console.log('\nผ่านทั้งหมด')
