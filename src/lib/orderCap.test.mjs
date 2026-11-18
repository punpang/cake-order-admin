// ทดสอบการนับออเดอร์ต่อวันและสถานะความจุ · รัน: node src/lib/orderCap.test.mjs
import assert from 'node:assert/strict'
import { capDayKey, ordersOnDay, capState, capFullMsg } from './orderCap.js'

let fail = 0
const t = (name, fn) => { try { fn(); console.log(`PASS ${name}`) } catch (e) { fail++; console.log(`FAIL ${name}: ${e.message}`) } }

// เวลาท้องถิ่นของเครื่องทดสอบ (ใช้ตัวสร้างวันเดียวกับแอป จึงไม่ขึ้นกับเขตเวลา)
const at = (y, m, d, h = 10) => new Date(y, m - 1, d, h, 0, 0).toISOString()

t('capDayKey: วันที่นัดรับเป็น YYYY-MM-DD ตามเวลาเครื่อง', () => {
  assert.equal(capDayKey(at(2026, 11, 20, 9)), '2026-11-20')
  assert.equal(capDayKey(at(2026, 11, 20, 23)), '2026-11-20')
})
t('capDayKey: ค่าวันที่เสียให้ได้ค่าว่าง', () => {
  assert.equal(capDayKey('ไม่ใช่วันที่'), '')
  assert.equal(capDayKey(undefined), '')
})

t('ordersOnDay: นับเฉพาะออเดอร์ของวันนั้น', () => {
  const orders = [
    { status: 'awaiting_payment', pickupAt: at(2026, 11, 20) },
    { status: 'delivered', pickupAt: at(2026, 11, 20, 18) },
    { status: 'awaiting_payment', pickupAt: at(2026, 11, 21) },
  ]
  assert.equal(ordersOnDay(orders, '2026-11-20'), 2)
  assert.equal(ordersOnDay(orders, '2026-11-21'), 1)
  assert.equal(ordersOnDay(orders, '2026-11-22'), 0)
})
t('ordersOnDay: ไม่นับยกเลิกและร่าง', () => {
  const orders = [
    { status: 'cancelled', pickupAt: at(2026, 11, 20) },
    { status: 'draft', pickupAt: at(2026, 11, 20) },
    { status: 'preparing', pickupAt: at(2026, 11, 20) },
  ]
  assert.equal(ordersOnDay(orders, '2026-11-20'), 1)
})
t('ordersOnDay: ข้ามรายการว่างและไม่มีวันที่', () => {
  assert.equal(ordersOnDay([null, undefined, { status: 'preparing', pickupAt: at(2026, 11, 20) }], '2026-11-20'), 1)
  assert.equal(ordersOnDay([{ status: 'preparing' }], ''), 0)
  assert.equal(ordersOnDay(undefined, '2026-11-20'), 0)
})

t('capState: 0 หรือค่าว่าง = ไม่จำกัด', () => {
  assert.deepEqual(capState(0, 999), { capped: false, full: false, left: Infinity })
  assert.deepEqual(capState('', 5), { capped: false, full: false, left: Infinity })
  assert.deepEqual(capState(undefined, 5), { capped: false, full: false, left: Infinity })
})
t('capState: ยังเหลือที่ว่าง', () => {
  assert.deepEqual(capState(10, 7), { capped: true, full: false, left: 3 })
})
t('capState: ครบพอดีถือว่าเต็ม', () => {
  assert.deepEqual(capState(10, 10), { capped: true, full: true, left: 0 })
})
t('capState: เกินจำนวนไม่ติดลบ', () => {
  assert.deepEqual(capState(10, 12), { capped: true, full: true, left: 0 })
})
t('capState: ปัดเศษและรับค่าเป็นข้อความได้', () => {
  assert.deepEqual(capState('5', 2), { capped: true, full: false, left: 3 })
  assert.deepEqual(capState(-3, 2), { capped: false, full: false, left: Infinity })
})

t('capFullMsg: ข้อความบอกจำนวนที่ครบ', () => {
  assert.match(capFullMsg(8), /ครบ 8 ออเดอร์/)
})

if (fail) { console.log(`\n${fail} ข้อล้มเหลว`); process.exit(1) }
console.log('\nผ่านทั้งหมด')
