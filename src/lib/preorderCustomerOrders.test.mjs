// ทดสอบการกรองและเรียงออร์เดอร์สั่งล่วงหน้าที่ยังไม่ปิดของลูกค้า · รัน: node src/lib/preorderCustomerOrders.test.mjs
import assert from 'node:assert/strict'
import { openPreorders } from './preorderCustomerOrders.js'

let fail = 0
const t = (name, fn) => { try { fn(); console.log(`PASS ${name}`) } catch (e) { fail++; console.log(`FAIL ${name}: ${e.message}`) } }

const row = (o) => ({ id: 'x', code: 'PRE-1', status: 'awaiting_payment', pickupDate: '2099-12-24', total: 100, paid: 0, payDueAt: '2099-12-01T10:00:00Z', ...o })

t('ไม่รวมออร์เดอร์ที่ยกเลิก หมดเวลา หรือส่งมอบแล้ว', () => {
  const list = openPreorders([
    row({ id: 'a', code: 'A' }),
    row({ id: 'b', code: 'B', status: 'cancelled' }),
    row({ id: 'c', code: 'C', status: 'expired' }),
    row({ id: 'd', code: 'D', status: 'delivered' }),
    row({ id: 'e', code: 'E', status: 'payment_confirmed' }),
  ])
  assert.deepEqual(list.map((x) => x.code), ['A', 'E'])
})

t('คำนวณยอดค้างจากยอดรวมลบยอดที่ชำระ และไม่ติดลบ', () => {
  const [x, y] = openPreorders([row({ id: 'a', code: 'A', total: 100, paid: 30 }), row({ id: 'b', code: 'B', total: 50, paid: 80 })])
  assert.equal(x.due, 70)
  assert.equal(y.due, 0)
})

t('เรียงตามกำหนดชำระ และออร์เดอร์ที่ไม่มีกำหนดไปท้าย', () => {
  const list = openPreorders([
    row({ id: 'a', code: 'A', payDueAt: null }),
    row({ id: 'b', code: 'B', payDueAt: '2099-12-03T10:00:00Z' }),
    row({ id: 'c', code: 'C', payDueAt: '2099-12-02T10:00:00Z' }),
  ])
  assert.deepEqual(list.map((x) => x.code), ['C', 'B', 'A'])
})

t('ส่งเฉพาะฟิลด์ที่ใช้แสดง ไม่ส่งข้อมูลอื่นออกไป', () => {
  const [x] = openPreorders([row({ id: 'a', code: 'A', customerName: 'สมชาย', phone: '0812345678', lines: [] })])
  assert.deepEqual(Object.keys(x).sort(), ['code', 'due', 'id', 'payDueAt', 'pickupDate', 'status'])
})

t('ข้อมูลเสียหรือไม่ใช่รายการ ไม่ทำให้ล้ม', () => {
  assert.deepEqual(openPreorders(null), [])
  assert.deepEqual(openPreorders([null, undefined]), [])
})

if (fail) { console.log(`\n${fail} ล้มเหลว`); process.exit(1) }
console.log('\nผ่านทั้งหมด')
