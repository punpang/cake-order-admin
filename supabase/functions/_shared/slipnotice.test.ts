// ทดสอบการแจ้งลูกค้าทาง Facebook เมื่อส่งสลิป: เปิด/ปิดตามกติกา · ข้อความ · ช่วง 24 ชม.
import { assert, assertEquals } from 'jsr:@std/assert@1'
import { inFbWindow, renderSlipNotice, slipNoticeOn, slipNoticeTemplate, SLIP_RECEIVED_TPL } from './slipnotice.ts'

Deno.test('ไม่มีกติกาที่บันทึก → ส่ง (ค่าเริ่มต้น) · ปิดช่อง Facebook → ไม่ส่ง', () => {
  assertEquals(slipNoticeOn({}), true)
  assertEquals(slipNoticeOn({ integrations: { facebook: { enabled: false } } }), false)
})

Deno.test('กติกา slip_received: ปิดอยู่หรือไม่รวม Facebook → ไม่ส่ง · เปิดและรวม Facebook → ส่ง', () => {
  assertEquals(slipNoticeOn({ notifyRules: [{ event: 'slip_received', channels: ['facebook'], enabled: false }] }), false)
  assertEquals(slipNoticeOn({ notifyRules: [{ event: 'slip_received', channels: ['line', 'sms'], enabled: true }] }), false)
  assertEquals(slipNoticeOn({ notifyRules: [{ event: 'slip_received', channels: ['facebook'], enabled: true }] }), true)
})

Deno.test('ข้อความ: ใช้เทมเพลตของร้านถ้ามี ไม่มีใช้ค่าเริ่มต้น และแทนตัวแปรครบ', () => {
  assertEquals(slipNoticeTemplate({}), SLIP_RECEIVED_TPL)
  assertEquals(slipNoticeTemplate({ notifyRules: [{ event: 'slip_received', template: 'รับแล้ว {เลขออร์เดอร์}' }] }), 'รับแล้ว {เลขออร์เดอร์}')
  const text = renderSlipNotice(SLIP_RECEIVED_TPL, { code: 'OR-121126-000741', amount: 250 })
  assert(text.includes('ออร์เดอร์ OR-121126-000741 ยอด 250.00 บาท'))
  assertEquals(text.includes('{'), false)
  assertEquals(renderSlipNotice('ชื่อ {ชื่อลูกค้า} รวม {ยอดที่แจ้ง}', { code: 'X', amount: 99.5, name: 'สมชาย' }), 'ชื่อ สมชาย รวม 99.50')
})

Deno.test('ช่วง 24 ชม. หลังลูกค้าทักล่าสุด', () => {
  const now = Date.parse('2026-11-14T05:00:00Z')
  assertEquals(inFbWindow('2026-11-13T05:25:40Z', now), true)
  assertEquals(inFbWindow('2026-11-13T04:59:00Z', now), false)
  assertEquals(inFbWindow(null, now), false)
  assertEquals(inFbWindow('', now), false)
})
