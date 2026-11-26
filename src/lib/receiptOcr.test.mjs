// ทดสอบการอ่านข้อความใบเสร็จ: ยอดรวม VAT วันที่ เลขผู้เสียภาษี ชื่อร้าน เลขใบกำกับ · ค่าที่หาไม่พบต้องเป็น null ไม่ใช่เดา
// รัน: node src/lib/receiptOcr.test.mjs
import assert from 'node:assert/strict'
import { parseReceipt, dateOf, validTaxId, receiptFill } from './receiptOcr.js'

let fail = 0
const t = (name, fn) => { try { fn(); console.log('ok -', name) } catch (e) { fail++; console.log('FAIL -', name, e.message) } }

// เลขผู้เสียภาษี 0105536000011 ผ่าน checksum (ตัวอย่างทดสอบ) · 0105536000012 ไม่ผ่าน
const GOOD_TAX = '0105536000011'
const BAD_TAX = '0105536000012'
// วันที่อ้างอิงคงที่ เพื่อให้เทสต์ไม่เปลี่ยนตามเวลาจริง
const TODAY = new Date('2026-11-26T00:00:00Z')

const SAMPLE = `ร้านกาแฟตัวอย่าง
สาขาสยาม
เลขประจำตัวผู้เสียภาษี 0 1055 36000 011
ใบเสร็จรับเงิน/ใบกำกับภาษี เลขที่ INV-2026-0042
วันที่ 25/11/2569
ลาเต้ 2 แก้ว 120.00
ยอดก่อน VAT 280.37
VAT 7% 19.63
รวมทั้งสิ้น 300.00`

t('อ่านยอดรวมจากบรรทัดรวมทั้งสิ้น', () => {
  assert.equal(parseReceipt(SAMPLE).total, 300)
})
t('อ่าน VAT จากบรรทัด VAT (ไม่ใช่ยอดก่อน VAT)', () => {
  assert.equal(parseReceipt(SAMPLE).vat, 19.63)
})
t('วันที่ พ.ศ. แปลงเป็น ค.ศ. YYYY-MM-DD', () => {
  assert.equal(parseReceipt(SAMPLE, TODAY).date, '2026-11-25')
})
t('เลขผู้เสียภาษีที่มีช่องว่างและผ่าน checksum', () => {
  assert.equal(parseReceipt(SAMPLE).taxId, GOOD_TAX)
})
t('เลขผู้เสียภาษีที่ไม่ผ่าน checksum คืน null', () => {
  assert.equal(parseReceipt(`เลขผู้เสียภาษี ${BAD_TAX}`).taxId, null)
})
t('เลขใบกำกับภาษีจากบรรทัดที่มีคำว่าใบกำกับ', () => {
  assert.equal(parseReceipt(SAMPLE).taxInvoiceNo, 'INV-2026-0042')
})
t('ชื่อร้านคือบรรทัดแรกที่ไม่ใช่หัวข้อเอกสาร', () => {
  assert.equal(parseReceipt(SAMPLE).payee, 'ร้านกาแฟตัวอย่าง')
})
t('ยอดรวมแบบมีจุลภาคคั่นหลัก', () => {
  assert.equal(parseReceipt('รวมเงิน 1,250.50').total, 1250.5)
})
t('ไม่พบค่าใดเลย คืน null ทุกช่อง', () => {
  assert.deepEqual(parseReceipt('ข้อความไม่เกี่ยวข้อง'), { date: null, total: null, vat: null, payee: 'ข้อความไม่เกี่ยวข้อง', taxId: null, taxInvoiceNo: null })
})
t('ข้อความว่างคืน null ทั้งหมด', () => {
  assert.deepEqual(parseReceipt(''), { date: null, total: null, vat: null, payee: null, taxId: null, taxInvoiceNo: null })
})
t('วันที่ไม่ถูกต้อง (วันที่ 31 เดือนกุมภาพันธ์) คืน null', () => {
  assert.equal(dateOf('31/02/2026', TODAY), null)
})
t('วันที่ ค.ศ. ปี 2 หลักแปลงเป็นปี 20xx', () => {
  assert.equal(dateOf('05-03-26', TODAY), '2026-03-05')
})
t('ปี 2 หลักเป็น พ.ศ. (69 = 2569 = 2026) ไม่ใช่ 2069', () => {
  assert.equal(dateOf('08/11/69', TODAY), '2026-11-08')
})
t('ปี 2 หลัก 68 (พ.ศ. 2568 = 2025) อยู่ในช่วงที่ยอมรับ', () => {
  assert.equal(dateOf('08/11/68', TODAY), '2025-11-08')
})
t('ปีนอกช่วง ±2 ปี (เช่น 2612 / 2069) คืน null ไม่เติมปีเพี้ยน', () => {
  assert.equal(dateOf('08/11/2612', TODAY), null)
  assert.equal(dateOf('08/11/2069', TODAY), null)
})
t('บรรทัด VAT Included ที่มีเลขผู้เสียภาษี ไม่ถูกอ่านเป็นยอด VAT', () => {
  assert.equal(parseReceipt('TAX#0107542000011 (VAT Included)', TODAY).vat, null)
})
t('ยอดสุทธิที่ OCR อ่านคำเพี้ยนเป็น ยอดหฐิ ยังได้ยอด 42', () => {
  assert.equal(parseReceipt('ยอดหฐิ 1 ซิน 42.00', TODAY).total, 42)
})
t('ชื่อร้านที่เป็นสัญลักษณ์เพี้ยนจาก OCR ไม่ถูกใช้', () => {
  assert.equal(parseReceipt('. \\ A ง   \'    ง - y  a         ว', TODAY).payee, null)
})
t('TAX# เป็นเลขผู้เสียภาษีที่ผ่าน checksum ได้', () => {
  assert.equal(parseReceipt('TAX#0105536000011 (VAT Included)', TODAY).taxId, GOOD_TAX)
})
t('validTaxId: ความยาวไม่ใช่ 13 หลักไม่ผ่าน', () => {
  assert.equal(validTaxId('12345'), false)
  assert.equal(validTaxId(GOOD_TAX), true)
})

const FULL = { date: '2026-11-25', total: 300, vat: 19.63, payee: 'ร้านกาแฟตัวอย่าง', taxId: GOOD_TAX, taxInvoiceNo: 'INV-2026-0042' }
const BLANK_FORM = { date: '2026-11-26', amount: '', vatMode: 'none', payee: '', taxInvoiceNo: '', payeeTaxId: '' }

t('receiptFill: เติมทุกช่องที่ว่าง และตั้ง VAT รวมแล้วเมื่อ VAT ตรงกับยอด', () => {
  assert.deepEqual(receiptFill(BLANK_FORM, FULL, { vatRate: 7 }), {
    date: '2026-11-25', amount: '300', payee: 'ร้านกาแฟตัวอย่าง', taxInvoiceNo: 'INV-2026-0042', payeeTaxId: GOOD_TAX, vatMode: 'included', vatRate: 7,
  })
})
t('receiptFill: ไม่เขียนทับช่องที่ผู้ใช้กรอกแล้ว', () => {
  const p = receiptFill({ ...BLANK_FORM, amount: '250', payee: 'ร้านเดิม', taxInvoiceNo: 'X-1', payeeTaxId: '1234567890123', vatMode: 'excluded' }, FULL)
  assert.equal(p.amount, undefined)
  assert.equal(p.payee, undefined)
  assert.equal(p.taxInvoiceNo, undefined)
  assert.equal(p.payeeTaxId, undefined)
  assert.equal(p.vatMode, undefined)
})
t('receiptFill: VAT ไม่ตรงกับยอด×อัตรา ไม่ตั้ง vatMode', () => {
  const p = receiptFill(BLANK_FORM, { ...FULL, vat: 50 }, { vatRate: 7 })
  assert.equal(p.vatMode, undefined)
})
t('receiptFill: อ่านอะไรไม่ได้เลย คืน patch ว่าง', () => {
  assert.deepEqual(receiptFill(BLANK_FORM, { date: null, total: null, vat: null, payee: null, taxId: null, taxInvoiceNo: null }), {})
})

console.log(fail ? `ล้มเหลว ${fail} รายการ` : 'ผ่านทั้งหมด')
process.exit(fail ? 1 : 0)
