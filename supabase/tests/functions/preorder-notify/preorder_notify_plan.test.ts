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
Deno.test('หน้าต่างส่งแจ้งก่อนวันรับ 09:00–19:59 น. เวลาไทย', () => {
  assertEquals(inPickupReminderWindow(Date.parse('2099-06-01T02:00:00Z')), true) // 09:00
  assertEquals(inPickupReminderWindow(Date.parse('2099-06-01T02:05:00Z')), true) // 09:05 ยังส่งได้ (ลองใหม่เมื่อล้มเหลว)
  assertEquals(inPickupReminderWindow(Date.parse('2099-06-01T11:59:59Z')), true) // 18:59
  assertEquals(inPickupReminderWindow(Date.parse('2099-06-01T12:00:00Z')), true) // 19:00
  assertEquals(inPickupReminderWindow(Date.parse('2099-06-01T12:59:59Z')), true) // 19:59
  assertEquals(inPickupReminderWindow(Date.parse('2099-06-01T13:00:00Z')), false) // 20:00 ปิด
  assertEquals(inPickupReminderWindow(Date.parse('2099-06-01T01:59:00Z')), false) // 08:59 ปิด
  assertEquals(bangkokNow(Date.parse('2099-06-01T02:00:00Z')).hour, 9)
})

import { runWithCap, SEND_CAP_PER_RUN } from '../../../functions/_shared/preorderNotifyPlan.ts'
Deno.test('จำกัดการส่งต่อรอบ: ไม่เกินเพดาน และรายการที่ข้าม (เคยส่งแล้ว) ไม่กินโควตา', async () => {
  assertEquals(SEND_CAP_PER_RUN, 50)
  const ids = Array.from({ length: 80 }, (_, i) => `o${i}`)
  const seen: string[] = []
  const r = await runWithCap(ids, 50, async (id) => { seen.push(id); return 'sent' })
  assertEquals(r.attempts, 50)
  assertEquals(r.sent, 50)
  assertEquals(seen.length, 50)
})
Deno.test('รายการที่ล้มเหลวกินโควตา และรายการที่ข้ามไม่กินโควตา', async () => {
  const ids = [...Array.from({ length: 10 }, (_, i) => `s${i}`), ...Array.from({ length: 60 }, (_, i) => `f${i}`)]
  const r = await runWithCap(ids, 50, async (id) => (id.startsWith('s') ? 'skipped' : 'failed'))
  assertEquals(r.attempts, 60) // 10 ข้าม + 50 ล้มเหลว
  assertEquals(r.used, 50)
  assertEquals(r.sent, 0)
})
