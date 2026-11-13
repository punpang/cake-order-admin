// ทดสอบเครื่องหมายตรวจสลิปเทียบกับออร์เดอร์: ยอดไม่เกินยอดค้าง · วัน-เวลาหลังสร้างออร์เดอร์ (เวลาไทย) · รหัสร้านค้า · รหัสอ้างอิง
import assert from 'node:assert/strict'
import { slipChecksOf, refOfOrderCode } from './slipChecks.js'

const ORDER = { code: 'OR-131126-000123', createdAt: '2026-11-11T02:00:00.000Z' } // สร้างออร์เดอร์ 09:00 เวลาไทย 11 พ.ย. 2569
const SHOP = '014000000517185'
const by = (list, key) => list.find((c) => c.key === key)
let n = 0
const t = (name, fn) => { fn(); n++; console.log(`PASS ${name}`) }

t('รหัสอ้างอิงของออร์เดอร์แปลงจากเลขเดิม (ไม่เก็บเพิ่ม)', () => {
  assert.equal(refOfOrderCode('OR-131126-000123'), 'ORD131126000123')
  assert.equal(refOfOrderCode('POS-131126-00123'), 'POS13112600123')
})

t('ยอด: ไม่เกินยอดค้าง ✓ · เกิน ✗ · ไม่มียอดให้อ่าน หรือไม่มียอดค้าง → null', () => {
  assert.equal(by(slipChecksOf({ fields: { amount: 178 }, order: ORDER, balance: 540 }), 'amount').ok, true)
  assert.equal(by(slipChecksOf({ fields: { amount: 900 }, order: ORDER, balance: 540 }), 'amount').ok, false)
  assert.equal(by(slipChecksOf({ fields: {}, order: ORDER, balance: 540 }), 'amount').ok, null)
  assert.equal(by(slipChecksOf({ fields: { amount: 178 }, order: ORDER, balance: null }), 'amount').ok, null)
})

t('วัน-เวลา: ต้องหลังเวลาสร้างออร์เดอร์ (เทียบเป็นนาที) · เท่ากันนาทีถือว่าไม่ผ่าน', () => {
  assert.equal(by(slipChecksOf({ fields: { paidAt: '2026-11-11T14:48' }, order: ORDER }), 'paidAt').ok, true)
  assert.equal(by(slipChecksOf({ fields: { paidAt: '2026-11-11T08:30' }, order: ORDER }), 'paidAt').ok, false)
  assert.equal(by(slipChecksOf({ fields: { paidAt: '2026-11-11T09:00' }, order: ORDER }), 'paidAt').ok, false)
  assert.equal(by(slipChecksOf({ fields: { paidAt: '2026-11-11T09:01' }, order: ORDER }), 'paidAt').ok, true)
  assert.equal(by(slipChecksOf({ fields: { paidAt: '2026-11-11T14:48' }, order: { code: ORDER.code } }), 'paidAt').ok, null)
})

t('รหัสร้านค้า: ตรง ✓ · ไม่ตรง ✗ · อ่านไม่ได้ ✗ · ยังไม่ได้ตั้งรหัสร้านค้า → null', () => {
  assert.equal(by(slipChecksOf({ fields: { merchantCode: SHOP }, configuredMerchantCode: SHOP }), 'merchant').ok, true)
  assert.equal(by(slipChecksOf({ fields: { merchantCode: '123927229' }, configuredMerchantCode: SHOP }), 'merchant').ok, false)
  assert.equal(by(slipChecksOf({ fields: {}, configuredMerchantCode: SHOP }), 'merchant').ok, false)
  assert.equal(by(slipChecksOf({ fields: { merchantCode: SHOP }, configuredMerchantCode: '' }), 'merchant').ok, null)
})

t('รหัสอ้างอิงร้านค้า: ตรงกับออร์เดอร์ ✓ · ไม่ตรง ✗ · ไม่มีในสลิป → null', () => {
  assert.equal(by(slipChecksOf({ fields: { shopRef: 'ORD131126000123' }, order: ORDER }), 'shopRef').ok, true)
  assert.equal(by(slipChecksOf({ fields: { shopRef: 'POS123927229' }, order: ORDER }), 'shopRef').ok, false)
  assert.equal(by(slipChecksOf({ fields: {}, order: ORDER }), 'shopRef').ok, null)
})

console.log(`slipChecks: ${n} passed`)
