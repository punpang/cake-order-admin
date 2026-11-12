// ทดสอบตัวช่วยหน้าบันเดิ้ล · รัน: node src/lib/bundleEditor.test.mjs
import assert from 'node:assert/strict'
import { autoBundleName, bahtText, bundleSummary, checkBundle, effectiveDiscount, makeDraft, percentOf, regularTotal } from './bundleEditor.js'

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
    id: 'g_fill', name: 'ไส้', key: 'filling', active: true,
    options: [
      { id: 'f1', name: 'ครีมชีส', active: true, priceType: 'size', sizePrices: { s1: 20, s2: 30 }, typePrices: { tA: { s1: 25 }, tZ: { s1: 0 } } },
      { id: 'f2', name: 'สตรอว์เบอร์รี', active: true, priceType: 'fixed', price: 15, typePrice: { tA: 18 } },
      { id: 'f3', name: 'ปิดอยู่', active: false, priceType: 'fixed', price: 5 },
    ],
  },
  {
    id: 'g_top', name: 'ท็อปปิ้ง', key: 'topping', active: true,
    options: [{ id: 'p1', name: 'บลูเบอร์รี', active: true, priceType: 'size', sizePrices: { s1: 10, s2: 12 }, typePrices: { tZ: { s1: 0 } } }],
  },
]
const sizes = [{ id: 's1', name: '1 ปอนด์' }, { id: 's2', name: '2 ปอนด์' }]
const types = [
  { id: 'tA', name: 'เค้กวันเกิด', active: true },
  { id: 'tB', name: 'เค้กแต่งงาน', active: true },
]
const ctx = { groups, sizes, types, styles: [], bundles: [] }
const ITEMS = [{ groupId: 'g_fill', optionId: 'f1' }, { groupId: 'g_top', optionId: 'p1' }]
const draft = (o = {}) => ({ id: null, name: '', items: ITEMS, discount: {}, types: [], typeDiscount: {}, styleDiscount: {}, styleMode: {}, active: true, ...o })

t('ราคาปกติรวม: ทุกประเภทใช้ราคากลาง · ประเภทที่ตั้งราคาแยกใช้ราคาของประเภทนั้น', () => {
  assert.equal(regularTotal(ITEMS, groups, null, 's1'), 30) // 20 + 10
  assert.equal(regularTotal(ITEMS, groups, null, 's2'), 42) // 30 + 12
  assert.equal(regularTotal(ITEMS, groups, 'tA', 's1'), 35) // 25 (แยกประเภท) + 10 (ราคากลาง)
  assert.equal(regularTotal([{ groupId: 'g_fill', optionId: 'f2' }], groups, 'tA', 's1'), 18) // ราคาคงที่แยกประเภท
  assert.equal(regularTotal([{ groupId: 'g_fill', optionId: 'f2' }], groups, null, 's1'), 15)
  assert.equal(regularTotal([], groups, null, 's1'), 0)
})

t('ส่วนลดที่ลูกค้าได้จริง: ช่องประเภทว่างใช้ส่วนลดกลาง · กรอก 0 = ไม่ลดในประเภทนั้น', () => {
  const base = draft({ discount: { s1: 20 }, typeDiscount: { tA: { s1: '' } } })
  assert.equal(effectiveDiscount(base, 'tA', 's1'), 20)
  assert.equal(effectiveDiscount(draft({ discount: { s1: 20 }, typeDiscount: { tA: { s1: 0 } } }), 'tA', 's1'), 0)
  assert.equal(effectiveDiscount(draft({ discount: { s1: 20 }, typeDiscount: { tA: { s1: 35 } } }), 'tA', 's1'), 35)
  assert.equal(effectiveDiscount(base, null, 's1'), 20)
})

t('ไม่เลือกตัวเลือกเลย = ต้องแก้ก่อนบันทึก', () => {
  const r = checkBundle(draft({ items: [] }), ctx)
  assert.ok(r.errors.some((e) => e.includes('อย่างน้อย 1')))
})

t('ลดมากกว่าราคาปกติของประเภทใดประเภทหนึ่ง = ต้องแก้ (ใช้กับทุกประเภทต้องผ่านทุกประเภท)', () => {
  // เค้กแต่งงาน 1 ปอนด์ราคาปกติ 30 · ตั้งลด 32 ทั้งชุด → ไม่ผ่าน
  const r = checkBundle(draft({ discount: { s1: 32 } }), ctx)
  assert.equal(r.errors.length, 1)
  assert.ok(r.errors[0].includes('เค้กแต่งงาน'))
})

t('ชุดที่จำกัดประเภท: ตรวจเฉพาะประเภทที่เลือก', () => {
  const r = checkBundle(draft({ types: ['tA'], discount: { s1: 32 } }), ctx) // เค้กวันเกิด = 35 ≥ 32
  assert.deepEqual(r.errors, [])
})

t('ตั้งส่วนลดแยกประเภทเกินราคาปกติของประเภทนั้น = ต้องแก้', () => {
  const r = checkBundle(draft({ discount: { s1: 10 }, typeDiscount: { tA: { s1: 40 } } }), ctx) // เค้กวันเกิด = 35
  assert.ok(r.errors.some((e) => e.includes('เค้กวันเกิด')))
})

t('ประเภทที่ปิดอยู่ไม่ถูกนำมาตรวจ (ไม่บล็อกการบันทึกโดยไม่จำเป็น)', () => {
  // เค้กปิด: ราคาปกติ 0 (tZ) · ลด 20 → ถ้านับจะผิด แต่ประเภทปิดลูกค้าสั่งไม่ได้
  const r = checkBundle(draft({ discount: { s1: 20 } }), { ...ctx, types: [...types, { id: 'tZ', name: 'เค้กปิด', active: false }] })
  assert.deepEqual(r.errors, [])
})

t('ยังไม่มีส่วนลดเลย = เตือน (บันทึกได้)', () => {
  const r = checkBundle(draft({ discount: {} }), ctx)
  assert.deepEqual(r.errors, [])
  assert.ok(r.warnings.some((w) => w.includes('ยังไม่มีส่วนลด')))
})

t('ตัวเลือกที่ปิดอยู่ในชุด = เตือน', () => {
  const r = checkBundle(draft({ items: [{ groupId: 'g_fill', optionId: 'f3' }, { groupId: 'g_top', optionId: 'p1' }], discount: { s1: 5 } }), ctx)
  assert.ok(r.warnings.some((w) => w.includes('ปิดอยู่')))
})

t('ชุดตัวเลือกเดียว และชุดที่ใช้ตัวเลือกร่วมกับชุดอื่น = ข้อมูลประกอบ', () => {
  const single = checkBundle(draft({ items: [ITEMS[0]], discount: { s1: 5 } }), ctx)
  assert.ok(single.info.some((i) => i.includes('ตัวเลือกเดียว')))
  const other = { id: 'x', name: 'ชุดอื่น', active: true, items: [ITEMS[0]] }
  const shared = checkBundle(draft({ discount: { s1: 5 } }), { ...ctx, bundles: [other] })
  assert.ok(shared.info.some((i) => i.includes('ชุดอื่น')))
  const alone = checkBundle(draft({ discount: { s1: 5 } }), { ...ctx, bundles: [{ ...other, active: false }] })
  assert.ok(!alone.info.some((i) => i.includes('ชุดอื่น')))
})

t('ร่างฟอร์ม: เติมช่องทุกประเภทและรูปแบบ · ไม่ทำให้ค่าของประเภทที่ปิดอยู่หาย', () => {
  const src = {
    id: 'b9', name: 'ทดสอบ', items: ITEMS, discount: { s1: 10 }, types: [],
    typeDiscount: { tZ: { s1: 7 } }, styleDiscount: {}, styleMode: { st1: 'own' }, active: true,
  }
  const d = makeDraft(src, [{ id: 'st1' }, { id: 'st2' }], types)
  assert.equal(d.id, 'b9')
  assert.deepEqual(d.typeDiscount.tZ, { s1: 7 })
  assert.deepEqual(d.typeDiscount.tA, {})
  assert.equal(d.styleMode.st1, 'own')
  assert.equal(d.styleMode.st2, 'central')
  assert.equal(makeDraft(null, [], types).active, true)
  assert.deepEqual(makeDraft(null, [], types).items, [])
})

t('สรุปการ์ดรายการ: ส่วนลดต่อขนาด · ขอบเขตประเภท · ชุดที่ยังไม่มีส่วนลด', () => {
  const s = bundleSummary(draft({ types: ['tA'], discount: { s1: 20 } }), ctx)
  assert.equal(s.scope, 'ใช้กับ เค้กวันเกิด')
  assert.deepEqual(s.sizes.map((z) => z.amount), [20, 0])
  assert.equal(s.hasDiscount, true)
  const none = bundleSummary(draft({ discount: {} }), ctx)
  assert.equal(none.scope, 'ใช้ได้ทุกประเภท')
  assert.equal(none.hasDiscount, false)
})

t('เปอร์เซ็นต์ของราคาปกติ: ปัดเป็นบาทเต็ม ไม่เกิน 100%', () => {
  assert.equal(percentOf(350, 10), 35)
  assert.equal(percentOf(99, 33), 33) // 32.67 → 33
  assert.equal(percentOf(0, 10), 0)
  assert.equal(percentOf(100, 150), 100)
  assert.equal(percentOf(100, ''), 0)
})

t('ชื่ออัตโนมัติและข้อความเงิน', () => {
  assert.equal(autoBundleName(ITEMS, groups), 'ครีมชีส + บลูเบอร์รี')
  assert.equal(bahtText(50), '50 ฿')
  assert.equal(bahtText(1234.5), '1,234.5 ฿')
})

console.log(fail ? `${fail} FAILED` : 'ALL PASS')
process.exit(fail ? 1 : 0)
