// ทดสอบการสร้างออร์เดอร์ฝั่งเซิร์ฟเวอร์ (src/lib/orderCreate.js): ราคาคิดใหม่ทุกครั้ง · ไม่เชื่อราคาที่ส่งมา
// · สิทธิ์ปรับราคา/เหตุผล/เพดานส่วนลด · ออร์เดอร์จากใบเสนอใช้ราคาที่ล็อกไว้ · แถวฐานข้อมูล
// รัน: TZ=Asia/Bangkok node src/lib/orderCreate.test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildQuotePayload } from './quotePrice.js'
import { buildOrderFromDraft, orderRowOf, hasPerm, ORDER_CODE_RE } from './orderCreate.js'

const golden = JSON.parse(readFileSync(new URL('./quotePrice.golden.json', import.meta.url), 'utf8'))
const clone = (x) => JSON.parse(JSON.stringify(x))
const CODE = 'OR-171126-000001'
const ID = 'o_test_1'
// เคสอ้างอิงที่มีราคาได้ (ไม่ใช่เคสที่ถูกปฏิเสธ)
const ref = golden.cases.find((c) => c.payload && c.payload.items?.length)
const catalog = golden.catalog
const base = (over = {}) => ({ draft: clone(ref.draft), customerId: ref.customerId ?? 'golden-cust', catalog, nowMs: golden.nowMs, perms: ['createOrder'], id: ID, code: CODE, by: 'ทดสอบ', ...over })

let fail = 0
const check = (name, fn) => {
  try { fn(); console.log(`PASS ${name}`) } catch (e) { fail++; console.log(`FAIL ${name}: ${e.message.split('\n')[0]}`) }
}

check('สร้างออร์เดอร์ได้ ราคาตรงกับการคิดใบเสนอของเคสเดียวกัน', () => {
  const r = buildOrderFromDraft(base())
  assert.equal(r.ok, true, r.error)
  assert.deepEqual(r.order.items, ref.payload.items)
  assert.equal(r.order.status, 'awaiting_payment')
  assert.equal(r.order.history[0].text, 'สร้างออร์เดอร์ → รอชำระ')
  assert.equal(r.order.history[0].by, 'ทดสอบ')
  assert.equal(r.order.pointsUsed, null)
  assert.deepEqual(r.order.couponsUsed, [])
  assert.deepEqual(r.order.payments, [])
})

check('บันทึกร่างเป็นสถานะ draft', () => {
  const r = buildOrderFromDraft(base({ asDraft: true }))
  assert.equal(r.ok, true)
  assert.equal(r.order.status, 'draft')
  assert.equal(r.order.history[0].text, 'สร้างออร์เดอร์ (ร่าง)')
})

check('ราคาที่ส่งมาจากเครื่องถูกทิ้ง (ตั้งราคา 1 บาทไม่มีผล)', () => {
  const draft = clone(ref.draft)
  for (const it of draft.items) { it.price = 1; it.total = 1; it.net = 1 }
  const r = buildOrderFromDraft(base({ draft }))
  assert.equal(r.ok, true, r.error)
  assert.deepEqual(r.order.items, ref.payload.items)
})

check('ไม่มีสิทธิ์ปรับราคา → ส่วนลดถูกปฏิเสธ (kind = forbidden)', () => {
  const draft = { ...clone(ref.draft), adjustment: { amount: -50, reason: 'ลูกค้าประจำ' } }
  const r = buildOrderFromDraft(base({ draft, perms: ['createOrder', 'chat'] }))
  assert.equal(r.ok, false)
  assert.equal(r.kind, 'forbidden')
})

check('มีสิทธิ์ปรับราคา + เหตุผล → ส่วนลดถูกบันทึก', () => {
  const draft = { ...clone(ref.draft), adjustment: { amount: -50, reason: 'ลูกค้าประจำ' } }
  const r = buildOrderFromDraft(base({ draft, perms: ['createOrder', 'adjustPrice'] }))
  assert.equal(r.ok, true, r.error)
  assert.deepEqual(r.order.adjustment, { amount: -50, reason: 'ลูกค้าประจำ' })
})

check('ผู้จัดการ (manage) ปรับราคาได้โดยไม่ต้องมี adjustPrice', () => {
  const draft = { ...clone(ref.draft), adjustment: { amount: -10, reason: 'ปรับ' } }
  assert.equal(buildOrderFromDraft(base({ draft, perms: ['manage'] })).ok, true)
})

check('ส่วนลดที่ไม่มีเหตุผลถูกปฏิเสธ', () => {
  const draft = { ...clone(ref.draft), adjustment: { amount: -10, reason: '   ' } }
  const r = buildOrderFromDraft(base({ draft, perms: ['adjustPrice'] }))
  assert.equal(r.ok, false)
})

check('ส่วนลดเกินยอดสินค้าถูกปฏิเสธ', () => {
  const draft = { ...clone(ref.draft), adjustment: { amount: -10000000, reason: 'เกิน' } }
  const r = buildOrderFromDraft(base({ draft, perms: ['adjustPrice'] }))
  assert.equal(r.ok, false)
  assert.equal(r.error, 'ส่วนลดเกินยอดสินค้า')
})

check('ออร์เดอร์จากใบเสนอใช้ราคาที่เซิร์ฟเวอร์คิดไว้ ไม่คิดใหม่', () => {
  const quotePayload = clone(ref.payload)
  quotePayload.items = quotePayload.items.map((it) => ({ ...it, _tag: 'from-quote' }))
  const r = buildOrderFromDraft(base({ draft: null, quotePayload, quoteId: 'qt_1' }))
  assert.equal(r.ok, true, r.error)
  assert.equal(r.order.quoteId, 'qt_1')
  assert.deepEqual(r.order.items, quotePayload.items)
})

check('รหัสออร์เดอร์/เลขออร์เดอร์ผิดรูปแบบถูกปฏิเสธ', () => {
  assert.equal(buildOrderFromDraft(base({ id: 'a b' })).ok, false)
  assert.equal(buildOrderFromDraft(base({ code: 'XX-1' })).ok, false)
  assert.equal(ORDER_CODE_RE.test(CODE), true)
})

check('ตัวช่วยสิทธิ์: manage ผ่านทุกอย่าง, ไม่มีสิทธิ์ที่ระบุ = ไม่ผ่าน', () => {
  assert.equal(hasPerm(['manage'], 'adjustPrice'), true)
  assert.equal(hasPerm(['adjustPrice'], 'adjustPrice'), true)
  assert.equal(hasPerm(['createOrder'], 'adjustPrice'), false)
  assert.equal(hasPerm(null, 'adjustPrice'), false)
})

check('แถวฐานข้อมูลมีคอลัมน์ครบและยอดคงค้างเป็นตัวเลข', () => {
  const r = buildOrderFromDraft(base())
  const row = orderRowOf(r.order)
  assert.equal(row.id, ID)
  assert.equal(row.code, CODE)
  assert.equal(row.status, 'awaiting_payment')
  assert.equal(typeof row.balance, 'number')
  assert.equal(row.data.id, undefined) // คอลัมน์แยกไม่ซ้ำใน data
  assert.equal(row.data.items.length, ref.payload.items.length)
})

console.log(fail ? `\n✗ ไม่ผ่าน ${fail} ข้อ` : '\n✓ ผ่านทั้งหมด')
process.exit(fail ? 1 : 0)
