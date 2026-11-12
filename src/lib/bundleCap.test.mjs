// ทดสอบส่วนลดบันเดิ้ลไม่เกินราคาตัวเลือก (ราคาตัวเลือกลดลงหลังตั้งส่วนลด) และรายการเตือนลดเกินราคาปกติ · รัน: node src/lib/bundleCap.test.mjs
import assert from 'node:assert/strict'
import { bundleAmountCapped, bundleDiscount, bundleTags, calcUnitPrice, priceDetail } from './pricing.js'
import { checkBundle, overDiscounts } from './bundleEditor.js'

let fail = 0
const t = (name, fn) => {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (e) {
    fail++
    console.log(`FAIL ${name}: ${e.message}`)
  }
}

// ตัวเลือก 2 อย่าง (เชอร์รี่ + คิทแคท) ราคาคงที่ · เค้กฐาน 100 ฿ ขนาด s1
const G = 'g'
const A = 'a'
const B = 'b'
const KEY_A = `${G}:${A}`
const KEY_B = `${G}:${B}`
const groupsAt = (pa, pb) => [{
  id: G,
  name: 'ท็อปปิ้ง',
  key: 'extra',
  type: 'multi',
  options: [
    { id: A, name: 'เชอร์รี่', active: true, priceType: 'fixed', price: pa },
    { id: B, name: 'คิทแคท', active: true, priceType: 'fixed', price: pb },
  ],
}]
const pair = (discount, extra = {}) => ({
  id: 'bp',
  name: 'เชอร์รี่ + คิทแคท',
  active: true,
  types: [],
  items: [{ groupId: G, optionId: A }, { groupId: G, optionId: B }],
  discount: { s1: discount },
  typeDiscount: {},
  styleDiscount: {},
  styleMode: {},
  ...extra,
})
const cake = { kind: 'retail', retailPrice: 100, sizeId: 's1', selections: { [G]: [A, B] } }
const unitWith = (pa, pb, bundles) => calcUnitPrice(cake, groupsAt(pa, pb), [], [], null, null, bundles)
const ctx = (pa, pb) => ({ groups: groupsAt(pa, pb), sizes: [{ id: 's1', name: '1 ปอนด์' }], types: [], styles: [] })

t('ราคาตัวเลือกยังเท่าตอนตั้ง: ลด 20 จาก 50+50 → จ่าย 180 (เหมือนเดิม)', () => {
  assert.equal(unitWith(50, 50, [pair(20)]), 180)
})

t('ราคาตัวเลือกลดเหลือ 5+5 (รวม 10) ส่วนลด 20 → ลดได้แค่ 10 ไม่ลดฐานเค้ก: จ่าย 100', () => {
  assert.equal(unitWith(5, 5, [pair(20)]), 100)
})

t('ส่วนลด 200 (ตั้งตอน 150+150) แล้วราคาตัวเลือกเหลือ 5+5 → ไม่ติดลบ จ่าย 100 (ไม่ใช่ -90)', () => {
  assert.equal(unitWith(5, 5, [pair(200)]), 100)
})

t('ตัวเลือก 0 ฿ ทั้งคู่ ส่วนลด 20 → ไม่มีส่วนลดบันเดิ้ล จ่าย 100', () => {
  assert.equal(unitWith(0, 0, [pair(20)]), 100)
})

t('ส่วนลดเท่าราคาตัวเลือกพอดี (100 ของ 100) ยังได้เต็มจำนวน: จ่าย 100', () => {
  assert.equal(unitWith(50, 50, [pair(100)]), 100)
})

t('ราคาเต็ม − ส่วนลดที่แสดง = ราคาจ่ายจริง (รายการส่วนลดตรงกับที่คิด)', () => {
  const d = priceDetail(cake, groupsAt(5, 5), [], [], [pair(200)])
  assert.equal(d.unitPrice, 100)
  assert.equal(d.fullPrice, 110)
  const sum = d.discounts.reduce((s, x) => s + x.amount, 0)
  assert.equal(d.fullPrice - sum, d.unitPrice)
})

t('ส่วนลดรายประเภท: ประเภทที่ตั้งเกินราคาถูกกัน ประเภทอื่นไม่กระทบ', () => {
  const b = pair(20, { typeDiscount: { t2: { s1: 150 } } })
  const gs = groupsAt(50, 50)
  assert.equal(bundleAmountCapped(b, gs, 't2', ['s1']), 100)
  assert.equal(bundleAmountCapped(b, gs, 't1', ['s1']), 20)
})

t('bundleDiscount ใช้ยอดที่กันแล้ว และบันทึกยอดนั้นในรายการส่วนลด', () => {
  const used = new Map()
  const total = bundleDiscount([pair(200)], new Set([KEY_A, KEY_B]), ['s1'], used, null, null, groupsAt(5, 5))
  assert.equal(total, 10)
  assert.equal(used.get('เชอร์รี่ + คิทแคท'), 10)
})

t('ป้ายบันเดิ้ลบนหน้าร้านแสดงยอดที่กันแล้ว (ไม่โชว์ 200)', () => {
  const tags = bundleTags([pair(200)], groupsAt(5, 5), { [G]: [A] }, { typeId: null, sizeIds: ['s1'] })
  const tag = tags.get(KEY_B)
  assert.equal(tag.state, 'partner')
  assert.equal(tag.amount, 10)
})

t('ตัวเลือกราคาปกติไม่เปลี่ยน: ป้ายยังลด 20 เมื่อ 50+50', () => {
  const tags = bundleTags([pair(20)], groupsAt(50, 50), { [G]: [A] }, { typeId: null, sizeIds: ['s1'] })
  assert.equal(tags.get(KEY_B).amount, 20)
})

t('เตือนลดเกินราคาปกติ: 200 ฿ บนตัวเลือกรวม 10 ฿ → มีรายการเตือน', () => {
  const w = overDiscounts(pair(200), ctx(5, 5))
  assert.equal(w.length, 1)
  assert.ok(w[0].includes('มากกว่าราคาปกติ'))
})

t('ไม่เตือนเมื่อส่วนลดไม่เกินราคาตัวเลือก', () => {
  assert.deepEqual(overDiscounts(pair(10), ctx(5, 5)), [])
  assert.deepEqual(overDiscounts(pair(20), ctx(50, 50)), [])
})

t('บันทึกชุดที่ลดเกินราคาปกติยังไม่ได้ (ตรวจก่อนบันทึกเหมือนเดิม)', () => {
  const r = checkBundle(pair(200), ctx(5, 5))
  assert.ok(r.errors.some((e) => e.includes('มากกว่าราคาปกติ')))
})

console.log(fail ? `\nไม่ผ่าน ${fail} กรณี` : '\nผ่านทั้งหมด')
process.exitCode = fail ? 1 : 0
