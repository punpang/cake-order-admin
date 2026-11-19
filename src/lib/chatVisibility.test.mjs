import test from 'node:test'
import assert from 'node:assert/strict'
import { isHidden, isManuallyHidden, isAutoHidden, awaitingReply, openOrdersByCustomer, orderBadgeOf, chatLastAt } from './chatVisibility.js'

const H = 3600e3
const T0 = Date.parse('2026-11-19T10:00:00Z')
const at = (ms) => new Date(ms).toISOString()
const chat = (over = {}) => ({ id: 'c1', messages: [{ from: 'staff', at: at(T0 - 30 * H) }], unreadStaff: 0, lastInboundAt: at(T0 - 31 * H), updatedAt: at(T0 - 30 * H), ...over })

test('ซ่อนด้วยมือ แล้วลูกค้าทักมาใหม่ → กลับมาแสดง', () => {
  const c = chat({ hiddenAt: at(T0 - 5 * H) })
  assert.equal(isManuallyHidden(c), true)
  c.lastInboundAt = at(T0 - 1 * H)
  assert.equal(isManuallyHidden(c), false)
})

test('ซ่อนอัตโนมัติ: เกินเวลาที่ตั้ง ไม่มีค้างอ่าน ไม่มีออร์เดอร์ค้าง', () => {
  assert.equal(isAutoHidden(chat(), { hours: 24, now: T0 }), true)
  assert.equal(isAutoHidden(chat(), { hours: 0, now: T0 }), false) // 0 = ปิดฟีเจอร์
  assert.equal(isAutoHidden(chat({ unreadStaff: 2 }), { hours: 24, now: T0 }), false)
  assert.equal(isAutoHidden(chat(), { hours: 24, now: T0, openCount: 1 }), false)
})

test('ไม่ซ่อนถ้ายังไม่ถึงเวลา และนับจากข้อความล่าสุดของทั้งสองฝั่ง', () => {
  const c = chat({ messages: [{ from: 'staff', at: at(T0 - 30 * H) }, { from: 'customer', at: at(T0 - 2 * H) }] })
  assert.equal(chatLastAt(c), T0 - 2 * H)
  assert.equal(isAutoHidden(c, { hours: 24, now: T0 }), false)
})

test('แสดงกลับเอง (showAt) ไม่ซ่อนซ้ำ จนกว่าจะมีข้อความใหม่', () => {
  const c = chat({ showAt: at(T0 - 1 * H) })
  assert.equal(isAutoHidden(c, { hours: 24, now: T0 + 30 * H }), false)
})

test('isHidden รวมทั้งสองแบบ', () => {
  assert.equal(isHidden(chat(), { hours: 24, now: T0 }), true)
  assert.equal(isHidden(chat({ hiddenAt: at(T0) }), { hours: 0, now: T0 }), true)
})

test('รอตอบ: ข้อความล่าสุดเป็นของลูกค้าและเกิน N ชม.', () => {
  const c = chat({ messages: [{ from: 'customer', at: at(T0 - 2 * H) }] })
  assert.equal(awaitingReply(c, T0, 1), true)
  assert.equal(awaitingReply(c, T0, 3), false)
  assert.equal(awaitingReply(chat({ messages: [{ from: 'staff', at: at(T0 - 2 * H) }] }), T0, 1), false)
})

test('ออร์เดอร์ค้าง: จัดกลุ่ม ตัด POS/ปิดแล้ว และเลือกออร์เดอร์ล่าสุด', () => {
  const orders = [
    { id: 'a', customerId: 'k1', status: 'preparing', createdAt: at(T0 - 3 * H) },
    { id: 'b', customerId: 'k1', status: 'awaiting_payment', createdAt: at(T0 - 1 * H) },
    { id: 'c', customerId: 'k1', status: 'delivered', createdAt: at(T0) },
    { id: 'd', customerId: 'k1', status: 'draft', channel: 'pos', createdAt: at(T0) },
  ]
  const map = openOrdersByCustomer(orders)
  assert.equal(map.get('k1').length, 2)
  assert.deepEqual(orderBadgeOf(map.get('k1')), { status: 'awaiting_payment', more: 1 })
  assert.equal(orderBadgeOf(undefined), null)
})
