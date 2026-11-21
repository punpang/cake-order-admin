// ทดสอบตัวช่วยแสดงผลของหน้าคิวรอตรวจ: หัวข้อเหตุผลภาษาไทย · อายุรายการ · ยอดบิลและส่วนต่าง · รายการสินค้า · การอ่านชื่อลูกค้า · รัน: node src/lib/reviewView.test.mjs
import { fileURLToPath } from 'node:url'
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const server = await createServer({ root: ROOT, server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' })
after(() => server.close())
const { reasonText, ageText, billSummary, balanceText, itemsText, customerNames, activePays } = await server.ssrLoadModule('/src/lib/reviewView.js')

const items = [{ id: 'a', name: 'เค้กช็อกโกแลต', unitPrice: 150, qty: 1 }, { id: 'b', name: 'คุกกี้', unitPrice: 30, qty: 1 }]
const pay = (amount) => [{ id: 'p', status: 'confirmed', amount, posMethod: 'cash' }]

test('reasonText: รหัสที่เข้าคิวได้จริงแสดงหัวข้อภาษาไทยและรายละเอียดเดิม', () => {
  assert.deepEqual(reasonText('punpang_over_bill: ยอดที่ยืนยันรวม 220 บาท เกินยอดบิล 180 บาท'), { label: 'ยอดชำระเกินยอดบิล', detail: 'ยอดที่ยืนยันรวม 220 บาท เกินยอดบิล 180 บาท' })
  assert.equal(reasonText('punpang_card_unconfirmed: รับชำระด้วยบัตรต้องกดยืนยันรับบัตรแล้วก่อน').label, 'รับบัตรแต่ยังไม่ยืนยันรับบัตร')
  assert.equal(reasonText('punpang_customer_deleted: ลูกค้าถูกลบแล้ว รับออร์เดอร์ใหม่ไม่ได้').label, 'ลูกค้าถูกลบแล้ว')
})

test('reasonText: รหัสที่ไม่รู้จักไม่เดาความหมาย แสดงข้อความเดิมทั้งหมด · ค่าว่างไม่พัง', () => {
  const raw = 'some other rule failed'
  assert.deepEqual(reasonText(raw), { label: 'ระบบไม่รับออร์เดอร์', detail: raw })
  assert.deepEqual(reasonText(''), { label: 'ระบบไม่รับออร์เดอร์', detail: '' })
  assert.deepEqual(reasonText(undefined), { label: 'ระบบไม่รับออร์เดอร์', detail: '' })
})

test('reasonText: ด่านคูปองที่เข้าคิวได้มีหัวข้อภาษาไทย ไม่แสดงข้อความอังกฤษ', () => {
  const r = reasonText('coupon is not claimed for this order or the discount is too large')
  assert.equal(r.label, 'คูปองใช้ไม่ได้: ถูกใช้ไปแล้วหรือส่วนลดเกินที่คูปองให้')
  assert.equal(r.detail, '')
})

test('ageText: แสดงอายุเป็นข้อความสั้น', () => {
  const now = Date.parse('2026-11-21T08:00:00Z')
  assert.equal(ageText('2026-11-21T07:59:40Z', now), 'เมื่อสักครู่')
  assert.equal(ageText('2026-11-21T07:12:00Z', now), '48 นาทีที่แล้ว')
  assert.equal(ageText('2026-11-21T05:00:00Z', now), '3 ชั่วโมงที่แล้ว')
  assert.equal(ageText('2026-11-18T08:00:00Z', now), '3 วันที่แล้ว')
  assert.equal(ageText('ไม่ใช่วันที่', now), '')
})

test('billSummary: ยอดบิล ยอดชำระ และส่วนต่างถูกต้องทั้งเกิน ขาด และครบ', () => {
  const over = billSummary({ items, payments: [{ id: 'p1', status: 'confirmed', amount: 120 }, { id: 'p2', status: 'confirmed', amount: 100 }] })
  assert.equal(over.total, 180)
  assert.equal(over.paid, 220)
  assert.equal(over.diff, 40)
  assert.equal(over.state, 'over')
  assert.equal(billSummary({ items, payments: pay(150) }).state, 'short')
  assert.equal(billSummary({ items, payments: pay(180) }).state, 'ok')
})

test('billSummary: ส่วนลดคูปองลดยอดบิล และข้อมูลไม่สมบูรณ์ไม่ทำให้หน้าพัง', () => {
  const s = billSummary({ items, couponsUsed: [{ couponId: 'c', name: 'ลด 30', amount: 30 }], payments: pay(150) })
  assert.equal(s.total, 150)
  assert.equal(s.state, 'ok')
  assert.equal(billSummary(null)?.state ?? null, null)
})

test('balanceText: ข้อความและสีตามส่วนต่าง', () => {
  assert.deepEqual(balanceText({ state: 'over', diff: 40 }), { tone: 'text-rose-700', text: 'เกินยอดบิล 40.00 ฿' })
  assert.deepEqual(balanceText({ state: 'short', diff: -30 }), { tone: 'text-amber-700', text: 'ขาดอีก 30.00 ฿' })
  assert.deepEqual(balanceText({ state: 'ok', diff: 0 }), { tone: 'text-emerald-700', text: 'ชำระครบพอดี' })
  assert.equal(balanceText(null), null)
})

test('activePays: รายการที่ขีดฆ่าไม่นับ และเลิกขีดฆ่าได้ (ไม่ใช้ตำแหน่งที่เลื่อน)', () => {
  const list = [{ amount: 1 }, { amount: 2 }, { amount: 3 }]
  assert.deepEqual(activePays(list, {}), list)
  assert.deepEqual(activePays(list, { 1: true }), [{ amount: 1 }, { amount: 3 }])
  assert.deepEqual(activePays(list, { 1: true, 1.5: true }), [{ amount: 1 }, { amount: 3 }])
  assert.deepEqual(activePays(list, { 1: false }), list)
})

test('itemsText: แสดงสูงสุด 3 รายการและบอกจำนวนที่เหลือ', () => {
  assert.equal(itemsText({ items }), 'เค้กช็อกโกแลต ×1 · คุกกี้ ×1')
  const many = [1, 2, 3, 4, 5].map((n) => ({ name: 'ข' + n, qty: 2 }))
  assert.equal(itemsText({ items: many }), 'ข1 ×2 · ข2 ×2 · ข3 ×2 และอีก 2 รายการ')
  assert.equal(itemsText({}), '')
})

test('customerNames: อ่านชื่อได้ และถ้า RLS หรือการอ่านผิดพลาด = ไม่มีชื่อ (ไม่ทำให้หน้าพัง)', async () => {
  const calls = []
  const ok = { from(t) { calls.push(t); return { select() { return { in: async () => ({ data: [{ id: 'c1', name: 'คุณสมชาย' }, { id: 'c2', name: '' }], error: null }) } } } } }
  const names = await customerNames(ok, ['c1', 'c2', 'c1', ''])
  assert.equal(names.get('c1'), 'คุณสมชาย')
  assert.equal(names.has('c2'), false)
  assert.deepEqual(calls, ['punpang_customers'])
  const denied = { from() { return { select() { return { in: async () => ({ data: null, error: { message: 'denied' } }) } } } } }
  assert.equal((await customerNames(denied, ['c1'])).size, 0)
})
