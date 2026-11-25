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
