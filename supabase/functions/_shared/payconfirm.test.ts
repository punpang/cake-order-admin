// ทดสอบกติกาและข้อความแจ้ง "ยืนยันชำระแล้ว" ตอนระบบยืนยันอัตโนมัติ
import { assertEquals } from 'jsr:@std/assert@1'
import { paidNoticeRule, paidNoticeText, PAY_CONFIRMED_DEFAULT } from './payconfirm.ts'

Deno.test('กติกา: ยังไม่มีกติกา = ใช้ค่าเริ่มต้นเป็นเว็บ/แอป + SMS', () => {
  assertEquals(paidNoticeRule(undefined), { template: PAY_CONFIRMED_DEFAULT, channels: ['web', 'sms'] })
})

Deno.test('กติกาเดิมที่มี Facebook (ยังไม่เป็นรุ่นปัจจุบัน) → เปลี่ยนเป็นเว็บ/แอป', () => {
  assertEquals(paidNoticeRule([{ event: 'payment_confirmed', enabled: true, channels: ['facebook', 'sms'], template: 'จ่ายแล้ว' }]), { template: 'จ่ายแล้ว', channels: ['web', 'sms'] })
})

Deno.test('กติกา: ร้านปิด payment_confirmed → ไม่ส่ง', () => {
  assertEquals(paidNoticeRule([{ event: 'payment_confirmed', enabled: false }]), null)
})

Deno.test('กติกา: ใช้ข้อความและช่องทางที่ร้านตั้งไว้', () => {
  assertEquals(paidNoticeRule([{ event: 'payment_confirmed', enabled: true, channels: ['sms'], template: 'จ่ายแล้ว {เลขออร์เดอร์}' }]), { template: 'จ่ายแล้ว {เลขออร์เดอร์}', channels: ['sms'] })
})

Deno.test('ข้อความ: ใส่ค่าตัวแปร และลบตัวแปรที่ไม่มีค่า', () => {
  const text = paidNoticeText('ได้รับชำระ {ยอดที่ชำระ} ออร์เดอร์ {เลขออร์เดอร์}\nลิงก์: {ลิงก์ออร์เดอร์}', { ยอดที่ชำระ: '540.00', เลขออร์เดอร์: 'ORD111126000010' })
  assertEquals(text, 'ได้รับชำระ 540.00 ออร์เดอร์ ORD111126000010\nลิงก์:')
})
