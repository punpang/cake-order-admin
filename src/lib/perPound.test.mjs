// ทดสอบราคาแบบคงที่ × ขนาด (ราคาต่อปอนด์ × จำนวนปอนด์) · รัน: node src/lib/perPound.test.mjs
import assert from 'node:assert/strict'
import { optionPrice, calcUnitPrice, sizePoundsOf } from './pricing.js'
import { regularTotal } from './bundleEditor.js'

let fail = 0
const t = (name, fn) => {
  try { fn(); console.log(`PASS ${name}`) } catch (e) { fail++; console.log(`FAIL ${name}: ${e.message}`) }
}

const sizeGroup = { id: 'g_size', key: 'size', name: 'ขนาด', type: 'single', options: [
  { id: 's1', name: '1 ปอนด์', active: true, pounds: 1 },
  { id: 's2', name: '2 ปอนด์', active: true, pounds: 2 },
  { id: 's3', name: '3 ปอนด์', active: true, pounds: 3 },
] }
const toppingGroup = { id: 'g_top', key: 'topping', name: 'ท็อปปิ้ง', type: 'multi', options: [
  { id: 'pp', name: 'ผลไม้', active: true, priceType: 'perPound', pricePerPound: 50 },
  { id: 'kit', name: 'คิทแคท', active: true, priceType: 'fixed', price: 80 },
] }
const groups = [sizeGroup, toppingGroup]
const pp = toppingGroup.options[0]

t('sizePoundsOf: อ่านจำนวนปอนด์ของแต่ละขนาด', () => {
  assert.deepEqual(sizePoundsOf(groups), { s1: 1, s2: 2, s3: 3 })
})

t('optionPrice perPound: ราคาต่อปอนด์ × ปอนด์ของขนาด (1/2/3 ปอนด์ = 50/100/150)', () => {
  const pounds = sizePoundsOf(groups)
  assert.equal(optionPrice(pp, null, ['s1'], pounds), 50)
  assert.equal(optionPrice(pp, null, ['s2'], pounds), 100)
  assert.equal(optionPrice(pp, null, ['s3'], pounds), 150)
})

t('optionPrice perPound: ไม่มีขนาด = 0 และไม่ใช้ราคาแยกประเภท', () => {
  assert.equal(optionPrice(pp, 'tA', [], sizePoundsOf(groups)), 0)
  assert.equal(optionPrice({ ...pp, typePrices: { tA: { s1: 999 } } }, 'tA', ['s1'], sizePoundsOf(groups)), 50)
})

t('optionPrice: คงที่และตามขนาดเดิมไม่เปลี่ยน', () => {
  assert.equal(optionPrice(toppingGroup.options[1], null, ['s3']), 80)
  assert.equal(optionPrice({ priceType: 'size', sizePrices: { s2: 30 } }, null, ['s2']), 30)
})

t('calcUnitPrice: เค้ก 3 ปอนด์ + ผลไม้ (50 ฿/ปอนด์) = 150 ฿', () => {
  const item = { kind: 'custom', qty: 1, selections: { g_size: 's3', g_top: ['pp'] }, tiers: [{ selections: { g_size: 's3', g_top: ['pp'] } }] }
  assert.equal(calcUnitPrice(item, groups, [], [], null, null, []), 150)
})

t('calcUnitPrice: คงที่ + คงที่×ขนาด รวมกัน (80 + 2 ปอนด์×50 = 180)', () => {
  const sel = { g_size: 's2', g_top: ['pp', 'kit'] }
  const item = { kind: 'custom', qty: 1, selections: sel, tiers: [{ selections: sel }] }
  assert.equal(calcUnitPrice(item, groups, [], [], null, null, []), 180)
})

t('regularTotal: ชุดที่มีรายการคงที่×ขนาด คิดตามปอนด์ของขนาดที่ดู', () => {
  assert.equal(regularTotal([{ groupId: 'g_top', optionId: 'pp' }], groups, null, 's3'), 150)
})

console.log(fail ? `${fail} FAILED` : 'ALL PASS')
process.exit(fail ? 1 : 0)
