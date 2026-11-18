// เทสต์การสแกนบาร์โค้ดคูปอง · รัน: node src/lib/scan.test.mjs
import assert from 'node:assert/strict'
import { COUPON_SCAN_RE, couponScanValue, resolveCouponScan } from './scan.js'

const coupons = [
  { id: 'cpabc123', name: 'คูปอง A', customerId: 'c1' },
  { id: 'cp9', name: 'คูปอง B', customerId: 'c2' },
]
const cases = []
const t = (name, fn) => cases.push([name, fn])

t('ค่าบาร์โค้ดของคูปองคือรหัสคูปองตรง ๆ', () => {
  assert.equal(couponScanValue(coupons[0]), 'cpabc123')
  assert.equal(couponScanValue(null), '')
})

t('ค่าบาร์โค้ดทุกรูปแบบอ่านได้ด้วย Code128 (ตัวอักษรและตัวเลขล้วน)', () => {
  for (const c of coupons) assert.match(couponScanValue(c), /^[\x21-\x7e]+$/)
  assert.match('cp1', COUPON_SCAN_RE)
})

t('สแกนรหัสที่ตรงกับคูปองได้ (รวมช่องว่างและตัว Enter ที่ปลายค่า)', () => {
  assert.equal(resolveCouponScan('cpabc123', coupons), coupons[0])
  assert.equal(resolveCouponScan('  cp9\n', coupons), coupons[1])
})

t('รหัสที่ไม่ใช่รูปแบบคูปอง หรือไม่พบ ไม่คืนคูปอง', () => {
  assert.equal(resolveCouponScan('', coupons), null)
  assert.equal(resolveCouponScan('0812345678', coupons), null)
  assert.equal(resolveCouponScan('cpXYZ', coupons), null)
  assert.equal(resolveCouponScan('cp999', coupons), null)
  assert.equal(resolveCouponScan(undefined, coupons), null)
})

t('ไม่สนตัวพิมพ์ใหญ่ในค่าที่สแกนไม่ได้ (รหัสคูปองเป็นตัวเล็กเท่านั้น)', () => {
  assert.equal(resolveCouponScan('CPABC123', coupons), null)
})

let fails = 0
for (const [name, fn] of cases) {
  try { fn(); console.log(`PASS ${name}`) } catch (e) { fails++; console.log(`FAIL ${name}: ${e.message}`) }
}
console.log(fails ? `ไม่ผ่าน ${fails} กรณี` : 'scan: ผ่านทุกกรณี')
process.exitCode = fails ? 1 : 0
