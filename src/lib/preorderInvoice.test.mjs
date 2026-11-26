// ทดสอบกติกาออกใบกำกับภาษีของสั่งล่วงหน้า (src/lib/preorderInvoice.js) · รัน: node src/lib/preorderInvoice.test.mjs
import assert from 'node:assert/strict'
import { preorderInvoiceBlock, activeInvoiceOf } from './preorderInvoice.js'

let fail = 0
const t = (name, fn) => { try { fn(); console.log(`PASS ${name}`) } catch (e) { fail++; console.log(`FAIL ${name}: ${e.message}`) } }

// เลข 13 หลักที่ผ่าน checksum (ตัวท้ายคำนวณจาก 12 หลักแรก)
const withCheck = (base12) => { let s = 0; for (let i = 0; i < 12; i++) s += Number(base12[i]) * (13 - i); return base12 + String((11 - (s % 11)) % 10) }
const TAX_BUYER = withCheck('010553700001')
const TAX_SHOP = withCheck('010556700123')
const SELLER = { enabled: true, taxId: TAX_SHOP, legalName: 'บริษัท เค้กตัวอย่าง จำกัด', address: '88/12 ถนนสุขุมวิท 39', branch: '00000', rate: 7, mode: 'inclusive' }
const BUYER = { name: 'บริษัท ทดสอบ จำกัด', taxId: TAX_BUYER, branch: '00000', address: '1 ถนนทดสอบ' }

// สั่งล่วงหน้าที่ส่งมอบแล้ว ชำระครบ มี VAT 7% รวมในราคา (1070 รวม VAT)
const delivered = (over = {}) => ({
  id: 'pre1', code: 'PRE-0001', status: 'delivered', fulfillment: 'pickup',
  items: [{ name: 'เค้ก', unitPrice: 1070, qty: 1 }],
  vat: { rate: 7, mode: 'inclusive' },
  payments: [{ status: 'confirmed', amount: 1070 }],
  ...over,
})

t('ส่งมอบแล้ว ชำระครบ ข้อมูลครบ → ออกได้ (คืนค่าว่าง)', () => {
  assert.equal(preorderInvoiceBlock(delivered(), [], BUYER, SELLER), '')
})

t('ยังไม่ส่งมอบ → ปฏิเสธ', () => {
  assert.match(preorderInvoiceBlock(delivered({ status: 'paid' }), [], BUYER, SELLER), /ส่งมอบแล้ว/)
})

t('ชำระยังไม่ครบ → ปฏิเสธ', () => {
  assert.match(preorderInvoiceBlock(delivered({ payments: [{ status: 'confirmed', amount: 500 }] }), [], BUYER, SELLER), /ชำระยังไม่ครบ/)
})

t('ไม่มี VAT → ปฏิเสธ', () => {
  assert.match(preorderInvoiceBlock(delivered({ vat: null }), [], BUYER, SELLER), /ไม่ได้คิดภาษี/)
})

t('มีใบที่ยังไม่ถูกยกเลิกแล้ว → ปฏิเสธ (ออกซ้ำไม่ได้)', () => {
  const inv = [{ id: 'ti1', type: 'invoice', no: 'INV-1' }]
  assert.match(preorderInvoiceBlock(delivered(), inv, BUYER, SELLER), /ออกใบกำกับภาษีของออร์เดอร์นี้แล้ว/)
})

t('ใบที่ถูกยกเลิกแล้วไม่นับ → ออกใหม่ได้', () => {
  const inv = [{ id: 'ti1', type: 'invoice', no: 'INV-1', voidedBy: 'staff:x' }]
  assert.equal(preorderInvoiceBlock(delivered(), inv, BUYER, SELLER), '')
  assert.equal(activeInvoiceOf(inv), null)
})

t('ร้านยังไม่พร้อม (ไม่เปิด VAT) → ปฏิเสธ', () => {
  assert.match(preorderInvoiceBlock(delivered(), [], BUYER, { ...SELLER, enabled: false }), /ยังไม่เปิดใช้ VAT/)
})

t('ข้อมูลผู้ซื้อไม่ถูกต้อง → ปฏิเสธ', () => {
  assert.match(preorderInvoiceBlock(delivered(), [], { ...BUYER, taxId: '123' }, SELLER), /เลขประจำตัวผู้เสียภาษีผู้ซื้อ/)
})

t('ไม่มีออร์เดอร์ → ปฏิเสธ', () => {
  assert.match(preorderInvoiceBlock(null, [], BUYER, SELLER), /ไม่พบออร์เดอร์/)
})

if (fail) { console.log(`\n${fail} รายการล้มเหลว`); process.exit(1) }
console.log('\nผ่านทั้งหมด')
