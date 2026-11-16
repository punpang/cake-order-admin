// ทดสอบกติกาโหมดทดสอบ (ฟังก์ชันล้วน) · รัน: deno test supabase/functions/_shared/
import { assertEquals, assertNotEquals } from 'jsr:@std/assert@1'
import { cleanRecipients, modeOf, recipientAllowed, refuseInTest, restProfileHeaders, schemaOf } from './mode.ts'

const reqWith = (mode?: string) => new Request('https://x.test/fn', { headers: mode === undefined ? {} : { 'x-punpang-mode': mode } })

Deno.test('โหมด: ไม่มีหัว หรือค่าอื่นที่ไม่ใช่ test = โหมดจริง (ค่าเริ่มต้นปลอดภัย)', () => {
  assertEquals(modeOf(reqWith()), 'live')
  assertEquals(modeOf(reqWith('live')), 'live')
  assertEquals(modeOf(reqWith('TEST')), 'live') // ต้องตรงตัวพิมพ์เล็ก
  assertEquals(modeOf(reqWith('')), 'live')
  assertEquals(modeOf(reqWith('test')), 'test')
})

Deno.test('สคีมา: โหมดจริงใช้ public โหมดทดสอบใช้ punpang_test', () => {
  assertEquals(schemaOf('live'), 'public')
  assertEquals(schemaOf('test'), 'punpang_test')
})

Deno.test('หัว REST: โหมดจริงไม่เพิ่มหัว โหมดทดสอบเลือกสคีมาทั้งอ่านและเขียน', () => {
  assertEquals(restProfileHeaders('live'), {})
  assertEquals(restProfileHeaders('test'), { 'Accept-Profile': 'punpang_test', 'Content-Profile': 'punpang_test' })
})

Deno.test('ปฏิเสธในโหมดทดสอบด้วย 409 และข้อความไทย โหมดจริงผ่าน', async () => {
  assertEquals(refuseInTest('live'), null)
  const r = refuseInTest('test')
  assertNotEquals(r, null)
  assertEquals(r!.status, 409)
  assertEquals((await r!.json()).error, 'ทำรายการนี้ไม่ได้ในโหมดทดสอบ')
})

Deno.test('ผู้รับทดสอบ: ตรงช่องทางและหมายเลข (ตัดขีดและช่องว่างของเบอร์) · ช่องทางต่างกันไม่ผ่าน', () => {
  const list = [
    { channel: 'sms', to: '081-234 5678' },
    { channel: 'telegram', to: '123456789' },
    { channel: 'facebook', to: 'PSID-test-1' },
  ]
  assertEquals(recipientAllowed(list, 'sms', '0812345678'), true)
  assertEquals(recipientAllowed(list, 'sms', '081 234-5678'), true)
  assertEquals(recipientAllowed(list, 'sms', '0899999999'), false) // ไม่อยู่ในรายการ
  assertEquals(recipientAllowed(list, 'telegram', '0812345678'), false) // ช่องทางไม่ตรง
  assertEquals(recipientAllowed(list, 'facebook', 'PSID-test-1'), true)
  assertEquals(recipientAllowed(list, 'facebook', 'psid-test-1'), false) // ต้องตรงตัวพิมพ์
})

Deno.test('ผู้รับทดสอบ: รายการว่างหรือรูปแบบผิดไม่อนุญาตทุกกรณี (ปลอดภัยเป็นค่าเริ่มต้น)', () => {
  assertEquals(recipientAllowed(undefined, 'sms', '0812345678'), false)
  assertEquals(recipientAllowed([], 'sms', '0812345678'), false)
  assertEquals(recipientAllowed([{ channel: 'sms', to: '0812345678' }], 'sms', ''), false)
  assertEquals(cleanRecipients([
    { channel: 'sms', to: '0812345678' },
    { channel: 'line', to: 'Ux1' }, // ไม่มีช่องทางนี้แล้ว
    { channel: 'telegram', to: '' }, // ว่าง
    'ผิดรูปแบบ',
  ]), [{ channel: 'sms', to: '0812345678' }])
})
