// ทดสอบตัวแยกค่าจากข้อความ OCR · ชื่อในตัวอย่างเป็นข้อความสมมติ (ไม่ใช่ข้อมูลจริง)
import { assertEquals } from 'jsr:@std/assert@1'
import { parseAmount, parseThaiDateTime, parseSlipText } from './slipText.ts'

const SLIP_OK = 'รหัสอ้างอิง A7cb57\nไปยัง\nผู้รับตัวอย่าง\nพร้อมเพย์\nXXX XXX 3402\nจำนวนเงิน 1.00 บาท\nค่าธรรมเนียม 0.00 บาท\nวันที่ทํารายการ 13 พ.ย. 2569 - 01:28'
const SLIP_BE2 = 'ทำรายการสำเร็จ\n12 พ.ย. 69 11:52\nจำนวนเงิน 24 un\nค่าธรรมเนียม 0 บาท'
const SLIP_BROKEN_DATE = 'จำนวนเงิน 40 unn\nw.g. พ.ย. 69 15:49'

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
  assertEquals(parseThaiDateTime('ll พ.ย. 69 15:49'), '2026-11-11T15:49') // l = 1 (OCR)
  assertEquals(parseThaiDateTime('ll พ.ย. 69 15:49x'), '2026-11-11T15:49')
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

// ---------- แบบไม่มีคำว่า "ไปยัง" (เป๋าตัง) · อ่านหลายรอบแล้วโหวต · เทียบชื่อกับชื่อบัญชีที่รู้ ----------
import { parseReceiver, mergeSlipTexts, matchKnownName, inferThaiDateTime } from './slipText.ts'

const PT_PP = 'ทํารายการสําเร็จ\n11 พ.ย. 69 15:49\nผู้โอนตัวอย่าง A***\nบัญชีกรุงไทย: *** * **123 4\nง/\n  น.ส. ผู้รับตัวอย่าง นามสมมติ\nPay\nเลขพร้อมเพย์: *** ******** 1234\nจํานวนเงิน 40 บาท\nค่าธรรมเนียม 0 บาท'
const PT_SHOP = 'ทํารายการสําเร็จ\n12 พ.ุย. 69 11:52\nผู้โอนตัวอย่าง A***\nบัญชีกรุงไทย: *** * **123 4\nNV\nSAMPLE SHOP NAME\n- รหัสร้านค้า: :8000001234567\nรหัสธุรกรรม: KPSO04KBO0O0001234567\nจํานวนเงิน 24 un\nค่าธรรมเนียม 0 บาท'

Deno.test('ผู้รับแบบเป๋าตัง (พร้อมเพย์): ชื่อและเลขปิดบางหลักของผู้รับ ไม่ใช่ของผู้โอน', () => {
  assertEquals(parseReceiver(PT_PP), { name: 'น.ส. ผู้รับตัวอย่าง นามสมมติ', account: '*** ******** 1234' })
})

Deno.test('ผู้รับแบบร้านค้า: เลข = KB + 12 หลักท้ายของรหัสธุรกรรม แม้ OCR อ่าน 0 เป็น O', () => {
  assertEquals(parseReceiver(PT_SHOP), { name: 'SAMPLE SHOP NAME', account: 'KB000001234567' })
})

Deno.test('วัน-เวลา: สระลอยหลังจุดในชื่อเดือน ("พ.ุย.") ยังอ่านได้', () => {
  assertEquals(parseThaiDateTime('12 พ.ุย. 69 11:52'), '2026-11-12T11:52')
})

Deno.test('วัน-เวลา: เดือนอ่านไม่ออก → คาดการณ์เดือนล่าสุดที่ไม่เกินตอนนี้', () => {
  const now = Date.UTC(2026, 10, 12, 12, 0) // 12-11-2026 19:00 เวลาไทย
  assertEquals(inferThaiDateTime('ทํารายการ\n11 we. 69 15:49', now), '2026-11-11T15:49')
  assertEquals(inferThaiDateTime('ทํารายการ\n25 we. 69 15:49', now), '2026-10-25T15:49') // 25 พ.ย. ยังไม่ถึง → เดือนก่อน
  assertEquals(inferThaiDateTime('ไม่มีวันที่', now), null)
})

Deno.test('รวมผลหลายรอบ: ค่าที่ตรงกันมากสุดชนะ และฟิลด์ที่ไม่มีเสียงยืนยันอยู่ใน review', () => {
  const bad = PT_PP.replace('1234\nจํานวน', '1204\nจํานวน').replace('11 พ.ย.', '11 we.')
  const r = mergeSlipTexts([bad, PT_PP, PT_PP], Date.UTC(2026, 10, 12, 12, 0))
  assertEquals([r.amount, r.paidAt, r.receiverAccount], [40, '2026-11-11T15:49', '*** ******** 1234'])
  assertEquals(r.review, [])
  const one = mergeSlipTexts([bad], Date.UTC(2026, 10, 12, 12, 0))
  assertEquals(one.paidAt, '2026-11-11T15:49') // คาดการณ์เดือน
  assertEquals(one.review.includes('paidAt'), true)
})

Deno.test('เทียบชื่อกับชื่อบัญชีที่รู้: ผิด 1–2 ตัวอักษรยังจับคู่ได้ · ชื่ออื่นไม่จับคู่', () => {
  const known = ['นางสาว ผู้รับตัวอย่าง นามสมมติ', 'SAMPLE SHOP NAME']
  assertEquals(matchKnownName('นางสาว ผู้รับตัวอยาง นามสมมดิ', known), known[0])
  assertEquals(matchKnownName('คนอื่น ไม่เกี่ยวข้อง', known), null)
  assertEquals(matchKnownName(null, known), null)
})

Deno.test('ยอดเงิน: แอป K PLUS (ตัวเลขตามด้วยบาท ก่อนบรรทัดค่าธรรมเนียม) และ Kept (จำนวน 270.00 บาท)', () => {
  assertEquals(parseAmount('จำนวน:\n650.00 บาท\nค่าธรรมเนียม:\n0.00 บาท'), 650)
  assertEquals(parseAmount('จำนวน 270.00 บาท\nค่าธรรมเนียม 0.00 บาท'), 270)
  assertEquals(parseAmount('ค่าธรรมเนียม 0.00 บาท'), null)
})

Deno.test('ผู้รับ: เลขบัญชีปิดบางหลักแบบ "xxx-x-x6111-x" ถูกจับเป็นเลขของผู้โอน (ไม่ใช่ผู้รับ)', () => {
  const r = parseReceiver('น.ส. ผู้โอนตัวอย่าง\nxxx-x-x6111-x\nนางสาว ผู้รับตัวอย่าง นามสมมติ\nxxx-x-x8154-x\nจำนวน 650.00 บาท')
  assertEquals(r.account, 'xxx-x-x8154-x')
})

Deno.test('ผู้รับ: หลัง "ไปยัง" เลือกบรรทัดชื่อที่ยาวสุด ไม่ใช่ชื่อธนาคารสั้น ๆ', () => {
  const r = parseReceiver('ไปยัง\nSCB\nTITIPAT SRISU\n4XX-1-XXX54-9\nจำนวน 270.00 บาท')
  assertEquals(r.name, 'TITIPAT SRISU')
})

Deno.test('ผู้รับ: ชื่อในบรรทัดเดียวกับคำว่า "ไปยัง" และเลขที่ OCR อ่าน x เป็น %', () => {
  const r = parseReceiver('ไปยัง          @   TITIPAT SRISU\nSCB\n4XX-1-XXX54-9')
  assertEquals(r.name, 'TITIPAT SRISU')
  const m = parseReceiver('%%%-%-%6111-%\nนางสาว ผู้รับตัวอย่าง นามสมมติ\n%%%-%-%8154-%\n620.00 บาท')
  assertEquals(m.account, '%%%-%-%8154-%')
})
