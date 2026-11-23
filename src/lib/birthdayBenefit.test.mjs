// ทดสอบส่วนลดเดือนเกิด (หมวดเค้ก เพดาน ไม่ซ้อนคูปอง) · รัน: node src/lib/birthdayBenefit.test.mjs
import assert from 'node:assert/strict'
import { birthCakeDiscount, pickBirthOrCoupons } from './birthdayBenefit.js'

const lv3 = { eligible: true, active: true, rate: 5, cap: 25 }
const lv4 = { eligible: true, active: true, rate: 10, cap: 50 }
const cats = ['เค้กชิ้น', 'เค้กเต็มใบ']
const items = [
  { category: 'เค้กชิ้น', unitPrice: 95, qty: 2 },   // 190
  { category: 'ขนมอบ', unitPrice: 70, qty: 3 },      // ไม่ใช่เค้ก
]
let fail = 0
const t = (name, fn) => { try { fn(); console.log('ok -', name) } catch (e) { fail++; console.log('FAIL -', name, e.message) } }

t('LV3 5% ของหมวดเค้กเท่านั้น (190 → 9.50)', () => assert.deepEqual(birthCakeDiscount({ items, cakeCategories: cats, birth: lv3 }), { amount: 9.5, base: 190 }))
t('LV3 เพดาน 25 บาท (ยอดเค้ก 1000 → 25)', () => assert.equal(birthCakeDiscount({ items: [{ category: 'เค้กเต็มใบ', unitPrice: 1000, qty: 1 }], cakeCategories: cats, birth: lv3 }).amount, 25))
t('LV4 10% เพดาน 50 บาท (ยอดเค้ก 190 → 19)', () => assert.equal(birthCakeDiscount({ items, cakeCategories: cats, birth: lv4 }).amount, 19))
t('LV4 เพดาน 50 บาท (ยอดเค้ก 1000 → 50)', () => assert.equal(birthCakeDiscount({ items: [{ category: 'เค้กเต็มใบ', unitPrice: 1000, qty: 1 }], cakeCategories: cats, birth: lv4 }).amount, 50))
t('ยังไม่ครบ 30 วัน ไม่ได้ส่วนลด', () => assert.equal(birthCakeDiscount({ items, cakeCategories: cats, birth: { ...lv4, eligible: false, rate: 0 } }).amount, 0))
t('ไม่ Active ไม่ได้ส่วนลด', () => assert.equal(birthCakeDiscount({ items, cakeCategories: cats, birth: { ...lv4, active: false } }).amount, 0))
t('ร้านยังไม่เลือกหมวดเค้ก ไม่ได้ส่วนลด', () => assert.equal(birthCakeDiscount({ items, cakeCategories: [], birth: lv4 }).amount, 0))
t('ไม่มีข้อมูลสิทธิ ไม่ได้ส่วนลด', () => assert.equal(birthCakeDiscount({ items, cakeCategories: cats, birth: null }).amount, 0))
t('ไม่ซ้อนคูปอง: ส่วนลดเดือนเกิดมากกว่า → ใช้เดือนเกิด', () => assert.equal(pickBirthOrCoupons(9.5, 5), 'birth'))
t('ไม่ซ้อนคูปอง: คูปองมากกว่า → ใช้คูปอง', () => assert.equal(pickBirthOrCoupons(9.5, 10), 'coupons'))
t('เท่ากัน → ใช้คูปองเดิม', () => assert.equal(pickBirthOrCoupons(10, 10), 'coupons'))
t('ไม่มีคูปอง → ใช้เดือนเกิด', () => assert.equal(pickBirthOrCoupons(9.5, 0), 'birth'))
if (fail) { console.log(`ล้ม ${fail} รายการ`); process.exit(1) }
console.log('ผ่านทั้งหมด')
