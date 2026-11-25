// ทดสอบการรับแจ้งเตือนถุงเงิน: ลายเซ็น การดึงรหัสธุรกรรม การตรวจรูปแบบรหัส
import { assertEquals } from 'jsr:@std/assert@1'
import { verifyGatewaySignature, extractTransferRef, isRefShape, extractAmount } from './maneeforward.ts'

const SECRET = 'example-secret-0123456'
const hmacHex = async (secret: string, msg: string) => {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg)))].map((x) => x.toString(16).padStart(2, '0')).join('')
}

Deno.test('ลายเซ็นถูกต้องตามเอกสาร (ตัวอย่าง)', async () => {
  const body = '{"event":"sms.forwarded","id":"9b2f6c1e-4a7d-4e0b-8c52-1f3a7e9d0b11","rule_id":3,"from":"+66812345678","body":"รหัส OTP 1234","received_at":1731230000000}'
  const sig = 'sha256=0d821f723cffa86db75d9a95569067bced57730762f5754a760b5401e8cd2ed6'
  assertEquals(await verifyGatewaySignature(SECRET, '1731230000', body, sig, 1731230000), true)
})

Deno.test('ลายเซ็นผิด / body ถูกแก้ / เวลาเกิน 5 นาที = ไม่ผ่าน', async () => {
  const body = '{"a":1}'
  const good = 'sha256=' + await hmacHex(SECRET, `1731230000.${body}`)
  assertEquals(await verifyGatewaySignature(SECRET, '1731230000', '{"a":2}', good, 1731230000), false)
  assertEquals(await verifyGatewaySignature(SECRET, '1731230000', body, good, 1731230000 + 301), false)
  assertEquals(await verifyGatewaySignature('short', '1731230000', body, good, 1731230000), false)
  assertEquals(await verifyGatewaySignature(SECRET, '1731230000', body, good, 1731230000), true)
})

Deno.test('ดึงรหัสธุรกรรมจากแจ้งเตือนถุงเงิน', () => {
  assertEquals(extractTransferRef('จาก MR.Pansit Sri. รหัสธุรกรรมถุงเงิน ORD12340272826288288'), 'ORD12340272826288288')
  assertEquals(extractTransferRef('จาก MR PANSIT SRI. รหัสธุรกรรมถุงเงิน ORD47567336FDHUFYTRY'), 'ORD47567336FDHUFYTRY')
  assertEquals(extractTransferRef('รหัสธุรกรรมถุงเงิน POS123456789012ABCDE'), 'POS123456789012ABCDE')
  assertEquals(extractTransferRef('คุณได้รับเงิน 1.00 บาท'), null)
  assertEquals(extractTransferRef('ORD123'), null)
  assertEquals(extractTransferRef('xORD12340272826288288'), null)
  assertEquals(extractTransferRef(''), null)
})

Deno.test('ตรวจรูปแบบรหัสที่รับจาก client', () => {
  assertEquals(isRefShape('ORD12340272826288288'), true)
  assertEquals(isRefShape('POS123456789012ABCDE'), true)
  assertEquals(isRefShape('PRE202611240001ABCDE'), true)
  assertEquals(isRefShape('PREabc'), false)
  assertEquals(isRefShape('ord12340272826288288'), false)
  assertEquals(isRefShape('ORD123'), false)
  assertEquals(isRefShape("ORD' OR 1=1--"), false)
})

Deno.test('ดึงยอดเงินเข้าจากหัวข้อ/ข้อความ', () => {
  assertEquals(extractAmount('เงินเข้า 1 บาท', 'จาก MR.Pansit Sri. รหัสธุรกรรมถุงเงิน ORD12340272826288288'), 1)
  assertEquals(extractAmount('เงินเข้า 1,250.50 บาท', ''), 1250.5)
  assertEquals(extractAmount('', 'คุณได้รับเงิน 1.00 บาท จาก X'), 1)
  assertEquals(extractAmount('ถุงเงิน', 'จาก MR.X รหัสธุรกรรมถุงเงิน ORD12340272826288288'), null)
  assertEquals(extractAmount('เงินออก -1.00 บาท', ''), null)
})

Deno.test('รับรหัสสั่งล่วงหน้า PRE จากข้อความแจ้งเตือนได้ และไม่รับรหัสปลอมที่ขึ้นต้นผิด', () => {
  assertEquals(extractTransferRef('รายการ PRE202611240001ABCDE สำเร็จ'), 'PRE202611240001ABCDE')
  assertEquals(extractTransferRef('รายการ PREX202611240001ABCDE สำเร็จ'), null)
})
