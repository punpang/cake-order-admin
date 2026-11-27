// ทดสอบหน้าบันเดิ้ลแบบเลือกตัวเลือกหนึ่งตัว · รัน: node src/lib/bundleByOption.test.mjs
import assert from 'node:assert/strict'
import { bundlesWithOption, conflictsOf, usageOf, discountRows, setSizeDiscount, setDiscountAt, applicableTypes, createBundleDraft, cakePriceFor } from './bundleByOption.js'

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

const G = 'g_top'
const opt = (id, name) => ({ id, name, active: true, priceType: 'size', sizePrices: { s1: 50 } })
const groups = [{ id: G, name: 'ขอบบน', key: 'topping', active: true, options: [opt('cherry', 'เชอร์รี่'), opt('kit', 'คิทแคท'), opt('beng', 'เบงเบง'), opt('oreo', 'โอริโอ้')] }]
const sizes = [{ id: 's1', name: '1 ปอนด์' }]
const A = { groupId: G, optionId: 'cherry' }
const B = { groupId: G, optionId: 'kit' }
const D = { groupId: G, optionId: 'oreo' }
const C = { groupId: G, optionId: 'beng' }
const mk = (id, items, s1) => ({ id, name: id, items, discount: { s1 }, types: [], typeDiscount: {}, styleDiscount: {}, styleMode: {}, active: true })
// ตัวอย่างจากผู้ใช้: 1 คิทแคท+เชอร์รี่ · 2 คิทแคท+โอริโอ้ · 3 คิทแคท+เชอร์รี่+โอริโอ้
const b1 = mk('b1', [B, A], 100)
const b2 = mk('b2', [B, D], 40)
const b3 = mk('b3', [B, A, D], 150)
const all = [b1, b2, b3]

t('bundlesWithOption: คิทแคทผูกกับทั้ง 3 ชุด เรียงจากตัวเลือกมากไปน้อย', () => {
  assert.deepEqual(bundlesWithOption(all, B, sizes).map((b) => b.id), ['b3', 'b1', 'b2'])
})

t('bundlesWithOption: เชอร์รี่ผูกกับ 2 ชุด (ชุด 1 และชุด 3)', () => {
  assert.deepEqual(bundlesWithOption(all, A, sizes).map((b) => b.id), ['b3', 'b1'])
})

t('conflictsOf: ชุด 2 ถูกข้ามเมื่อเลือกชุด 3 หรือชุด 1 ที่มีตัวเลือกร่วม', () => {
  assert.deepEqual(conflictsOf(b2, all, sizes).map((b) => b.id).sort(), ['b1', 'b3'])
})

t('conflictsOf: ชุดที่ใหญ่สุดไม่ถูกข้ามโดยใคร', () => {
  assert.deepEqual(conflictsOf(b3, all, sizes), [])
})

t('usageOf: ชุดที่ปิดอยู่หรือไม่มีส่วนลดแสดงสถานะเฉพาะ', () => {
  assert.equal(usageOf({ ...b1, active: false }, all, sizes).status, 'off')
  assert.equal(usageOf({ ...b1, discount: {} }, all, sizes).status, 'nodiscount')
  assert.equal(usageOf(b3, all, sizes).status, 'ok')
  assert.equal(usageOf(b2, all, sizes).status, 'skipped')
})

t('discountRows: ประเภทว่าง = ราคาทุกประเภท และส่วนลดของแต่ละขนาด', () => {
  const rows = discountRows(b1, groups, sizes, [])
  assert.deepEqual(rows, [{ typeId: null, typeName: '', sizeId: 's1', sizeName: '1 ปอนด์', regular: 100, amount: 100, after: 0 }])
})

// กรณีจากภาพ: ผลไม้รวม ราคา 150 ทุกประเภท แต่ 60 ในสองประเภทที่ตัวเลือกนี้ใช้ได้ → ราคาปกติของชุดต้องเป็น 140 ไม่ใช่ 230
const TA = { id: 'tA', name: 'เค้กครีมนมสด', active: true }
const TB = { id: 'tB', name: 'เค้กหน้านิ่ม', active: true }
const TC = { id: 'tC', name: 'เค้กอื่น', active: true }
const typeGroups = [{ id: G, name: 'กลาง', key: 'flavor', active: true, options: [
  { id: 'fruit', name: 'ผลไม้รวม', active: true, priceType: 'size', types: ['tA', 'tB'], sizePrices: { s1: 150 }, typePrices: { tA: { s1: 60 }, tB: { s1: 60 } } },
  { id: 'jam', name: 'แยม', active: true, priceType: 'size', types: [], sizePrices: { s1: 80 } },
] }]
const fruitJam = mk('fj', [{ groupId: G, optionId: 'fruit' }, { groupId: G, optionId: 'jam' }], 0)
const allTypes = [TA, TB, TC]

t('applicableTypes: ชุดใช้ได้เฉพาะประเภทที่ทุกตัวเลือกในชุดใช้ได้', () => {
  assert.deepEqual(applicableTypes(fruitJam, typeGroups, allTypes), ['tA', 'tB'])
  assert.deepEqual(applicableTypes({ ...fruitJam, types: ['tC'] }, typeGroups, allTypes), [])
})

t('discountRows: แยกแถวต่อประเภท ราคาปกติ 140 ในสองประเภท (ไม่ใช่ 230)', () => {
  const rows = discountRows({ ...fruitJam, discount: { s1: 30 } }, typeGroups, [{ id: 's1', name: '1 ปอนด์' }], allTypes)
  assert.deepEqual(rows.map((r) => [r.typeId, r.regular, r.amount, r.after]), [['tA', 140, 30, 110], ['tB', 140, 30, 110]])
  assert.equal(rows[0].typeName, 'เค้กครีมนมสด')
})

t('discountRows: ส่วนลดเกินราคาปกติ ราคาหลังหักเป็น 0 ไม่ติดลบ', () => {
  const rows = discountRows({ ...fruitJam, discount: { s1: 999 } }, typeGroups, [{ id: 's1', name: '1 ปอนด์' }], allTypes)
  assert.equal(rows[0].after, 0)
})

t('setDiscountAt: แถวประเภทเขียนลง typeDiscount ของประเภทนั้น ไม่แตะค่าทุกประเภท', () => {
  const r = setDiscountAt({ ...fruitJam, discount: { s1: 30 } }, 'tA', 's1', 45)
  assert.deepEqual(r.typeDiscount, { tA: { s1: 45 } })
  assert.equal(r.discount.s1, 30)
  assert.equal(setDiscountAt(r, 'tA', 's1', null).typeDiscount.tA.s1, undefined)
})

t('setSizeDiscount: คืนชุดใหม่ ไม่แก้ต้นฉบับ และว่างคือลบค่า', () => {
  const r = setSizeDiscount(b1, 's1', 70)
  assert.equal(r.discount.s1, 70)
  assert.equal(b1.discount.s1, 100)
  assert.equal(setSizeDiscount(b1, 's1', null).discount.s1, undefined)
  assert.equal(setSizeDiscount(b1, 's1', 70).discount.s1, 70)
})

t('createBundleDraft: ชื่ออัตโนมัติและรายการตัวเลือกข้ามกลุ่มรองได้', () => {
  const d = createBundleDraft([A, B, D], groups)
  assert.equal(d.name, 'เชอร์รี่ + คิทแคท + โอริโอ้')
  assert.equal(d.id, null)
  assert.equal(d.items.length, 3)
})

// ราคาเค้กเต็มตามเครื่องคิดราคาจริง: ประเภท + เนื้อ + ขนาด + ตัวเลือกในชุด → ก่อนและหลังบันเดิ้ล
const cakeGroups = [
  { id: 'g_type', key: 'type', name: 'ประเภท', type: 'single', options: [{ id: 'tA', name: 'เค้กครีม', active: true, sizePrices: { s1: 0 } }] },
  { id: 'g_size', key: 'size', name: 'ขนาด', type: 'single', options: [{ id: 's1', name: '1 ปอนด์', active: true, pounds: 1 }] },
  { id: 'g_flavor', key: 'flavor', name: 'เนื้อเค้ก', type: 'single', options: [{ id: 'fl1', name: 'วานิลลา', active: true, priceType: 'size', sizePrices: { s1: 20 } }] },
  { id: G, key: 'topping', name: 'ท็อปปิ้ง', type: 'multi', options: [opt('cherry', 'เชอร์รี่'), opt('kit', 'คิทแคท')] },
]
t('cakePriceFor: ราคาเค้กเต็มก่อนและหลังบันเดิ้ลตามเครื่องคิดราคาจริง', () => {
  const cb = { id: 'cb', name: 'x', items: [{ groupId: G, optionId: 'cherry' }, { groupId: G, optionId: 'kit' }], discount: { s1: 30 }, types: [], typeDiscount: {}, styleDiscount: {}, styleMode: {}, active: true }
  const r = cakePriceFor(cb, cakeGroups, { typeId: 'tA', flavorId: 'fl1', sizeId: 's1' })
  assert.deepEqual(r, { before: 120, after: 90 })
})

console.log(fail ? `${fail} FAILED` : 'ALL PASS')
process.exit(fail ? 1 : 0)
