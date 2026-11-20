// ทดสอบข้อมูลใบเสร็จร่วม (จอ + เครื่องพิมพ์) · รัน: node src/lib/receiptFacts.test.mjs
import assert from 'node:assert/strict'
import { receiptFacts } from './receiptFacts.js'

let pass = 0
const t = (name, fn) => { fn(); pass++; console.log('PASS', name) }

const item = (over = {}) => ({ id: 'i1', name: 'เค้กช็อกโกแลต', qty: 1, unitPrice: 500, fullPrice: 500, mods: [], discounts: [], ...over })
const order = (over = {}) => ({
  code: 'OR-260101-1', createdAt: '2026-11-20T10:00:00+07:00', status: 'awaiting_payment', channel: 'line',
  fulfillment: 'pickup', pickupAt: '2026-11-21T14:00:00+07:00', detail: '',
  items: [item()], payments: [], returns: [], loyalty: null, ...over,
})

t('POS: ไม่มีฟิลด์เฉพาะออเดอร์ และแสดงสมาชิกแบบเดิม', () => {
  const f = receiptFacts(order({ channel: 'pos', status: 'paid', payments: [{ id: 'p1', status: 'confirmed', method: 'เงินสด', amount: 500, received: 500 }] }), {
    customer: { name: 'คุณมะลิ', phone: '0812345678' }, points: 40,
  })
  assert.equal(f.fulfillment, null)
  assert.equal(f.nextDue, null)
  assert.equal(f.customer.label, 'สมาชิก')
  assert.equal(f.customer.phone, '')
  assert.equal(f.customer.pointsLeft, 40)
  assert.equal(f.balance, 0)
})

t('ออเดอร์มัดจำ: ยอดค้าง งวดถัดไป นัดรับ และลูกค้า', () => {
  const o = order({
    payments: [
      { id: 'p1', status: 'confirmed', method: 'โอนเงิน', amount: 250, received: 250 },
      { id: 'p2', status: 'reported', method: 'เงินสด', amount: 250, dueAt: '2026-11-21T10:00:00' },
    ],
  })
  const f = receiptFacts(o, { customer: { name: 'คุณสมชาย', phone: '0899998888' }, points: 12, shop: { name: 'ร้านทดสอบ' } })
  assert.equal(f.shopName, 'ร้านทดสอบ')
  assert.equal(f.payments.length, 1)
  assert.equal(f.paidTotal, 250)
  assert.equal(f.balance, 250)
  assert.ok(f.nextDue && f.nextDue.at && f.nextDue.amount.includes('250'))
  assert.equal(f.fulfillment.label, 'รับที่ร้าน')
  assert.ok(f.fulfillment.at)
  assert.equal(f.customer.label, 'ลูกค้า')
  assert.equal(f.customer.phone, '0899998888')
  assert.equal(f.customer.pointsLeft, 12)
})

t('งวดที่มีกำหนดชำระหลายงวด: เอางวดที่ถึงกำหนดเร็วที่สุด', () => {
  const o = order({
    payments: [
      { id: 'p1', status: 'reported', method: 'เงินสด', amount: 100, dueAt: '2026-11-25T10:00:00' },
      { id: 'p2', status: 'reported', method: 'เงินสด', amount: 200, dueAt: '2026-11-22T10:00:00' },
    ],
  })
  const f = receiptFacts(o)
  assert.ok(f.nextDue.amount.includes('200'))
})

t('จัดส่ง: แสดงที่อยู่จัดส่งจากรายละเอียดออเดอร์', () => {
  const f = receiptFacts(order({ fulfillment: 'delivery', detail: '99/1 ถ.สุขุมวิท กรุงเทพ' }))
  assert.equal(f.fulfillment.label, 'จัดส่ง')
  assert.equal(f.fulfillment.address, '99/1 ถ.สุขุมวิท กรุงเทพ')
})

t('ยกเลิกแล้ว: มีป้ายยกเลิก และไม่แสดงคะแนนคงเหลือ', () => {
  const f = receiptFacts(order({ status: 'cancelled' }), { customer: { name: 'คุณมะลิ' }, points: 50 })
  assert.equal(f.cancelled, true)
  assert.equal(f.customer.pointsLeft, null)
})

t('ที่อยู่ร้าน: ใช้ที่อยู่ตามข้อมูลกฎหมายก่อน และข้ามที่อยู่ตัวอย่าง', () => {
  const withLegal = receiptFacts(order(), { legal: { contact: { address: '1 ถ.จริง', phone: '021234567' } }, storefront: { address: 'ตัวอย่าง 9' } })
  assert.equal(withLegal.shopAddress, '1 ถ.จริง')
  assert.equal(withLegal.shopPhone, '021234567')
  const sampleOnly = receiptFacts(order(), { storefront: { address: 'ตัวอย่าง 9' } })
  assert.equal(sampleOnly.shopAddress, '')
  const storeOnly = receiptFacts(order(), { storefront: { address: '2 ถ.หน้าร้าน' } })
  assert.equal(storeOnly.shopAddress, '2 ถ.หน้าร้าน')
})

t('VAT แบบบวกเพิ่ม: แสดงชื่อและเลขผู้เสียภาษีของร้าน', () => {
  const o = order({ vat: { rate: 7, mode: 'exclusive' } })
  const f = receiptFacts(o, { shop: { vat: { legalName: 'บริษัท ตัวอย่าง', taxId: '0105555555555' } } })
  assert.equal(f.vatMode, 'exclusive')
  assert.equal(f.vatLegalName, 'บริษัท ตัวอย่าง')
  assert.equal(f.vatTaxId, '0105555555555')
  assert.ok(f.vat > 0)
})

console.log(`\n✓ ผ่านทั้งหมด ${pass} กรณี`)
