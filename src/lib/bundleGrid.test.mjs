// ทดสอบตารางตั้งราคาชุดคู่ต่อกลุ่ม · รัน: node src/lib/bundleGrid.test.mjs
import assert from 'node:assert/strict'
import { groupPairs, findPairBundle, scopeValue, cellState, suggestPrice, writeCell, hasAnyDiscount } from './bundleGrid.js'

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

const groups = [
  {
    id: 'g_top', name: 'ขอบบนเค้ก', key: 'topping', active: true,
    options: [
      { id: 'cherry', name: 'เชอร์รี่', active: true, priceType: 'size', sizePrices: { s1: 50 } },
      { id: 'kit', name: 'คิทแคท', active: true, priceType: 'size', sizePrices: { s1: 50 } },
      { id: 'beng', name: 'เบงเบง', active: true, priceType: 'size', sizePrices: { s1: 50 } },
      { id: 'oreo', name: 'โอริโอ้', active: true, priceType: 'size', sizePrices: { s1: 50 } },
      { id: 'off', name: 'ปิดอยู่', active: false, priceType: 'size', sizePrices: { s1: 50 } },
    ],
  },
]
const G = 'g_top'
const A = { groupId: G, optionId: 'cherry' }
const B = { groupId: G, optionId: 'kit' }
const C = { groupId: G, optionId: 'beng' }
const D = { groupId: G, optionId: 'oreo' }

const bundles = [
  { id: 'b1', name: 'เชอร์รี่+คิทแคท', items: [A, B], discount: { s1: 100 }, types: [], typeDiscount: {}, styleDiscount: {}, styleMode: {}, active: true },
  { id: 'b2', name: 'คิทแคท+เบงเบง', items: [B, C], discount: { s1: 10 }, types: [], typeDiscount: {}, styleDiscount: {}, styleMode: {}, active: true },
]

t('groupPairs: คู่ไม่ซ้ำ เฉพาะตัวเลือกที่เปิดอยู่ (4 ตัว = 6 คู่)', () => {
  const rows = groupPairs(groups[0])
  assert.equal(rows.length, 6)
  assert.deepEqual(rows[0].items, [A, B])
  assert.ok(!rows.some((r) => r.items.some((x) => x.optionId === 'off')))
})

t('findPairBundle: หาชุดของคู่ ไม่สนลำดับ', () => {
  assert.equal(findPairBundle(bundles, [B, A])?.id, 'b1')
  assert.equal(findPairBundle(bundles, [A, D]), null)
})

t('scopeValue/cellState: ช่องที่ตั้งเอง, ช่องว่าง, และช่องที่รับค่าจากทุกชนิด', () => {
  const b = { ...bundles[0], typeDiscount: { tA: { s1: 60 } } }
  assert.deepEqual(cellState(b, { kind: 'all' }, 's1'), { state: 'set', amount: 100, detail: true })
  assert.equal(scopeValue(b, { kind: 'type', id: 'tA' }, 's1'), 60)
  const plain = bundles[0]
  assert.deepEqual(cellState(plain, { kind: 'type', id: 'tB' }, 's1'), { state: 'inherit', amount: 100, detail: false })
  assert.deepEqual(cellState(null, { kind: 'all' }, 's1'), { state: 'empty', amount: null, detail: false })
})

t('cellState: ชุดที่ปิดอยู่แสดงเครื่องหมายรายละเอียด', () => {
  const off = { ...bundles[0], active: false }
  assert.equal(cellState(off, { kind: 'all' }, 's1').detail, true)
})

t('suggestPrice: ใช้ส่วนลดที่พบบ่อยจากคู่ที่ราคาตัวเลือกรวมเท่ากัน', () => {
  const more = [...bundles, { id: 'b3', name: 'x', items: [C, D], discount: { s1: 100 }, types: [], typeDiscount: {}, styleDiscount: {}, styleMode: {}, active: true }]
  const s = suggestPrice(more, groups, [A, D], 's1', { kind: 'all' }, G)
  assert.equal(s?.amount, 100)
})

t('suggestPrice: ไม่แนะนำเมื่อไม่มีคู่ที่ราคาตัวเลือกรวมเท่ากัน', () => {
  // โอริโอ้ราคา 80 → คู่ [เชอร์รี่, โอริโอ้] รวม 130 ไม่เท่ากับคู่ที่มีอยู่ (100)
  const pricier = JSON.parse(JSON.stringify(groups))
  pricier[0].options[3].sizePrices = { s1: 80 }
  assert.equal(suggestPrice(bundles, pricier, [A, D], 's1', { kind: 'all' }, G), null)
})

t('suggestPrice: ไม่แนะนำเมื่อส่วนลดที่พบบ่อยสองค่าเท่ากัน (ไม่เดา)', () => {
  const tie = [bundles[0], { id: 'b3', items: [C, D], discount: { s1: 10 }, types: [], typeDiscount: {}, styleDiscount: {}, styleMode: {}, active: true }]
  assert.equal(suggestPrice(tie, groups, [A, D], 's1', { kind: 'all' }, G), null)
})

t('writeCell: ช่องว่างสร้างชุดใหม่ 2 ตัวเลือก ชื่ออัตโนมัติ ไม่แตะชุดอื่น', () => {
  const r = writeCell(null, { items: [A, D], groups, scope: { kind: 'all' }, sizeId: 's1', amount: 80 })
  assert.equal(r.id, null)
  assert.equal(r.name, 'เชอร์รี่ + โอริโอ้')
  assert.deepEqual(r.discount, { s1: 80 })
  assert.equal(bundles[0].discount.s1, 100)
})

t('writeCell: แก้ชุดเดิมเฉพาะมิติและขนาดที่เลือก ไม่แตะมิติอื่น', () => {
  const r = writeCell(bundles[0], { items: [A, B], groups, scope: { kind: 'type', id: 'tA' }, sizeId: 's1', amount: 70 })
  assert.deepEqual(r.typeDiscount, { tA: { s1: 70 } })
  assert.deepEqual(r.discount, { s1: 100 })
  assert.equal(bundles[0].typeDiscount.tA, undefined, 'ต้นฉบับต้องไม่ถูกแก้')
})

t('writeCell: ช่องสไตล์ตั้งเป็นราคาประจำตัวของรูปแบบ', () => {
  const r = writeCell(bundles[0], { items: [A, B], groups, scope: { kind: 'style', id: 'st1' }, sizeId: 's1', amount: 30 })
  assert.deepEqual(r.styleDiscount, { st1: { s1: 30 } })
  assert.equal(r.styleMode.st1, 'own')
})

t('writeCell: ใส่ค่าว่างลบเฉพาะช่องนั้น ไม่ลบชุด', () => {
  const r = writeCell(bundles[0], { items: [A, B], groups, scope: { kind: 'all' }, sizeId: 's1', amount: null })
  assert.equal(r.discount.s1, undefined)
  assert.equal(r.id, 'b1')
})

t('hasAnyDiscount: นับเฉพาะส่วนลดที่มากกว่า 0', () => {
  assert.equal(hasAnyDiscount(bundles[0]), true)
  assert.equal(hasAnyDiscount({ ...bundles[0], discount: { s1: 0 } }), false)
  assert.equal(hasAnyDiscount({ ...bundles[0], discount: {}, typeDiscount: { tA: { s1: 5 } } }), true)
  assert.equal(hasAnyDiscount({ ...bundles[0], discount: {}, styleMode: { st1: 'own' }, styleDiscount: { st1: { s1: 9 } } }), true)
})

console.log(fail ? `${fail} FAILED` : 'ALL PASS')
process.exit(fail ? 1 : 0)
