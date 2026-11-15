// ทดสอบราคาใบเสนอ (src/lib/quotePrice.js): ตรงกับไฟล์อ้างอิงที่สร้างจากโค้ดเดิมของแอป · ไม่ขึ้นกับโซนเวลาของเครื่อง
// · ไม่เชื่อราคา/ส่วนลดที่ส่งมา · ตัวกรองข้อมูลไม่ถูกต้อง · รัน: node src/lib/quotePrice.test.mjs
// ไฟล์อ้างอิงสร้างใหม่ด้วย: TZ=Asia/Bangkok node scripts/quote-golden.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildQuotePayload } from './quotePrice.js'

const golden = JSON.parse(readFileSync(new URL('./quotePrice.golden.json', import.meta.url), 'utf8'))
const clone = (x) => JSON.parse(JSON.stringify(x))
const build = (draft, catalog = golden.catalog, customerId = 'golden-cust') => buildQuotePayload({ draft, customerId, catalog, nowMs: golden.nowMs })
// ค่า VAT ของเคสนั้น (เคสไม่มี VAT ใช้ค่าปิด)
const catFor = (c) => (c.shopVat ? { ...golden.catalog, shop: { ...golden.catalog.shop, vat: c.shopVat } } : golden.catalog)

let fail = 0
const check = (name, fn) => {
  try { fn(); console.log(`PASS ${name}`) } catch (e) { fail++; console.log(`FAIL ${name}: ${e.message.split('\n')[0]}`) }
}

// 1) ตรงกับโค้ดเดิมของแอป ทุกเคส ทุกโซนเวลา (เวลาไทย / UTC / ลอสแอนเจลิส)
for (const tz of ['Asia/Bangkok', 'UTC', 'America/Los_Angeles']) {
  process.env.TZ = tz
  for (const c of golden.cases) {
    check(`golden ${c.name} [${tz}]`, () => {
      const r = build(c.draft, catFor(c), c.customerId)
      if (c.payload === null) {
        assert.equal(r.ok, false)
        assert.equal(r.code, 'closed')
      } else {
        assert.equal(r.ok, true, r.error)
        assert.deepStrictEqual(clone(r.payload), c.payload)
      }
    })
  }
}
process.env.TZ = 'Asia/Bangkok'

const base = golden.cases.find((c) => c.name === 'retail-promos-and-gift') // มี VAT และมีสินค้าหน้าร้าน
const retailItem = (draft) => draft.items.find((i) => i.kind === 'retail')

// 2) ราคาสินค้าหน้าร้านมาจากแคตาล็อก ไม่ใช่จากเครื่องพนักงาน
check('retail price from client is ignored', () => {
  const d = clone(base.draft)
  retailItem(d).retailPrice = 1
  retailItem(d).sizeId = 'fake-size'
  const r = build(d)
  assert.equal(r.ok, true)
  assert.deepStrictEqual(clone(r.payload), base.payload)
})

// 3) ส่วนลด/ราคาที่ส่งมาเอง (discounts/unitPrice) ถูกคำนวณใหม่ทั้งหมด
check('client-sent discounts and unitPrice are recomputed', () => {
  const d = clone(base.draft)
  Object.assign(retailItem(d), { unitPrice: 0, discounts: [{ kind: 'promo', name: 'ฟรี', amount: 999 }] })
  const r = build(d)
  assert.equal(r.ok, true)
  assert.deepStrictEqual(clone(r.payload), base.payload)
})

// 4) selections ของสินค้าหน้าร้านไม่มีผลต่อราคา (เหมือนการขายหน้าร้าน)
check('selections on a retail line do not change its price', () => {
  const d = clone(base.draft)
  retailItem(d).selections = { any: ['x'] }
  const r = build(d)
  assert.equal(r.ok, true)
  assert.deepStrictEqual(clone(r.payload), base.payload)
})

// 5) สินค้าที่ปิดขายหรือไม่มีในระบบ → ปฏิเสธ
check('inactive retail item is rejected', () => {
  const cat = clone(golden.catalog)
  cat.retailItems.find((x) => x.id === retailItem(base.draft).retailId).active = false
  const r = build(base.draft, cat)
  assert.equal(r.ok, false)
  assert.match(r.error, /ไม่พร้อมขาย/)
})
check('unknown retail item is rejected', () => {
  const d = clone(base.draft)
  retailItem(d).retailId = 'no-such-item'
  assert.equal(build(d).ok, false)
})

// 6) ตัวกรองข้อมูล
const bad = [
  ['fulfillment ผิด', (d) => { d.fulfillment = 'shipping' }, /รูปแบบการรับสินค้า/],
  ['เวลานัดมีโซน', (d) => { d.pickupAt = '2026-11-23T16:00:00Z' }, /วันเวลานัด/],
  ['เวลานัดรูปแบบผิด', (d) => { d.pickupAt = 'พรุ่งนี้' }, /วันเวลานัด/],
  ['จำนวนศูนย์', (d) => { retailItem(d).qty = 0 }, /จำนวนสินค้า/],
  ['จำนวนทศนิยม', (d) => { retailItem(d).qty = 1.5 }, /จำนวนสินค้า/],
  ['จำนวนเกิน', (d) => { retailItem(d).qty = 1000 }, /จำนวนสินค้า/],
  ['ไม่มีรายการ', (d) => { d.items = [] }, /รายการสินค้า/],
  ['รายการเกิน 60', (d) => { d.items = Array.from({ length: 61 }, () => clone(retailItem(d))) }, /รายการสินค้า/],
  ['มีแต่ของแถม', (d) => { d.items = [{ ...retailItem(d), promoGift: true }] }, /รายการสินค้า/],
  ['ประเภทรายการผิด', (d) => { retailItem(d).kind = 'bundle' }, /ประเภทรายการ/],
]
for (const [name, mutate, re] of bad) {
  check(`ปฏิเสธ: ${name}`, () => {
    const d = clone(base.draft)
    mutate(d)
    const r = build(d)
    assert.equal(r.ok, false)
    assert.match(r.error, re)
  })
}

// 7) ของแถม (promoGift) ที่ส่งมาเองถูกทิ้ง และไม่มีการแทรกของแถมจากเครื่อง
check('client promoGift row is dropped', () => {
  const d = clone(golden.cases.find((c) => c.name === 'retail-promos-and-gift').draft)
  const r = build(d)
  assert.equal(r.ok, true)
  assert.deepStrictEqual(clone(r.payload), golden.cases.find((c) => c.name === 'retail-promos-and-gift').payload)
})

// 8) วันเกิดที่รูปแบบผิดไม่ถูกบันทึก
check('invalid birthday becomes null', () => {
  const d = clone(base.draft)
  d.birthday = { name: 'x', md: '2026-05-12' }
  assert.equal(build(d).payload.birthday, null)
})

// 9) ค่าที่เป็นชนิดผิดในตัวเลือกถูกตัดทิ้ง (ไม่มีผลต่อราคาที่ได้)
check('non-string option values are dropped', () => {
  const d = clone(golden.cases.find((c) => c.name === 'cake-pickup').draft)
  d.items[0].selections.bogus = { nested: true }
  const r = build(d)
  assert.equal(r.ok, true)
  assert.deepStrictEqual(clone(r.payload), golden.cases.find((c) => c.name === 'cake-pickup').payload)
})

// 10) ร้านปิดรับนัด → ปฏิเสธพร้อมเหตุผล
check('closed slot is rejected with reason', () => {
  const r = build(golden.cases.find((c) => c.name === 'closed-slot').draft)
  assert.equal(r.ok, false)
  assert.equal(r.code, 'closed')
  assert.match(r.error, /พักเที่ยง/)
})

console.log(fail ? `\n✗ ไม่ผ่าน ${fail} ข้อ` : '\n✓ quotePrice: ผ่านทั้งหมด')
process.exit(fail ? 1 : 0)
