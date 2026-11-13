// ทดสอบ publicPaymentOf: ส่งเฉพาะบัญชีที่เปิดแสดง · เฉพาะฟิลด์ที่ใช้แสดง · รูปแบบเดิมแปลงเป็นรายการ
import { assertEquals } from 'jsr:@std/assert@1'
import { publicPaymentOf } from './shoppay.ts'

Deno.test('ส่งเฉพาะบัญชีที่เปิดแสดง และเฉพาะฟิลด์ที่ใช้แสดง', () => {
  const out = publicPaymentOf({
    name: 'ร้าน', taxId: '1234567890123', vat: { legalName: 'ห้ามส่ง' },
    payment: {
      note: 'โอนแล้วแนบสลิปด้วยนะคะ',
      accounts: [
        { id: 'pp1', kind: 'promptpay', show: true, promptpayId: '0918853402', accountName: 'ฐิติภัทร ศรีสุข', internal: 'ห้ามส่ง' },
        { id: 'b1', kind: 'bank', show: false, bankCode: '014', bankName: 'ธนาคารไทยพาณิชย์', accountNo: '4191081549', accountName: 'ซ่อนอยู่' },
        { id: 'b2', kind: 'bank', show: true, bankCode: '014', bankName: 'ธนาคารไทยพาณิชย์', accountNo: '4191-081549', accountName: 'ฐิติภัทร ศรีสุข' },
      ],
    },
  })
  assertEquals(out, {
    note: 'โอนแล้วแนบสลิปด้วยนะคะ',
    accounts: [
      { id: 'pp1', kind: 'promptpay', promptpayId: '0918853402', accountName: 'ฐิติภัทร ศรีสุข' },
      { id: 'b2', kind: 'bank', bankCode: '014', bankName: 'ธนาคารไทยพาณิชย์', accountNo: '4191081549', accountName: 'ฐิติภัทร ศรีสุข' },
    ],
  })
})

Deno.test('รูปแบบเดิมและค่าว่าง', () => {
  assertEquals(publicPaymentOf(undefined), { note: '', accounts: [] })
  assertEquals(publicPaymentOf({}), { note: '', accounts: [] })
  const legacy = publicPaymentOf({ payment: { promptpayId: '0918853402', accountName: 'ก' } })
  assertEquals(legacy.accounts.map((a) => a.kind), ['promptpay'])
  assertEquals(publicPaymentOf({ payment: { accounts: [{ id: 'x', kind: 'bank', show: true, accountNo: '' }] } }).accounts, [])
})
