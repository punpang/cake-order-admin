// ทดสอบการเลือกข้อความของพนักงานที่จะแจ้งลูกค้า: ต้องเป็นข้อความท้ายสุดของพนักงาน และเพิ่งส่ง
import { assertEquals } from 'jsr:@std/assert@1'
import { CHAT_PUSH_MAX_AGE_MS, staffReplyOf } from './chatpush.ts'

const NOW = Date.parse('2026-11-14T10:00:00Z')
// ms = กี่มิลลิวินาทีก่อนเวลาปัจจุบัน (ค่าลบ = อนาคต)
const at = (ms: number) => new Date(NOW - ms).toISOString()
const m = (from: string, ms: number, id = 'm1') => ({ id, from, text: 'x', at: at(ms) })

Deno.test('ข้อความท้ายสุดเป็นของพนักงานและเพิ่งส่ง → แจ้ง', () => {
  assertEquals(staffReplyOf([m('customer', 5 * 60e3, 'a'), m('staff', 30e3, 'b')], NOW), { id: 'b', at: at(30e3) })
})

Deno.test('ท้ายสุดเป็นของลูกค้า / ไม่มีข้อความ / ไม่ใช่อาร์เรย์ → ไม่แจ้ง', () => {
  assertEquals(staffReplyOf([m('staff', 30e3, 'b'), m('customer', 10e3, 'c')], NOW), null)
  assertEquals(staffReplyOf([], NOW), null)
  assertEquals(staffReplyOf(undefined, NOW), null)
  assertEquals(staffReplyOf('ไม่ใช่อาร์เรย์', NOW), null)
})

Deno.test('ข้อความเก่าเกินกำหนด หรือเวลาไม่ถูกต้อง → ไม่แจ้ง', () => {
  assertEquals(staffReplyOf([m('staff', CHAT_PUSH_MAX_AGE_MS + 1000)], NOW), null)
  assertEquals(staffReplyOf([{ id: 'x', from: 'staff', text: 'x', at: 'ไม่ใช่วันที่' }], NOW), null)
})

Deno.test('เวลาในอนาคตเกินค่าคลาดเคลื่อนของนาฬิกา → ไม่แจ้ง · คลาดเคลื่อนเล็กน้อยยังแจ้ง', () => {
  assertEquals(staffReplyOf([m('staff', -5 * 60e3)], NOW), null)
  assertEquals(staffReplyOf([m('staff', -20e3, 'ok')], NOW)?.id, 'ok')
})
