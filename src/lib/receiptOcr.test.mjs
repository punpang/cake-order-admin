// ทดสอบการอ่านข้อความใบเสร็จ: ยอดรวม VAT วันที่ เลขผู้เสียภาษี ชื่อร้าน เลขใบกำกับ · ค่าที่หาไม่พบต้องเป็น null ไม่ใช่เดา
// รัน: node src/lib/receiptOcr.test.mjs
import assert from 'node:assert/strict'
import { parseReceipt, dateOf, validTaxId } from './receiptOcr.js'

let fail = 0
const t = (name, fn) => { try { fn(); console.log('ok -', name) } catch (e) { fail++; console.log('FAIL -', name, e.message) } }

// เลขผู้เสียภาษี 0105536000011 ผ่าน checksum (ตัวอย่างทดสอบ) · 0105536000012 ไม่ผ่าน
const GOOD_TAX = '0105536000011'
const BAD_TAX = '0105536000012'

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
  assert.equal(parseReceipt(SAMPLE).date, '2026-11-25')
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
  assert.equal(dateOf('31/02/2026'), null)
})
t('วันที่ ค.ศ. ปี 2 หลักแปลงเป็นปี 20xx', () => {
  assert.equal(dateOf('05-03-26'), '2026-03-05')
})
t('validTaxId: ความยาวไม่ใช่ 13 หลักไม่ผ่าน', () => {
  assert.equal(validTaxId('12345'), false)
  assert.equal(validTaxId(GOOD_TAX), true)
})

console.log(fail ? `ล้มเหลว ${fail} รายการ` : 'ผ่านทั้งหมด')
process.exit(fail ? 1 : 0)
