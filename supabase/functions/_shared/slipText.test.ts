// ทดสอบตัวแยกค่าจากข้อความ OCR · ชื่อในตัวอย่างเป็นข้อความสมมติ (ไม่ใช่ข้อมูลจริง)
import { assertEquals } from 'jsr:@std/assert@1'
import { parseAmount, parseThaiDateTime, parseSlipText } from './slipText.ts'

const SLIP_OK = 'รหัสอ้างอิง A7cb57\nไปยัง\nผู้รับตัวอย่าง\nพร้อมเพย์\nXXX XXX 3402\nจำนวนเงิน 1.00 บาท\nค่าธรรมเนียม 0.00 บาท\nวันที่ทํารายการ 13 พ.ย. 2569 - 01:28'
const SLIP_BE2 = 'ทำรายการสำเร็จ\n12 พ.ย. 69 11:52\nจำนวนเงิน 24 un\nค่าธรรมเนียม 0 บาท'
const SLIP_BROKEN_DATE = 'จำนวนเงิน 40 unn\nll พ.ย. 69 15:49'

Deno.test('ยอดเงิน: อ่านจากบรรทัดจำนวนเงิน ไม่เอาค่าธรรมเนียม', () => {
  assertEquals(parseAmount(SLIP_OK), 1)
  assertEquals(parseAmount(SLIP_BE2), 24)
  assertEquals(parseAmount('จำนวนเงิน 1,250.50 บาท'), 1250.5)
  assertEquals(parseAmount('ค่าธรรมเนียม 0 บาท'), null)
})

Deno.test('วัน-เวลา: ปี พ.ศ. 4 หลักและ 2 หลัก แปลงเป็นค.ศ. ได้ถูกต้อง', () => {
  assertEquals(parseThaiDateTime('13 พ.ย. 2569 - 01:28'), '2026-11-13T01:28')
  assertEquals(parseThaiDateTime('12 พ.ย. 69 11:52'), '2026-11-12T11:52')
})

Deno.test('วัน-เวลา: เดือนหรือวันที่อ่านไม่ได้ → null (ให้พนักงานตรวจ)', () => {
  assertEquals(parseThaiDateTime('ll w.g. 69 20:24'), null)
  assertEquals(parseThaiDateTime('ll พ.ย. 69 15:49'), null)
  assertEquals(parseThaiDateTime('31 ก.พ. 2569 10:00'), null)
})

Deno.test('ผู้รับ: ชื่อและเลขบัญชีจากบรรทัดหลัง "ไปยัง"', () => {
  const r = parseSlipText(SLIP_OK)
  assertEquals(r.receiverName, 'ผู้รับตัวอย่าง')
  assertEquals(r.receiverAccount, 'XXX XXX 3402')
})

Deno.test('ผลรวม: ฟิลด์ที่อ่านไม่ได้ถูกระบุใน review และชื่อ/เลขบัญชีต้องตรวจเสมอ', () => {
  assertEquals(parseSlipText(SLIP_BROKEN_DATE).paidAt, null)
  assertEquals(parseSlipText(SLIP_BROKEN_DATE).review.includes('paidAt'), true)
  assertEquals(parseSlipText(SLIP_OK).review, ['receiverName', 'receiverAccount'])
})
