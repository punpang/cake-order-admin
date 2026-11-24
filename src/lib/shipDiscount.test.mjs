// ทดสอบส่วนลดค่าส่งตามขั้นยอดซื้อ (ฟังก์ชันล้วน) · รัน: node src/lib/shipDiscount.test.mjs
import assert from 'node:assert/strict'
import { cleanShipOff, shipOffError, shipOffDiscount } from './shipDiscount.js'

let fail = 0
const t = (name, fn) => { try { fn(); console.log(`PASS ${name}`) } catch (e) { fail++; console.log(`FAIL ${name}: ${e.message}`) } }
const tiers = [{ min: 300, value: 20 }, { min: 1000, value: 50 }]

t('ฐานต่ำกว่าขั้นแรก → ไม่ลด', () => {
  assert.deepEqual(shipOffDiscount({ goodsExVat: 299.99, shippingFee: 85, tiers }), { tier: null, amount: 0 })
})
t('ฐานพอดีขั้น 300 → ลด 20', () => {
  assert.deepEqual(shipOffDiscount({ goodsExVat: 300, shippingFee: 85, tiers }), { tier: 300, amount: 20 })
})
t('ฐาน 1500 → ขั้นสูงสุด 1000 ลด 50 (ไม่สะสม)', () => {
  assert.deepEqual(shipOffDiscount({ goodsExVat: 1500, shippingFee: 85, tiers }), { tier: 1000, amount: 50 })
})
t('ส่วนลดมากกว่าค่าส่ง → ลดเหลือค่าส่ง ไม่ติดลบ', () => {
  assert.deepEqual(shipOffDiscount({ goodsExVat: 1500, shippingFee: 30, tiers }), { tier: 1000, amount: 30 })
})
t('ค่าส่ง 0 → ไม่ลด', () => {
  assert.deepEqual(shipOffDiscount({ goodsExVat: 1500, shippingFee: 0, tiers }), { tier: 1000, amount: 0 })
})
t('ไม่มีขั้น → ไม่ลด', () => {
  assert.deepEqual(shipOffDiscount({ goodsExVat: 1500, shippingFee: 85, tiers: [] }), { tier: null, amount: 0 })
})
t('cleanShipOff: ตัดแถวผิดรูปแบบและเรียงตาม min', () => {
  const r = cleanShipOff([{ min: 1000, value: 50 }, { min: 0, value: 5 }, { min: 300, value: -1 }, { min: 300, value: 20 }])
  assert.deepEqual(r, [{ min: 300, value: 20 }, { min: 1000, value: 50 }])
})
t('cleanShipOff: ทำให้ไม่เกิน 10 ขั้น', () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({ min: (i + 1) * 100, value: 1 }))
  assert.equal(cleanShipOff(rows).length, 10)
})
t('shipOffError: ว่างผ่าน', () => {
  assert.equal(shipOffError([]), '')
  assert.equal(shipOffError(undefined), '')
})
t('shipOffError: min ซ้ำ ไม่ผ่าน', () => {
  assert.notEqual(shipOffError([{ min: 300, value: 20 }, { min: 300, value: 30 }]), '')
})
t('shipOffError: min ไม่เรียง ไม่ผ่าน', () => {
  assert.notEqual(shipOffError([{ min: 1000, value: 50 }, { min: 300, value: 20 }]), '')
})
t('shipOffError: value ติดลบ ไม่ผ่าน', () => {
  assert.notEqual(shipOffError([{ min: 300, value: -1 }]), '')
})
t('shipOffError: 11 ขั้น ไม่ผ่าน', () => {
  const rows = Array.from({ length: 11 }, (_, i) => ({ min: (i + 1) * 100, value: 1 }))
  assert.notEqual(shipOffError(rows), '')
})

if (fail) { console.log(`\n${fail} ล้มเหลว`); process.exit(1) }
console.log('\nผ่านทั้งหมด')
