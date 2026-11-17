// ทดสอบกติกาใบกำกับภาษีฝั่งลูกค้า (ฟังก์ชันล้วน) · รัน: node src/lib/taxInvoice.test.mjs
import assert from 'node:assert/strict'
import { MAX_CUSTOMER_REVISIONS, CUSTOMER_SELLER_MSG, paidDateOf, cleanBuyer, buyerError, sellerCheck, customerInvoiceState, customerIssueBlock, buildInvoice, buildCreditNote } from './taxInvoice.js'

let fail = 0
const t = (name, fn) => { try { fn(); console.log(`PASS ${name}`) } catch (e) { fail++; console.log(`FAIL ${name}: ${e.message}`) } }

// เลข 13 หลักที่ผ่าน checksum (ตัวท้ายคำนวณจาก 12 หลักแรก)
const withCheck = (base12) => { let s = 0; for (let i = 0; i < 12; i++) s += Number(base12[i]) * (13 - i); return base12 + String((11 - (s % 11)) % 10) }
const TAX_BUYER = withCheck('010553700001')
const TAX_SHOP = withCheck('010556700123')
const SHOP_VAT = { enabled: true, taxId: TAX_SHOP, legalName: 'บริษัท เค้กตัวอย่าง จำกัด', address: '88/12 ถนนสุขุมวิท 39', branch: '00000', rate: 7, mode: 'inclusive' }
const BUYER = { name: 'บริษัท ทดสอบ จำกัด', taxId: TAX_BUYER, branch: '00000', address: '1 ถนนทดสอบ' }
// ออร์เดอร์รับเอง 200 บาท (รวม VAT 7%) ชำระครบวันที่ 2026-11-10 → ขอ/แก้ได้ถึง 2026-11-15
const orderOf = (over = {}) => ({
  id: 'o1', code: 'A001', status: 'delivered', fulfillment: 'pickup', customerId: 'c1',
  items: [{ name: 'เค้กช็อก', qty: 2, unitPrice: 100, fullPrice: 100, discounts: [] }],
  vat: { rate: 7, mode: 'inclusive' },
  payments: [{ status: 'confirmed', amount: 200, confirmedAt: '2026-11-10T10:00:00' }],
  ...over,
})

t('วันที่ชำระ = วันที่ยืนยันล่าสุด (ไม่นับรายการที่ยังรอยืนยัน) · ไม่มีการชำระ = ว่าง', () => {
  const o = orderOf({ payments: [
    { status: 'confirmed', amount: 50, confirmedAt: '2026-11-01T09:00:00' },
    { status: 'confirmed', amount: 150, confirmedAt: '2026-11-10T10:00:00' },
    { status: 'reported', amount: 10, paidAt: '2026-11-12T10:00:00' },
  ] })
  assert.equal(paidDateOf(o), '2026-11-10')
  assert.equal(paidDateOf(orderOf({ payments: [] })), '')
})

t('ทำความสะอาดผู้ซื้อ: เหลือเฉพาะตัวเลขที่เลขผู้เสียภาษีและสาขา · สาขาว่าง = 00000 · ตัดช่องว่างหัวท้าย', () => {
  const b = cleanBuyer({ name: '  บริษัท ทดสอบ จำกัด  ', taxId: `${TAX_BUYER[0]}-${TAX_BUYER.slice(1)}`, branch: '', address: ' 1 ถนนทดสอบ ' })
  assert.deepEqual(b, { name: 'บริษัท ทดสอบ จำกัด', taxId: TAX_BUYER, branch: '00000', address: '1 ถนนทดสอบ' })
})

t('ตรวจผู้ซื้อ: ชื่อ เลขผู้เสียภาษี (checksum) สาขา และที่อยู่', () => {
  assert.equal(buyerError(BUYER), '')
  assert.equal(buyerError({ ...BUYER, name: ' ' }), 'ไม่มีชื่อผู้ซื้อ')
  assert.match(buyerError({ ...BUYER, taxId: TAX_BUYER.slice(0, 12) + ((Number(TAX_BUYER[12]) + 1) % 10) }), /เลขประจำตัวผู้เสียภาษีผู้ซื้อ/)
  assert.match(buyerError({ ...BUYER, branch: '0001' }), /สาขา/)
  assert.equal(buyerError({ ...BUYER, address: '' }), 'ไม่มีที่อยู่ผู้ซื้อ')
})

t('ตรวจผู้ขาย: พร้อมเมื่อ VAT เปิด เลขถูกต้อง และมีชื่อ/ที่อยู่ · ไม่มีข้อมูลร้านเลยก็ไม่ผ่าน', () => {
  assert.equal(sellerCheck(SHOP_VAT), '')
  assert.equal(sellerCheck({ ...SHOP_VAT, enabled: false }), 'ร้านยังไม่เปิดใช้ VAT')
  assert.match(sellerCheck({ ...SHOP_VAT, taxId: '' }), /เลขประจำตัวผู้เสียภาษีของร้าน/)
  assert.match(sellerCheck({ ...SHOP_VAT, legalName: '' }), /ชื่อและที่อยู่/)
  assert.match(sellerCheck(undefined), /ไม่เปิดใช้ VAT/)
})

t('สถานะ: ไม่คิด VAT / ยกเลิก / ชำระไม่ครบ → ขอไม่ได้พร้อมเหตุผล', () => {
  assert.equal(customerInvoiceState(orderOf({ vat: null }), [], '2026-11-11').eligible, false)
  assert.equal(customerInvoiceState(orderOf({ status: 'cancelled' }), [], '2026-11-11').eligible, false)
  const unpaid = customerInvoiceState(orderOf({ payments: [] }), [], '2026-11-11')
  assert.equal(unpaid.eligible, false)
  assert.match(unpaid.reason, /ชำระยังไม่ครบ/)
})

t('สถานะ: เกินกำหนดขอไม่ได้ · ภายในกำหนดขอได้ (ยังไม่มีใบ) แก้ไม่ได้เพราะยังไม่มีใบ', () => {
  const late = customerInvoiceState(orderOf(), [], '2026-11-16')
  assert.equal(late.eligible, false)
  assert.match(late.reason, /เลยกำหนด/)
  assert.equal(late.deadline, '2026-11-15')
  const open = customerInvoiceState(orderOf(), [], '2026-11-15')
  assert.equal(open.eligible, true)
  assert.equal(open.invoice, null)
  assert.equal(open.canEdit, false)
  assert.equal(open.revisionsLeft, MAX_CUSTOMER_REVISIONS)
})

t('สถานะ: มีใบที่ยังไม่ยกเลิก = แก้ได้จนครบ 3 ครั้ง · ใบที่ถูกยกเลิกแล้วไม่ถือเป็นใบปัจจุบัน', () => {
  const inv = { id: 'ti1', no: 'INV-2569-00001', type: 'invoice', orderId: 'o1', rev: 0, createdAt: '2026-11-10T11:00:00Z' }
  const st = customerInvoiceState(orderOf(), [inv], '2026-11-12')
  assert.equal(st.invoice.id, 'ti1')
  assert.equal(st.canEdit, true)
  assert.equal(st.revisionsLeft, MAX_CUSTOMER_REVISIONS)
  const maxed = customerInvoiceState(orderOf(), [{ ...inv, rev: MAX_CUSTOMER_REVISIONS }], '2026-11-12')
  assert.equal(maxed.canEdit, false)
  assert.equal(maxed.revisionsLeft, 0)
  const voided = customerInvoiceState(orderOf(), [
    { ...inv, voidedBy: 'cn1' },
    { id: 'cn1', type: 'credit', no: 'CN-2569-00001', refId: 'ti1', createdAt: '2026-11-11T09:00:00Z' },
  ], '2026-11-12')
  assert.equal(voided.invoice, null)
  assert.equal(voided.history.length, 2)
})

t('ตรวจก่อนขอ/แก้: ขอซ้ำไม่ได้ · แก้ต้องมีใบเดิม · ข้อมูลร้านไม่พร้อมให้ข้อความลูกค้า · ผู้ซื้อผิดแจ้งตรงจุด', () => {
  const inv = { id: 'ti1', no: 'INV-2569-00001', type: 'invoice', orderId: 'o1', rev: 0, createdAt: '2026-11-10T11:00:00Z' }
  assert.equal(customerIssueBlock(orderOf(), [], BUYER, SHOP_VAT, '2026-11-12'), '')
  assert.equal(customerIssueBlock(orderOf(), [inv], BUYER, SHOP_VAT, '2026-11-12'), 'ออกใบกำกับภาษีของออร์เดอร์นี้แล้ว')
  assert.equal(customerIssueBlock(orderOf(), [], BUYER, SHOP_VAT, '2026-11-12', { edit: true }), 'ยังไม่มีใบกำกับภาษี')
  assert.equal(customerIssueBlock(orderOf(), [{ ...inv, rev: MAX_CUSTOMER_REVISIONS }], BUYER, SHOP_VAT, '2026-11-12', { edit: true }), `แก้ไขได้ไม่เกิน ${MAX_CUSTOMER_REVISIONS} ครั้ง กรุณาติดต่อร้าน`)
  assert.equal(customerIssueBlock(orderOf(), [], BUYER, { ...SHOP_VAT, taxId: '' }, '2026-11-12'), CUSTOMER_SELLER_MSG)
  assert.match(customerIssueBlock(orderOf(), [], { ...BUYER, taxId: '123' }, SHOP_VAT, '2026-11-12'), /ผู้ซื้อ/)
})

t('ใบกำกับ: VAT แบบรวมใน 7% · ข้อมูลผู้ขาย/ผู้ซื้อถูกต้อง · เลขที่ยังว่างรอฐานข้อมูล', () => {
  const doc = buildInvoice({ order: orderOf(), seller: SHOP_VAT, buyer: { ...BUYER, name: ' บริษัท ทดสอบ จำกัด ' }, id: 'ti9', by: 'customer:c1', rev: 0, date: '2026-11-11', createdAt: '2026-11-11T02:00:00Z' })
  assert.equal(doc.no, '')
  assert.equal(doc.type, 'invoice')
  assert.equal(doc.id, 'ti9')
  assert.equal(doc.total, 200)
  assert.equal(doc.vat, 13.08) // 200 × 7 / 107
  assert.equal(doc.beforeVat, 186.92)
  assert.equal(doc.seller.taxId, TAX_SHOP)
  assert.equal(doc.seller.name, SHOP_VAT.legalName)
  assert.equal(doc.buyer.name, 'บริษัท ทดสอบ จำกัด')
  assert.equal(doc.buyer.taxId, TAX_BUYER)
  assert.equal(doc.lines[0].amount, 200)
  assert.ok(doc.totalText.length > 0)
})

t('ใบลดหนี้: อ้างใบเดิม ไม่ติดสถานะยกเลิกมา · เหตุผลถูกตัดช่องว่าง', () => {
  const inv = { ...buildInvoice({ order: orderOf(), seller: SHOP_VAT, buyer: BUYER, id: 'ti9', by: 'customer:c1', rev: 0, date: '2026-11-11', createdAt: '2026-11-11T02:00:00Z' }), no: 'INV-2569-00001' }
  const cn = buildCreditNote({ inv, id: 'cn9', date: '2026-11-12', reason: '  แก้ข้อมูล  ', by: 'customer:c1', createdAt: '2026-11-12T03:00:00Z' })
  assert.equal(cn.type, 'credit')
  assert.equal(cn.refNo, 'INV-2569-00001')
  assert.equal(cn.refId, 'ti9')
  assert.equal(cn.reason, 'แก้ข้อมูล')
  assert.equal(cn.no, '')
  assert.equal('voidedBy' in cn, false)
  assert.equal(cn.total, inv.total)
})

if (fail) { console.log(`${fail} รายการไม่ผ่าน`); process.exit(1) }
console.log('taxInvoice: all passed')
