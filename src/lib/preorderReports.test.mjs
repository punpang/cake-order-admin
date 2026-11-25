// ทดสอบรายงานสั่งล่วงหน้า (ฟังก์ชันล้วน) · รัน: node src/lib/preorderReports.test.mjs
import assert from 'node:assert/strict'
import { activeOrders, prepSheet, pickupList, shipQueue, dueList, campaignSummary, exceptionList } from './preorderReports.js'

let fail = 0
const t = (name, fn) => { try { fn(); console.log(`PASS ${name}`) } catch (e) { fail++; console.log(`FAIL ${name}: ${e.message}`) } }

const base = { campaignId: 'c1', customerName: 'สมชาย', fulfillment: 'pickup', total: 100, paid: 0, shippingFee: 0, shipping: null, payDueAt: '2099-01-01T00:00:00Z', status: 'awaiting_payment' }
const names = { r1: 'คัพเค้ก', r2: 'เค้กช็อก' }
const orders = [
  { ...base, id: 'a', code: 'A1', pickupDate: '2099-12-24', lines: [{ retailId: 'r1', qty: 2 }], paid: 50 },
  { ...base, id: 'b', code: 'B1', pickupDate: '2099-12-24', lines: [{ retailId: 'r1', qty: 3 }, { retailId: 'r2', qty: 1 }], paid: 100, status: 'payment_confirmed' },
  { ...base, id: 'c', code: 'C1', pickupDate: '2099-12-25', lines: [{ retailId: 'r2', qty: 4 }] },
  { ...base, id: 'd', code: 'D1', pickupDate: '2099-12-24', lines: [{ retailId: 'r1', qty: 9 }], status: 'cancelled' },
  { ...base, id: 'e', code: 'E1', pickupDate: '2099-12-24', lines: [{ retailId: 'r1', qty: 9 }], status: 'expired' },
  { ...base, id: 'f', code: 'F1', pickupDate: '', lines: [{ retailId: 'r1', qty: 1 }] },
  { ...base, id: 'g', code: 'G1', pickupDate: '2099-12-26', lines: [] },
]

t('activeOrders ตัดออร์เดอร์ยกเลิกและหมดเวลาออก', () => {
  assert.deepEqual(activeOrders(orders).map((o) => o.code), ['A1', 'B1', 'C1', 'F1', 'G1'])
})

t('ใบจัดเตรียมรวมจำนวนต่อสินค้าต่อวัน และไม่นับยกเลิก/หมดเวลา', () => {
  const sheet = prepSheet(orders, { names })
  const day24 = sheet.find((d) => d.pickupDate === '2099-12-24')
  assert.deepEqual(day24.items, [{ retailId: 'r1', name: 'คัพเค้ก', qty: 5 }, { retailId: 'r2', name: 'เค้กช็อก', qty: 1 }])
  assert.equal(day24.orderCount, 2)
  assert.equal(day24.paidCount, 1)
  assert.equal(day24.unpaidCount, 1)
})

t('ใบจัดเตรียมแยกวันรับและเรียงตามวัน', () => {
  const sheet = prepSheet(orders, { names })
  assert.deepEqual(sheet.map((d) => d.pickupDate), ['', '2099-12-24', '2099-12-25', '2099-12-26'])
})

t('ออร์เดอร์ที่ไม่มีวันรับหรือไม่มีสินค้าไปอยู่ในข้อยกเว้น ไม่ทำให้รายงานล้ม', () => {
  const sheet = prepSheet(orders, { names })
  assert.deepEqual(sheet.find((d) => d.pickupDate === '').exceptions, [{ code: 'F1', reason: 'ไม่มีวันรับ' }])
  assert.deepEqual(sheet.find((d) => d.pickupDate === '2099-12-26').exceptions, [{ code: 'G1', reason: 'ไม่มีรายการสินค้า' }])
  assert.equal(sheet.find((d) => d.pickupDate === '2099-12-26').orderCount, 0)
})

t('ใบจัดเตรียมกรองตามแคมเปญและช่วงวันรับ', () => {
  const sheet = prepSheet(orders, { names, from: '2099-12-25', to: '2099-12-25', campaignId: 'c1' })
  assert.deepEqual(sheet.map((d) => d.pickupDate), ['2099-12-25'])
})

t('รายการรับของวันหนึ่งแสดงยอดที่ชำระและยอดค้าง', () => {
  const list = pickupList(orders, { date: '2099-12-24' })
  assert.deepEqual(list.map((x) => [x.code, x.paid, x.due]), [['A1', 50, 50], ['B1', 100, 0]])
})

t('ออร์เดอร์จัดส่งที่ยังไม่มีเลขพัสดุ', () => {
  const o = [{ ...base, id: 'h', code: 'H1', fulfillment: 'delivery', total: 200, paid: 200, shippingFee: 30, lines: [{ retailId: 'r1', qty: 1 }] }]
  assert.deepEqual(shipQueue(o).map((x) => [x.code, x.paidFull, x.shippingFee]), [['H1', true, 30]])
})

t('ยอดค้างเรียงตามเวลาหมดเขต และติดธงที่เกินเวลาแล้ว', () => {
  const nowMs = Date.parse('2099-06-01T00:00:00Z')
  const list = dueList([
    { ...base, code: 'X1', payDueAt: '2099-07-01T00:00:00Z' },
    { ...base, code: 'X2', payDueAt: '2099-05-01T00:00:00Z' },
    { ...base, code: 'X3', paid: 100 },
  ], { nowMs })
  assert.deepEqual(list.map((x) => [x.code, x.overdue]), [['X2', true], ['X1', false]])
})

t('สรุปรายแคมเปญรวมยอดขาย ยอดรับ และยอดค้าง', () => {
  const s = campaignSummary(orders, { campaignId: 'c1' })
  assert.deepEqual(s, { orderCount: 5, sales: 500, paid: 150, due: 350 })
})

t('รายการยกเลิก หมดเวลา และขอคืน', () => {
  const list = exceptionList([...orders, { ...base, code: 'R1', status: 'payment_confirmed', returnRequest: { reason: 'x' } }])
  assert.deepEqual(list.map((x) => [x.code, x.reason]), [['D1', 'ยกเลิกแล้ว'], ['E1', 'หมดเวลาชำระ'], ['R1', 'ขอคืนสินค้า']])
})

if (fail) { console.log(`\n${fail} ล้มเหลว`); process.exit(1) }
console.log('\nผ่านทั้งหมด')
