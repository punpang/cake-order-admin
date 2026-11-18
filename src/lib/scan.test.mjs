// เทสต์การสแกนบาร์โค้ดคูปอง · รัน: node src/lib/scan.test.mjs
import assert from 'node:assert/strict'
import { COUPON_SCAN_RE, MEMBER_SCAN_RE, couponScanValue, newMemberScanCode, resolveCouponScan, resolveMemberScan } from './scan.js'

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

t('รหัสสมาชิกที่สร้างเป็น 32 ตัว hex และไม่ซ้ำกันในการเรียกติดกัน', () => {
  const a = newMemberScanCode(), b = newMemberScanCode()
  assert.match(a, MEMBER_SCAN_RE)
  assert.match(b, MEMBER_SCAN_RE)
  assert.notEqual(a, b)
})

t('สแกนรหัสสมาชิกหาลูกค้าที่ตรงได้ และไม่รวมบัญชีที่ลบหรือปิดใช้งาน', () => {
  const list = [
    { id: 'm1', scanCode: 'a'.repeat(32) },
    { id: 'm2', scanCode: 'b'.repeat(32), deleted: true },
    { id: 'm3', scanCode: 'c'.repeat(32), active: false },
  ]
  assert.equal(resolveMemberScan(' ' + 'a'.repeat(32) + '\n', list), list[0])
  assert.equal(resolveMemberScan('b'.repeat(32), list), null)
  assert.equal(resolveMemberScan('c'.repeat(32), list), null)
  assert.equal(resolveMemberScan('d'.repeat(32), list), null)
})

t('รหัสสมาชิกที่รูปแบบผิด (ไม่ใช่ hex 32 ตัว) ไม่ถูกจับคู่', () => {
  const list = [{ id: 'm1', scanCode: 'a'.repeat(32) }]
  assert.equal(resolveMemberScan('A'.repeat(32), list), null)
  assert.equal(resolveMemberScan('a'.repeat(31), list), null)
  assert.equal(resolveMemberScan('', list), null)
})

let fails = 0
for (const [name, fn] of cases) {
  try { fn(); console.log(`PASS ${name}`) } catch (e) { fails++; console.log(`FAIL ${name}: ${e.message}`) }
}
console.log(fails ? `ไม่ผ่าน ${fails} กรณี` : 'scan: ผ่านทุกกรณี')
process.exitCode = fails ? 1 : 0
