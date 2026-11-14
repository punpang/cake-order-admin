// ทดสอบส่วนที่เป็นฟังก์ชันล้วนของแชทลูกค้า: ตรวจความยาวข้อความ และข้อความที่ลูกค้าเห็นไม่มีข้อมูลภายใน
import { assertEquals } from 'jsr:@std/assert@1'
import { CHAT_TEXT_MAX, cleanChatText, toCustomerView } from './customerchat.ts'

Deno.test('ข้อความว่างหรือเกินความยาวไม่ผ่าน · ตัดช่องว่างหัวท้ายแล้วผ่าน', () => {
  assertEquals(cleanChatText(''), null)
  assertEquals(cleanChatText('   \n '), null)
  assertEquals(cleanChatText('a'.repeat(CHAT_TEXT_MAX + 1)), null)
  assertEquals(cleanChatText('  สวัสดีค่ะ  '), 'สวัสดีค่ะ')
  assertEquals(cleanChatText('บรรทัด 1\r\nบรรทัด 2'), 'บรรทัด 1\nบรรทัด 2')
})

Deno.test('ข้อความที่ลูกค้าเห็นมีเฉพาะ id ผู้ส่ง ข้อความ และเวลา', () => {
  const v = toCustomerView({ id: 'cm1', from: 'staff', text: 'รับทราบค่ะ', at: '2026-11-14T10:00:00.000Z', by: 'owner', orderId: 'o1', delivery: 'simulated' })
  assertEquals(v, { id: 'cm1', from: 'staff', text: 'รับทราบค่ะ', at: '2026-11-14T10:00:00.000Z' })
})
