// ทดสอบการตรวจบิลหน้าร้าน (src/lib/posAudit.js): บิลที่ขายถูกต้องต้องผ่าน และบิลที่ถูกแก้แต่ละแบบต้องถูกจับด้วยรหัสที่ถูกต้อง
// ข้อมูลอ้างอิงสร้างจากโค้ดขายของแอปด้วย scripts/pos-audit-golden.mjs · รัน: node src/lib/posAudit.test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { auditPosOrder } from './posAudit.js'

const golden = JSON.parse(readFileSync(new URL('./posAudit.golden.json', import.meta.url), 'utf8'))
const clone = (x) => JSON.parse(JSON.stringify(x))
const codes = (r) => r.flags.map((f) => f.code)

let fail = 0
const check = (name, fn) => {
  try { fn(); console.log(`PASS ${name}`) } catch (e) { fail++; console.log(`FAIL ${name}: ${e.message.split('\n')[0]}`) }
}

// 1) บิลที่ขายถูกต้องทุกใบต้องผ่าน (โปร บันเดิล ของแถม ส่วนลดท้ายบิล ชำระบางส่วน)
for (const b of golden.bills) check(`ขายถูกต้อง ${b.code} ผ่าน`, () => {
  const r = auditPosOrder(b, golden.catalog)
  assert.equal(r.ok, true, JSON.stringify(r.flags))
})

const base = golden.bills.find((b) => b.code === 'POS-drinks-promo')
const lineWith = (b, kind) => b.items.findIndex((i) => i.discounts.some((d) => d.kind === kind))

// 2) ราคาฐานของสินค้าถูกลด (ทั้ง retailPrice/fullPrice/unitPrice) → ราคาไม่ตรงแคตาล็อก และยอดชำระไม่ตรงยอดบิล
check('ลดราคาฐานของสินค้า → base_price_mismatch', () => {
  const b = clone(base)
  Object.assign(b.items[0], { retailPrice: 1, fullPrice: 1, unitPrice: 1, discounts: [] })
  const r = auditPosOrder(b, golden.catalog)
  assert.equal(r.ok, false)
  assert.ok(codes(r).includes('base_price_mismatch'), codes(r).join(','))
  assert.ok(codes(r).includes('payment_mismatch'), codes(r).join(','))
})

// 3) ราคาต่อชิ้นถูกลดโดยไม่มีบันทึกส่วนลด → การคำนวณในรายการไม่ตรง
check('ลดราคาต่อชิ้นโดยไม่มีส่วนลด → line_math', () => {
  const b = clone(base)
  b.items[0].unitPrice = Math.max(0, b.items[0].unitPrice - 20)
  const r = auditPosOrder(b, golden.catalog)
  assert.ok(codes(r).includes('line_math'), codes(r).join(','))
})

// 4) ส่วนลดประเภทที่ไม่อยู่ในรายการที่ใช้ได้ → จับได้
check('ส่วนลดประเภทไม่รู้จัก → unknown_discount', () => {
  const b = clone(base)
  b.items[0].discounts.push({ kind: 'manual', name: 'ลดเอง', amount: 5 })
  const r = auditPosOrder(b, golden.catalog)
  assert.ok(codes(r).includes('unknown_discount'), codes(r).join(','))
})

// 5) ราคาตัวเลือกที่บันทึกในบิลไม่ตรงการตั้งค่า → จับได้
check('ราคาตัวเลือกไม่ตรงการตั้งค่า → modifier_price_mismatch', () => {
  const b = clone(base)
  const withMods = b.items.find((i) => (i.mods || []).length)
  assert.ok(withMods, 'ต้องมีรายการที่มีตัวเลือก')
  withMods.mods[0].price = 0
  const r = auditPosOrder(b, golden.catalog)
  assert.ok(codes(r).includes('modifier_price_mismatch'), codes(r).join(','))
})

// 6) ราคาเต็มไม่ตรงราคาฐาน → จับได้
check('ราคาเต็มไม่ตรงราคาฐาน → full_price_mismatch', () => {
  const b = clone(base)
  b.items[0].fullPrice = b.items[0].fullPrice + 10
  const r = auditPosOrder(b, golden.catalog)
  assert.ok(codes(r).includes('full_price_mismatch'), codes(r).join(','))
})

// 7) ส่วนลดท้ายบิลเป็นบวก (เพิ่มยอดแบบซ่อน) → จับได้
check('ส่วนลดท้ายบิลเป็นบวก → adjustment_positive', () => {
  const b = clone(golden.bills.find((x) => x.code === 'POS-manual-discount'))
  b.adjustment = { amount: 50, reason: 'x' }
  const r = auditPosOrder(b, golden.catalog)
  assert.ok(codes(r).includes('adjustment_positive'), codes(r).join(','))
})

// 8) ส่วนลดท้ายบิลเกินยอดสินค้า → จับได้
check('ส่วนลดท้ายบิลเกินยอดสินค้า → adjustment_too_large', () => {
  const b = clone(golden.bills.find((x) => x.code === 'POS-manual-discount'))
  b.adjustment = { amount: -100000, reason: 'x' }
  const r = auditPosOrder(b, golden.catalog)
  assert.ok(codes(r).includes('adjustment_too_large'), codes(r).join(','))
})

// 9) สถานะชำระแล้วแต่ไม่มีการรับชำระ → จับได้
check('ชำระแล้วแต่ไม่มีการรับชำระ → paid_without_payment', () => {
  const b = clone(base)
  b.payments = []
  const r = auditPosOrder(b, golden.catalog)
  assert.ok(codes(r).includes('paid_without_payment'), codes(r).join(','))
})

// 10) รับชำระน้อยกว่ายอดบิล → จับได้
check('รับชำระไม่ครบยอดบิล → payment_mismatch', () => {
  const b = clone(base)
  b.payments[0].amount = b.payments[0].amount - 10
  const r = auditPosOrder(b, golden.catalog)
  assert.ok(codes(r).includes('payment_mismatch'), codes(r).join(','))
})

// 11) สินค้าที่ไม่มีในแคตาล็อก → เตือนระดับ check (อาจถูกลบหลังขาย)
check('สินค้าไม่อยู่ในแคตาล็อก → unknown_item (check)', () => {
  const b = clone(base)
  b.items[0].retailId = 'no-such-item'
  const r = auditPosOrder(b, golden.catalog)
  const f = r.flags.find((x) => x.code === 'unknown_item')
  assert.ok(f, codes(r).join(','))
  assert.equal(f.severity, 'check')
})

// 12) บิลหน้าร้านมีรายการสั่งทำ (custom) → จับได้
check('มีรายการสั่งทำในบิลหน้าร้าน → unexpected_kind', () => {
  const b = clone(base)
  b.items[0].kind = 'custom'
  const r = auditPosOrder(b, golden.catalog)
  assert.ok(codes(r).includes('unexpected_kind'), codes(r).join(','))
})

// 13) บิลค้างชำระบางส่วน (pos_pending) ไม่ถูกเทียบกับยอดชำระ
check('บิลค้างชำระบางส่วนไม่ถูกเทียบยอดชำระ', () => {
  const b = clone(golden.bills.find((x) => x.code === 'POS-partial-pending'))
  b.payments[0].amount = 1
  assert.equal(auditPosOrder(b, golden.catalog).ok, true)
})

console.log(fail ? `\n✗ ไม่ผ่าน ${fail} ข้อ` : '\n✓ posAudit: ผ่านทั้งหมด')
process.exit(fail ? 1 : 0)
