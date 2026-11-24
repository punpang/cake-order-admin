// ทดสอบค่าส่งพัสดุจากน้ำหนัก/ขนาด (ฟังก์ชันล้วน) · รัน: node src/lib/parcelShipping.test.mjs
import assert from 'node:assert/strict'
import { DEFAULT_PARCEL, cleanParcelConfig, parcelConfigError, parcelFormOf, parcelFieldsOf, parcelDimsError, hasParcelDims, parcelFee } from './parcelShipping.js'

let fail = 0
const t = (name, fn) => { try { fn(); console.log(`PASS ${name}`) } catch (e) { fail++; console.log(`FAIL ${name}: ${e.message}`) } }

const cfg = { boxG: 100, volDivisor: 5000, rates: [{ upToG: 500, price: 40 }, { upToG: 1000, price: 60 }, { upToG: 2000, price: 90 }] }
const items = [
  { id: 'A', weightG: 800, dimsCm: { w: 20, l: 20, h: 10 } },
  { id: 'B', weightG: 200, dimsCm: { w: 30, l: 30, h: 20 } },
  { id: 'C', weightG: 100, dimsCm: { w: 20, l: 20, h: 20 } },
  { id: 'D', weightG: 900, dimsCm: { w: 5, l: 5, h: 5 } },
  { id: 'E', weightG: 901, dimsCm: { w: 5, l: 5, h: 5 } },
  { id: 'F', weightG: 100, dimsCm: { w: 20, l: 20, h: 10.002 } },
  { id: 'G', dimsCm: { w: 5, l: 5, h: 5 } }, // ไม่มีน้ำหนัก
]
const fee = (lines, c = cfg) => parcelFee(lines, items, c)

t('1×A: น้ำหนักจริง 900 (รวมกล่อง) ปริมาตร 800 → ขั้น 1000 ราคา 60', () => {
  const r = fee([{ retailId: 'A', qty: 1 }])
  assert.equal(r.ok, true)
  assert.equal(r.detail.chargeableG, 900)
  assert.equal(r.fee, 60)
})
t('2×A: 1700 g → ขั้น 2000 ราคา 90', () => {
  const r = fee([{ retailId: 'A', qty: 2 }])
  assert.equal(r.detail.chargeableG, 1700)
  assert.equal(r.fee, 90)
})
t('1×B: ปริมาตร 3600 > 2000 → overweight', () => {
  assert.deepEqual(fee([{ retailId: 'B', qty: 1 }]).ok, false)
  assert.equal(fee([{ retailId: 'B', qty: 1 }]).error, 'overweight')
})
t('1×C: ปริมาตร 1600 ชนะน้ำหนักจริง 200 → ขั้น 2000 ราคา 90', () => {
  const r = fee([{ retailId: 'C', qty: 1 }])
  assert.equal(r.detail.chargeableG, 1600)
  assert.equal(r.fee, 90)
})
t('ขอบขั้น: 1×D = 1000 พอดี → ราคา 60', () => {
  const r = fee([{ retailId: 'D', qty: 1 }])
  assert.equal(r.detail.chargeableG, 1000)
  assert.equal(r.fee, 60)
})
t('ขอบขั้น: 1×E = 1001 → ราคา 90', () => {
  assert.equal(fee([{ retailId: 'E', qty: 1 }]).fee, 90)
})
t('เศษทศนิยมของปริมาตรถูกปัดขึ้นเป็นจำนวนเต็ม (F: ปริมาตร 800.16 → 801 → ขั้น 1000)', () => {
  const r = fee([{ retailId: 'F', qty: 1 }])
  assert.equal(Number.isInteger(r.detail.chargeableG), true)
  assert.equal(r.detail.chargeableG, 801)
  assert.equal(r.fee, 60)
})
t('รายการซ้ำรวมจำนวน: A×1 + A×1 = 2×A', () => {
  const r = fee([{ retailId: 'A', qty: 1 }, { retailId: 'A', qty: 1 }])
  assert.equal(r.detail.chargeableG, 1700)
})
t('ข้อผิดพลาดของรายการ: ว่าง → empty', () => {
  assert.equal(fee([]).error, 'empty')
  assert.equal(fee(undefined).error, 'empty')
})
t('จำนวนผิด (0, 1.5, -1, "2", 10001) → bad_qty', () => {
  for (const qty of [0, 1.5, -1, '2', 10001]) assert.equal(fee([{ retailId: 'A', qty }]).error, 'bad_qty', String(qty))
})
t('รหัสสินค้าไม่มีในรายการ → bad_item', () => {
  assert.equal(fee([{ retailId: 'Z', qty: 1 }]).error, 'bad_item')
})
t('สินค้าไม่มีน้ำหนัก → missing_dims พร้อม itemId', () => {
  const r = fee([{ retailId: 'G', qty: 1 }])
  assert.equal(r.error, 'missing_dims')
  assert.equal(r.itemId, 'G')
})
t('ไม่มีตารางอัตรา (cfg undefined หรือ rates ว่าง) → no_rates ไม่ throw', () => {
  assert.equal(parcelFee([{ retailId: 'A', qty: 1 }], items, undefined).error, 'no_rates') // เรียกตรงเพราะตัวช่วย fee มีค่าเริ่มต้นที่จะรับ undefined แทน
  assert.equal(fee([{ retailId: 'A', qty: 1 }], { boxG: 0, rates: [] }).error, 'no_rates')
})
t('cleanParcelConfig(undefined) เท่ากับค่าตั้งต้น', () => {
  assert.deepEqual(cleanParcelConfig(undefined), DEFAULT_PARCEL)
})
t('cleanParcelConfig ทิ้งแถวที่ไม่ครบหรือผิดช่วง', () => {
  const r = cleanParcelConfig({ rates: [{ upToG: 0, price: 1 }, { upToG: 500 }, { upToG: 'x', price: 1 }, { upToG: 700, price: 50 }] })
  assert.deepEqual(r.rates, [{ upToG: 700, price: 50 }])
})
t('cleanParcelConfig เรียงขั้นน้อยไปมาก และซ้ำ upToG เก็บแถวหลังสุด', () => {
  const r = cleanParcelConfig({ rates: [{ upToG: 1000, price: 60 }, { upToG: 500, price: 40 }, { upToG: 500, price: 45 }] })
  assert.deepEqual(r.rates, [{ upToG: 500, price: 45 }, { upToG: 1000, price: 60 }])
})
t('cleanParcelConfig ตัดเหลือไม่เกิน 30 แถว และ volDivisor นอกช่วงกลับเป็น 5000', () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ upToG: (i + 1) * 100, price: i }))
  const r = cleanParcelConfig({ rates: many, volDivisor: 500 })
  assert.equal(r.rates.length, 30)
  assert.equal(r.volDivisor, 5000)
})
t('parcelConfigError: ไม่มีตั้งค่า/ตารางว่าง → ผ่าน', () => {
  assert.equal(parcelConfigError(undefined), '')
  assert.equal(parcelConfigError({ boxG: 0, volDivisor: 5000, rates: [] }), '')
})
t('parcelConfigError: แถวไม่ครบ / ซ้ำ / ราคาลดลง / เกิน 30 / boxG ติดลบ / volDivisor 500', () => {
  assert.match(parcelConfigError({ rates: [{ upToG: 500 }] }), /ขั้นที่ \d+: กรอกน้ำหนักสูงสุด \(กรัม\) และราคาให้ครบ/)
  assert.match(parcelConfigError({ rates: [{ upToG: 500, price: 40 }, { upToG: 500, price: 50 }] }), /น้ำหนักของขั้นซ้ำกัน/)
  assert.match(parcelConfigError({ rates: [{ upToG: 500, price: 60 }, { upToG: 1000, price: 40 }] }), /ราคาต้องไม่ลดลงเมื่อน้ำหนักมากขึ้น/)
  assert.match(parcelConfigError({ rates: Array.from({ length: 31 }, (_, i) => ({ upToG: (i + 1) * 100, price: i })) }), /ตั้งได้ไม่เกิน 30 ขั้น/)
  assert.match(parcelConfigError({ boxG: -1, rates: [] }), /น้ำหนักกล่องต้องเป็นจำนวนเต็มกรัม 0–50000/)
  assert.match(parcelConfigError({ volDivisor: 500, rates: [] }), /ตัวหารปริมาตรต้องเป็นจำนวนเต็ม 1000–20000/)
})
t('parcelDimsError: ฟอร์มว่างทั้งหมด → ผ่าน', () => {
  assert.equal(parcelDimsError({ weightG: '', dimW: '', dimL: '', dimH: '' }), '')
})
t('parcelDimsError: กรอกน้ำหนักอย่างเดียว → ให้ครบ', () => {
  assert.match(parcelDimsError({ weightG: '800', dimW: '', dimL: '', dimH: '' }), /ให้ครบ หรือเว้นว่างทั้งหมด/)
})
t('parcelDimsError: น้ำหนักผิดรูปแบบ', () => {
  for (const w of ['0', '1.5', '-3', 'abc', '50001']) {
    assert.match(parcelDimsError({ weightG: w, dimW: '20', dimL: '20', dimH: '10' }), /น้ำหนักต้องเป็นจำนวนเต็มกรัม 1–50000/, w)
  }
})
t('parcelDimsError: ขนาดด้านใดเป็น 0 หรือ 201 → ข้อความขนาด', () => {
  assert.match(parcelDimsError({ weightG: '800', dimW: '0', dimL: '20', dimH: '10' }), /ขนาดแต่ละด้านต้องมากกว่า 0 และไม่เกิน 200 ซม\./)
  assert.match(parcelDimsError({ weightG: '800', dimW: '20', dimL: '201', dimH: '10' }), /ขนาดแต่ละด้านต้องมากกว่า 0 และไม่เกิน 200 ซม\./)
})
t('parcelDimsError: ครบและถูกต้อง → ผ่าน', () => {
  assert.equal(parcelDimsError({ weightG: '800', dimW: '20', dimL: '20', dimH: '10' }), '')
})
t('parcelFieldsOf: ว่างทั้งหมด → null ทั้งคู่ · ครบ → เป็นตัวเลข', () => {
  assert.deepEqual(parcelFieldsOf({ weightG: '', dimW: '', dimL: '', dimH: '' }), { weightG: null, dimsCm: null })
  assert.deepEqual(parcelFieldsOf({ weightG: '800', dimW: '20', dimL: '20', dimH: '10' }), { weightG: 800, dimsCm: { w: 20, l: 20, h: 10 } })
})
t('parcelFormOf กลับด้านกับ parcelFieldsOf ได้ และ item ที่ไม่มีฟิลด์ได้ค่าว่าง', () => {
  const f = parcelFormOf({ weightG: 800, dimsCm: { w: 20, l: 20, h: 10 } })
  assert.deepEqual(f, { weightG: '800', dimW: '20', dimL: '20', dimH: '10' })
  assert.deepEqual(parcelFieldsOf(f), { weightG: 800, dimsCm: { w: 20, l: 20, h: 10 } })
  assert.deepEqual(parcelFormOf({}), { weightG: '', dimW: '', dimL: '', dimH: '' })
})
t('hasParcelDims: ครบถูกต้อง → จริง · ขาด/0/ผิดช่วง → เท็จ', () => {
  assert.equal(hasParcelDims({ weightG: 800, dimsCm: { w: 20, l: 20, h: 10 } }), true)
  assert.equal(hasParcelDims({ weightG: 800 }), false)
  assert.equal(hasParcelDims({ weightG: 0, dimsCm: { w: 20, l: 20, h: 10 } }), false)
  assert.equal(hasParcelDims({ weightG: 800, dimsCm: { w: 201, l: 20, h: 10 } }), false)
})

console.log(fail ? `${fail} FAILED` : 'ALL PASS')
process.exit(fail ? 1 : 0)
