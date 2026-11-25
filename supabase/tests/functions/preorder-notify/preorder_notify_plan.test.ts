// ทดสอบการคัดรายการเตือนและหมดเวลาของการแจ้งเตือนสั่งล่วงหน้า (ฟังก์ชันล้วน) · รันพร้อมชุด preorder-notify
import { assertEquals } from 'jsr:@std/assert@1'
import { planReminders, planExpired } from '../../../functions/_shared/preorderNotifyPlan.ts'

const now = Date.parse('2099-06-01T10:00:00Z')
const at = (ms: number) => new Date(ms).toISOString()
const O = (id: string, status: string, payDueAt: string | null, total = 100, paid = 0) => ({ id, status, payDueAt, total, paid })

Deno.test('เตือนเฉพาะออเดอร์รอชำระที่ยังค้างและกำหนดภายใน 1 ชม.', () => {
  const list = [
    O('soon', 'awaiting_payment', at(now + 30 * 60e3)),
    O('later', 'awaiting_payment', at(now + 2 * 3600e3)),
    O('paid', 'awaiting_payment', at(now + 30 * 60e3), 100, 100),
    O('passed', 'awaiting_payment', at(now - 60e3)),
    O('shipped', 'payment_confirmed', at(now + 30 * 60e3)),
    O('nodue', 'awaiting_payment', null),
  ]
  assertEquals(planReminders(list, now), ['soon'])
})

Deno.test('เตือนที่ขอบ 1 ชม. พอดีถูกนับ และที่เลยเวลาไม่นับ', () => {
  assertEquals(planReminders([O('edge', 'awaiting_payment', at(now + 3600e3))], now), ['edge'])
  assertEquals(planReminders([O('now', 'awaiting_payment', at(now))], now), [])
})

Deno.test('แจ้งหมดเวลาเฉพาะออเดอร์ที่หมดแล้วภายใน 24 ชม.', () => {
  const list = [
    O('recent', 'expired', at(now - 3600e3)),
    O('old', 'expired', at(now - 48 * 3600e3)),
    O('future', 'expired', at(now + 3600e3)),
    O('waiting', 'awaiting_payment', at(now - 3600e3)),
  ]
  assertEquals(planExpired(list, now), ['recent'])
})

Deno.test('ไม่มี payDueAt หรือวันที่เสีย ไม่ถูกเลือก', () => {
  assertEquals(planExpired([O('bad', 'expired', 'ไม่ใช่วันที่')], now), [])
  assertEquals(planReminders([O('bad', 'awaiting_payment', 'ไม่ใช่วันที่')], now), [])
})

import { planPickupReminders, inPickupReminderWindow, bangkokNow } from '../../../functions/_shared/preorderNotifyPlan.ts'
Deno.test('แจ้งก่อนวันรับ: เฉพาะรับที่ร้านที่ค้างยอดและรับพรุ่งนี้ (เวลาไทย)', () => {
  const nowMs = Date.parse('2099-06-01T02:00:00Z') // 09:00 ไทย วันที่ 1 มิ.ย.
  const list = [
    { id: 'tomorrow', status: 'payment_confirmed', total: 100, paid: 50, fulfillment: 'pickup', pickupDate: '2099-06-02' },
    { id: 'paid', status: 'payment_confirmed', total: 100, paid: 100, fulfillment: 'pickup', pickupDate: '2099-06-02' },
    { id: 'delivery', status: 'payment_confirmed', total: 100, paid: 50, fulfillment: 'delivery', pickupDate: '2099-06-02' },
    { id: 'today', status: 'payment_confirmed', total: 100, paid: 50, fulfillment: 'pickup', pickupDate: '2099-06-01' },
    { id: 'cancelled', status: 'cancelled', total: 100, paid: 50, fulfillment: 'pickup', pickupDate: '2099-06-02' },
  ]
  assertEquals(planPickupReminders(list, nowMs), ['tomorrow'])
})
Deno.test('หน้าต่างส่ง 09:00–09:04 น. เวลาไทยเท่านั้น', () => {
  assertEquals(inPickupReminderWindow(Date.parse('2099-06-01T02:00:00Z')), true)
  assertEquals(inPickupReminderWindow(Date.parse('2099-06-01T02:04:59Z')), true)
  assertEquals(inPickupReminderWindow(Date.parse('2099-06-01T02:05:00Z')), false)
  assertEquals(inPickupReminderWindow(Date.parse('2099-06-01T01:59:00Z')), false)
  assertEquals(bangkokNow(Date.parse('2099-06-01T02:00:00Z')).hour, 9)
})
