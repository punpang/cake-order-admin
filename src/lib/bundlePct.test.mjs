// ทดสอบส่วนลดตามเปอร์เซ็นต์ของราคาปกติ: ช่องที่ไม่ตรงเมื่อราคาเปลี่ยน · ปรับตามราคาใหม่ · ตั้งเปอร์เซ็นต์ให้ชุดเดิม · รัน: node src/lib/bundlePct.test.mjs
import assert from 'node:assert/strict'
import { applyIntendedPct, checkBundle, discountSlots, driftRows, inferScopePct, linkSuggestions, makeDraft, validPct, withLinks } from './bundleEditor.js'

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

const G = 'g'
const SIZES = [{ id: 's1', name: '1 ปอนด์' }]
const TYPES = [{ id: 't1', name: 'ประเภท 1', active: true }, { id: 't2', name: 'ประเภท 2', active: true }]
// ตัวเลือก a (เชอร์รี่) และ b (คิทแคท) ราคาคงที่ · aTypePrice = ราคาของ a ในประเภทที่ตั้งแยก
const pair = (pa, pb, aTypePrice = null) => [{
  id: G,
  name: 'ท็อปปิ้ง',
  key: 'extra',
  type: 'multi',
  options: [
    { id: 'a', name: 'เชอร์รี่', active: true, priceType: 'fixed', price: pa, ...(aTypePrice ? { typePrice: aTypePrice } : {}) },
    { id: 'b', name: 'คิทแคท', active: true, priceType: 'fixed', price: pb },
  ],
}]
const bundleOf = (extra = {}) => ({
  id: 'bp',
  name: 'เชอร์รี่ + คิทแคท',
  active: true,
  types: [],
  items: [{ groupId: G, optionId: 'a' }, { groupId: G, optionId: 'b' }],
  discount: {},
  typeDiscount: {},
  styleDiscount: {},
  styleMode: {},
  ...extra,
})
const ctx = (groups, types = [], sizes = SIZES) => ({ groups, sizes, types, styles: [], bundles: [] })

t('ค่าเปอร์เซ็นต์ใช้ได้เมื่ออยู่ในช่วง 0–100 (ค่าอื่นเป็น null)', () => {
  assert.equal(validPct(20), 20)
  assert.equal(validPct('25'), 25)
  assert.equal(validPct(12.5), 12.5)
  for (const v of [0, -5, 101, null, undefined, '', 'abc']) assert.equal(validPct(v), null)
})

t('ตั้ง 20% ไว้และราคายังเท่าเดิม → ไม่มีช่องที่ต้องปรับ', () => {
  assert.deepEqual(driftRows(bundleOf({ pct: 20, discount: { s1: 20 } }), ctx(pair(50, 50))), [])
})

t('ราคาตัวเลือกขึ้นจาก 50+50 เป็น 60+60 → ส่วนลด 20% ต้องเป็น 24 ฿ (ไม่ตรงแล้ว)', () => {
  const rows = driftRows(bundleOf({ pct: 20, discount: { s1: 20 } }), ctx(pair(60, 60)))
  assert.equal(rows.length, 1)
  assert.equal(rows[0].current, 20)
  assert.equal(rows[0].target, 24)
  assert.equal(rows[0].pct, 20)
})

t('ปรับตามราคาใหม่: เขียนค่าใหม่ลงชุดที่คืนมา ชุดเดิมไม่เปลี่ยน และเปอร์เซ็นต์คงเดิม', () => {
  const b = bundleOf({ pct: 20, discount: { s1: 20 } })
  const next = applyIntendedPct(b, ctx(pair(60, 60)))
  assert.equal(next.discount.s1, 24)
  assert.equal(next.pct, 20)
  assert.equal(b.discount.s1, 20)
  assert.deepEqual(driftRows(next, ctx(pair(60, 60))), [])
})

t('ปรับตามราคาที่ลดลงแล้ว: ส่วนลดใหม่ไม่เกินราคาปกติ (ผ่านการตรวจก่อนบันทึก)', () => {
  const b = bundleOf({ pct: 20, discount: { s1: 20 } })
  const c = ctx(pair(5, 5))
  const next = applyIntendedPct(b, c)
  assert.equal(next.discount.s1, 2)
  assert.deepEqual(checkBundle(next, { ...c, bundles: [b], original: b }).errors, [])
})

t('ไม่ตั้งเปอร์เซ็นต์ไว้ → ไม่เตือนแม้ตัวเลขไม่ตรงกับราคา', () => {
  assert.deepEqual(driftRows(bundleOf({ discount: { s1: 20 } }), ctx(pair(60, 60))), [])
})

t('ชุดเก่าที่ส่วนลดตรงกับเปอร์เซ็นต์พอดี → แนะนำให้ตั้งตามเปอร์เซ็นต์นั้น (จำนวนเงินไม่เปลี่ยน)', () => {
  const b = bundleOf({ discount: { s1: 20 } })
  const links = linkSuggestions(b, ctx(pair(50, 50)))
  assert.deepEqual(links, [{ scopeId: null, scopeName: '', pct: 20 }])
  const linked = withLinks(b, links)
  assert.equal(linked.pct, 20)
  assert.equal(linked.discount.s1, 20)
  assert.deepEqual(driftRows(linked, ctx(pair(50, 50))), [])
  assert.equal(driftRows(linked, ctx(pair(60, 60)))[0].target, 24)
})

t('ตั้งเปอร์เซ็นต์ไว้แล้ว → ไม่เสนอให้ตั้งซ้ำ', () => {
  assert.deepEqual(linkSuggestions(bundleOf({ pct: 20, discount: { s1: 20 } }), ctx(pair(50, 50))), [])
})

t('ส่วนลดที่ตรงได้หลายเปอร์เซ็นต์ (ปัดเป็นบาท) → ไม่เดา', () => {
  // ราคาปกติ 50 ฿ ส่วนลด 10 ฿ ตรงทั้ง 19% และ 20%
  assert.equal(inferScopePct(bundleOf({ discount: { s1: 10 } }), ctx(pair(25, 25)), null), null)
})

t('ประเภทที่ตั้งส่วนลดแยกและตั้งด้วยเปอร์เซ็นต์ → ตามราคาของประเภทนั้น ไม่กระทบค่ากลาง', () => {
  const b = bundleOf({ pct: 20, discount: { s1: 20 }, typeDiscount: { t1: { s1: 25 } }, typePct: { t1: 25 } })
  const rows = driftRows(b, ctx(pair(50, 50, { t1: 60 }), TYPES))
  assert.equal(rows.length, 1)
  assert.equal(rows[0].scopeId, 't1')
  assert.equal(rows[0].target, 28) // 25% ของ 110 = 27.5 → ปัดเป็น 28
})

t('ประเภทที่ตั้งแยกไว้ตรงกับเปอร์เซ็นต์พอดี (ยังไม่ได้ผูก) → แนะนำผูกประเภทนั้น', () => {
  const b = bundleOf({ pct: 20, discount: { s1: 20 }, typeDiscount: { t1: { s1: 28 } } })
  assert.deepEqual(linkSuggestions(b, ctx(pair(50, 50, { t1: 60 }), TYPES)), [{ scopeId: 't1', scopeName: 'ประเภท 1', pct: 25 }])
})

t('ประเภทที่ตั้งแยกด้วยบาทเอง (ไม่มีเปอร์เซ็นต์) → ไม่ตาม และไม่แนะนำให้ผูก', () => {
  const b = bundleOf({ pct: 20, discount: { s1: 20 }, typeDiscount: { t2: { s1: 150 } } })
  const c = ctx(pair(50, 50), TYPES)
  assert.deepEqual(driftRows(b, c), [])
  assert.deepEqual(linkSuggestions(b, c), [])
})

t('ชุดที่ปิดอยู่ไม่เตือนและไม่เสนอให้ตั้งเปอร์เซ็นต์', () => {
  const b = bundleOf({ active: false, pct: 20, discount: { s1: 20 } })
  assert.deepEqual(driftRows(b, ctx(pair(60, 60))), [])
  assert.deepEqual(linkSuggestions(b, ctx(pair(50, 50))), [])
})

t('ช่องที่เป็น 0 หรือว่าง = ตั้งใจไม่ลด ไม่นับเป็นช่องที่ไม่ตรง', () => {
  assert.deepEqual(driftRows(bundleOf({ pct: 20, discount: { s1: 0 } }), ctx(pair(60, 60))), [])
  assert.deepEqual(driftRows(bundleOf({ pct: 20, discount: {} }), ctx(pair(60, 60))), [])
})

t('ตัวเลือกที่ยังไม่มีราคาในขนาดนั้น → ข้ามขนาดนั้น ไม่คิดส่วนลดจากราคาไม่ครบ', () => {
  const groups = [{ id: G, name: 'ท็อปปิ้ง', key: 'extra', type: 'multi', options: [
    { id: 'a', name: 'เชอร์รี่', active: true, priceType: 'fixed', price: 50 },
    { id: 'c', name: 'ครีม', active: true, priceType: 'size', sizePrices: { s1: 40 } }, // ไม่มีราคาของ s2
  ] }]
  const sizes = [{ id: 's1', name: '1 ปอนด์' }, { id: 's2', name: '2 ปอนด์' }]
  const b = bundleOf({ pct: 20, items: [{ groupId: G, optionId: 'a' }, { groupId: G, optionId: 'c' }], discount: { s1: 18, s2: 999 } })
  assert.deepEqual(driftRows(b, ctx(groups, [], sizes)), [])
  assert.deepEqual(discountSlots(b, ctx(groups, [], sizes)).map((s) => s.sizeId), ['s1'])
})

t('makeDraft คัดลอกเปอร์เซ็นต์ของชุดเดิม (แก้ไขและทำสำเนาได้ค่าเดิม)', () => {
  const d = makeDraft({ id: 'x', name: 'ชุด', items: [], pct: 20, typePct: { t1: 25 }, discount: {}, typeDiscount: {}, styleDiscount: {}, active: true }, [], TYPES)
  assert.equal(d.pct, 20)
  assert.deepEqual(d.typePct, { t1: 25 })
  assert.equal(makeDraft(null, [], TYPES).pct, null)
})

console.log(fail ? `\nไม่ผ่าน ${fail} กรณี` : '\nผ่านทั้งหมด')
process.exitCode = fail ? 1 : 0
