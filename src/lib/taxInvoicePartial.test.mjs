// ทดสอบยอดใบลดหนี้บางส่วน/ยอดคงเหลือ/ยอดใบใหม่หลังคืนเงินบางส่วน (ฟังก์ชันล้วน) · รัน: node src/lib/taxInvoicePartial.test.mjs
import assert from 'node:assert/strict'
import { buildInvoice, buildCreditNote, buildPartialCreditNote, remainingOf, partialCreditBlock, vatOfGross } from './taxInvoice.js'

let fail = 0
const t = (name, fn) => { try { fn(); console.log(`PASS ${name}`) } catch (e) { fail++; console.log(`FAIL ${name}: ${e.message}`) } }
const withCheck = (base12) => { let s = 0; for (let i = 0; i < 12; i++) s += Number(base12[i]) * (13 - i); return base12 + String((11 - (s % 11)) % 10) }
const SELLER = { legalName: 'บริษัท เค้กตัวอย่าง จำกัด', taxId: withCheck('010556700123'), branch: '00000', address: '88/12' }
const BUYER = { name: 'บริษัท ทดสอบ จำกัด', taxId: withCheck('010553700001'), branch: '00000', address: '1 ถนนทดสอบ' }
// ออร์เดอร์ 200 บาท รวม VAT 7% (inclusive) → VAT 13.08
const order = { id: 'o1', code: 'A001', status: 'delivered', fulfillment: 'pickup', customerId: 'c1', items: [{ name: 'เค้ก', qty: 2, unitPrice: 100, fullPrice: 100, discounts: [] }], vat: { rate: 7, mode: 'inclusive' }, payments: [{ status: 'confirmed', amount: 200, confirmedAt: '2026-11-10T10:00:00' }] }
const inv = buildInvoice({ order, seller: SELLER, buyer: BUYER, id: 'ti1', by: 'u', date: '2026-11-11', createdAt: '2026-11-11T01:00:00Z' })
inv.no = 'INV-2569-00001'

t('ใบกำกับเต็มเดิมไม่เปลี่ยน: ยอด 200 VAT 13.08', () => {
  assert.equal(inv.total, 200)
  assert.equal(inv.vat, 13.08)
})
t('vatOfGross แยก VAT ออกจากยอดรวม (inclusive)', () => {
  assert.equal(vatOfGross(107, 7), 7)
  assert.equal(vatOfGross(100, 7), 6.54)
})
t('ใบลดหนี้บางส่วน 100 บาท: VAT 6.54, ก่อน VAT 93.46, อ้างใบเดิม, ไม่ตั้ง voidedBy', () => {
  const cn = buildPartialCreditNote({ inv, amount: 100, id: 'cn1', date: '2026-11-12', reason: 'คืนเค้ก 1 ชิ้น', by: 'u', createdAt: 'x' })
  assert.equal(cn.type, 'credit')
  assert.equal(cn.total, 100)
  assert.equal(cn.vat, 6.54)
  assert.equal(cn.beforeVat, 93.46)
  assert.equal(cn.refId, 'ti1')
  assert.equal(cn.refNo, 'INV-2569-00001')
  assert.equal('voidedBy' in cn, false)
  assert.equal(cn.lines.length, 1)
})
t('ยอดคงเหลือหลังลดหนี้บางส่วน: 100 / VAT 6.54 (ไม่ปัดซ้ำ)', () => {
  const cn = buildPartialCreditNote({ inv, amount: 100, id: 'cn1', date: '2026-11-12', reason: 'r', by: 'u', createdAt: 'x' })
  const rem = remainingOf(inv, [inv, cn])
  assert.equal(rem.total, 100)
  assert.equal(rem.vat, 6.54)
  assert.equal(rem.partial, true)
  assert.equal(rem.lastCreditId, 'cn1')
})
t('ไม่มีใบลดหนี้ → ยอดคงเหลือ = ยอดเดิม', () => {
  const rem = remainingOf(inv, [inv])
  assert.equal(rem.total, 200)
  assert.equal(rem.partial, false)
})
t('ใบกำกับใหม่ด้วยยอดคงเหลือ: ยอด 100 VAT 6.54 และมีบรรทัดเดียว', () => {
  const again = buildInvoice({ order, seller: SELLER, buyer: BUYER, id: 'ti2', by: 'u', date: '2026-11-13', createdAt: 'x', remaining: { total: 100, vat: 6.54 } })
  assert.equal(again.total, 100)
  assert.equal(again.vat, 6.54)
  assert.equal(again.beforeVat, 93.46)
  assert.equal(again.lines.length, 1)
  assert.deepEqual(again.discounts, [])
})
t('ใบลดหนี้ยกเลิกทั้งใบหลังคืนบางส่วน: ใช้ยอดคงเหลือ ไม่ใช่ยอดเต็ม', () => {
  const cn = buildCreditNote({ inv, id: 'cn9', date: '2026-11-14', reason: 'ยกเลิก', by: 'u', createdAt: 'x', remaining: { total: 100, vat: 6.54 } })
  assert.equal(cn.total, 100)
  assert.equal(cn.vat, 6.54)
  assert.equal(cn.refId, 'ti1')
  assert.equal('voidedBy' in cn, false)
})
t('ใบลดหนี้เต็มเดิม (ไม่ส่ง remaining) ยังได้ยอดเต็ม', () => {
  const cn = buildCreditNote({ inv, id: 'cn8', date: '2026-11-14', reason: 'แก้ไข', by: 'u', createdAt: 'x' })
  assert.equal(cn.total, 200)
  assert.equal(cn.vat, 13.08)
})
t('บล็อกคืนเกินยอดคงเหลือ', () => {
  assert.match(partialCreditBlock(100, 150), /เกินยอดคงเหลือ/)
  assert.equal(partialCreditBlock(100, 100), '')
  assert.equal(partialCreditBlock(100, 0), '')
})

if (fail) { console.log(`\n${fail} ไม่ผ่าน`); process.exit(1) }
console.log('\nผ่านทั้งหมด')
