// ทดสอบการเปิดใบแจ้งรับสลิปทาง LINE (ต้องให้ร้านเปิดเองในกติกา) · รันด้วย npm run test:deno
import { assertEquals } from 'jsr:@std/assert@1'
import { slipNoticeOn, slipNoticeOnFor } from './slipnotice.ts'

const rule = (channels: string[], enabled = true) => ({ notifyRules: [{ event: 'slip_received', enabled, channels }] })

Deno.test('ใบแจ้งรับสลิป LINE: ยังไม่มีกติกา = ไม่ส่ง (ต้องเปิดเอง)', () => {
  assertEquals(slipNoticeOnFor({}, 'line'), false)
})
Deno.test('ใบแจ้งรับสลิป LINE: ส่งเมื่อกติกาเปิดและรวม line', () => {
  assertEquals(slipNoticeOnFor(rule(['line']), 'line'), true)
  assertEquals(slipNoticeOnFor(rule(['facebook']), 'line'), false)
  assertEquals(slipNoticeOnFor(rule(['line'], false), 'line'), false)
  assertEquals(slipNoticeOnFor({ ...rule(['line']), integrations: { line: { enabled: false } } }, 'line'), false)
})
Deno.test('ใบแจ้งรับสลิป Facebook: พฤติกรรมเดิม (ยังไม่มีกติกา = ส่ง)', () => {
  assertEquals(slipNoticeOn({}), true)
  assertEquals(slipNoticeOnFor({}, 'facebook'), true)
  assertEquals(slipNoticeOn(rule(['sms'])), false)
})
