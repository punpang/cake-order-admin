// ทดสอบป้ายและคำแนะนำบันเดิ้ลบนตัวเลือก (ข้อมูลแบบเดียวกับกลุ่ม "ขอบบนเค้ก": ชุดคู่ 3 ชุด + ชุด 3 ตัว ลด 100 ทุกชุด) · รัน: node src/lib/bundleTags.test.mjs
import assert from 'node:assert/strict'
import { bundleHints, bundleTags } from './pricing.js'

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

const G = 'gmw84lti9vwjfd'
const CHERRY = 'omw87kh9iqti42'
const KITKAT = 'omw89gkljr9h1b'
const OREO = 'omwdoowxnuwqn5'
const groups = [
  {
    id: G,
    name: 'ขอบบนเค้ก',
    type: 'multi',
    options: [
      { id: CHERRY, name: 'เชอร์รี่', priceType: 'fixed', price: 50 },
      { id: KITKAT, name: 'คิทแคท', priceType: 'fixed', price: 50 },
      { id: OREO, name: 'โอริโอ้', priceType: 'fixed', price: 50 },
    ],
  },
]
const bundle = (id, name, optionIds, discount) => ({
  id,
  name,
  active: true,
  types: ['t1', 't2'],
  items: optionIds.map((optionId) => ({ groupId: G, optionId })),
  discount: { s1: discount },
  typeDiscount: { t1: {}, t2: {} },
})
const ck = bundle('b_ck', 'เชอร์รี่ + คิทแคท', [CHERRY, KITKAT], 100)
const ko = bundle('b_ko', 'คิทแคท + โอริโอ้', [KITKAT, OREO], 100)
const co = bundle('b_co', 'เชอร์รี่ + โอริโอ้', [CHERRY, OREO], 100)
const triple = bundle('b_3', 'เชอร์รี่ + คิทแคท + โอริโอ้', [CHERRY, KITKAT, OREO], 100)
const ctx = { typeId: 't1', sizeIds: ['s1'] }
const sel = (...ids) => ({ [G]: ids })
const tagOf = (map, id) => map.get(`${G}:${id}`) || null

t('เลือกเชอร์รี่ + คิทแคท: โอริโอ้ ติดป้ายครบชุดรวม 50 (ไม่ขึ้น -100 เหมือนลดเพิ่ม)', () => {
  const m = bundleTags([ck, ko, co, triple], groups, sel(CHERRY, KITKAT), ctx)
  assert.equal(tagOf(m, CHERRY).state, 'done')
  assert.equal(tagOf(m, KITKAT).state, 'done')
  const o = tagOf(m, OREO)
  assert.equal(o.state, 'partner')
  assert.equal(o.amount, 100)
  assert.equal(o.setTotal, 50)
  assert.deepEqual(o.names, ['เชอร์รี่ + คิทแคท + โอริโอ้'])
})

t('เลือกเชอร์รี่อย่างเดียว: คิทแคทและโอริโอ้ ติดป้ายลดเพิ่มแบบปกติ', () => {
  const m = bundleTags([ck, ko, co, triple], groups, sel(CHERRY), ctx)
  for (const id of [KITKAT, OREO]) {
    const tag = tagOf(m, id)
    assert.deepEqual([tag.state, tag.amount, tag.setTotal], ['partner', 100, null])
  }
})

t('ครบ 3 ตัว: ทั้งชุดขึ้นลดแล้ว -100 และไม่มีป้ายเหลือ', () => {
  const m = bundleTags([ck, ko, co, triple], groups, sel(CHERRY, KITKAT, OREO), ctx)
  for (const id of [CHERRY, KITKAT, OREO]) {
    const tag = tagOf(m, id)
    assert.deepEqual([tag.state, tag.amount, tag.setTotal, tag.names], ['done', 100, null, ['เชอร์รี่ + คิทแคท + โอริโอ้']])
  }
})

t('มีแค่ชุด 3 ตัว: เลือก 2 ตัวแล้ว โอริโอ้ ติดป้ายลดเพิ่มแบบปกติ', () => {
  const tag = tagOf(bundleTags([triple], groups, sel(CHERRY, KITKAT), ctx), OREO)
  assert.deepEqual([tag.state, tag.amount, tag.setTotal], ['partner', 100, null])
})

t('ชุดที่ครบแล้วลดมากกว่าชุด 3 ตัว: ไม่ชวนให้เลือกโอริโอ้ (ส่วนลดจะลดลง)', () => {
  const triple50 = bundle('b_3b', 'ชุด 3 ตัวลด 50', [CHERRY, KITKAT, OREO], 50)
  const m = bundleTags([ck, triple50], groups, sel(CHERRY, KITKAT), ctx)
  assert.equal(tagOf(m, CHERRY).state, 'done')
  assert.equal(tagOf(m, OREO), null)
})

t('คำแนะนำ: เลือกเชอร์รี่ + คิทแคท → เสนอโอริโอ้ เป็นครบชุดรวม 50', () => {
  const hints = bundleHints([ck, ko, co, triple], groups, sel(CHERRY, KITKAT), ctx)
  assert.equal(hints.length, 1)
  assert.equal(hints[0].bundle.id, 'b_3')
  assert.deepEqual(hints[0].missing.map((x) => x.name), ['โอริโอ้'])
  assert.equal(hints[0].tie, true)
  assert.equal(hints[0].setTotal, 50)
})

t('คำแนะนำ: ไม่มีชุดคู่ → เสนอโอริโอ้ ลด 100 แบบปกติ', () => {
  const hints = bundleHints([triple], groups, sel(CHERRY, KITKAT), ctx)
  assert.equal(hints.length, 1)
  assert.equal(hints[0].tie, false)
  assert.equal(hints[0].amount, 100)
})

console.log(fail ? `\nไม่ผ่าน ${fail} กรณี` : '\nผ่านทั้งหมด')
process.exitCode = fail ? 1 : 0
