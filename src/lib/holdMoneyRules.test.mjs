// กติกาเงินพัก (ฟังก์ชันล้วน): ธนบัตร · ตรวจรายการ · ยอดคืนตอนยกเลิก
import assert from 'node:assert/strict'
import { NOTE_VALUES, holdCountOf, holdAmountOf, holdErrors, holdCancelRefundOf } from './holdMoney.js'

const cases = [
  ['มูลค่าธนบัตร 20/50/100/500/1000', () => assert.deepEqual(NOTE_VALUES, [20, 50, 100, 500, 1000])],
  ['นับจำนวนและมูลค่า: 20×1 + 50×4 + 1000×2 = 2,220', () => {
    assert.equal(holdCountOf({ 20: 1, 50: 4, 1000: 2 }), 7)
    assert.equal(holdAmountOf({ 20: 1, 50: 4, 1000: 2 }), 2220)
  }],
  ['ตรวจผ่าน: ธนบัตรตรงยอด', () => assert.equal(holdErrors({ kind: 'hide', notes: { 1000: 1 }, amount: 1000 }), '')],
  ['ยอดไม่ตรงธนบัตร → ไม่ผ่าน', () => assert.notEqual(holdErrors({ kind: 'hide', notes: { 1000: 1 }, amount: 900 }), '')],
  ['ประเภทไม่ถูกต้อง → ไม่ผ่าน', () => assert.notEqual(holdErrors({ kind: 'other', notes: { 1000: 1 }, amount: 1000 }), '')],
  ['ไม่มีธนบัตรเลย → ไม่ผ่าน', () => assert.notEqual(holdErrors({ kind: 'pull', notes: {}, amount: 0 }), '')],
  ['จำนวนธนบัตรทศนิยม/ติดลบ → ไม่ผ่าน', () => {
    assert.notEqual(holdErrors({ kind: 'hide', notes: { 100: 1.5 }, amount: 150 }), '')
    assert.notEqual(holdErrors({ kind: 'hide', notes: { 100: -1 }, amount: -100 }), '')
  }],
  ['เกินจำนวนธนบัตรสูงสุดที่ตั้งไว้ → ไม่ผ่าน (maxNotes = 5, ใช้ 6 ใบ)', () => {
    const hm = { kind: 'hide', notes: { 100: 6 }, amount: 600 }
    assert.notEqual(holdErrors(hm, { maxNotes: 5 }), '')
    assert.equal(holdErrors(hm, { maxNotes: 6 }), '')
  }],
  ['maxNotes = 0 หมายถึงไม่จำกัด', () => assert.equal(holdErrors({ kind: 'hide', notes: { 100: 50 }, amount: 5000 }, { maxNotes: 0 }), '')],
  ['ยอดคืนตอนยกเลิก: คืนไม่เกินเงินพักที่ค้าง และไม่เกินส่วนที่ชำระเกินยอดบิล', () => {
    assert.equal(holdCancelRefundOf({ liability: 1000, paidNet: 1400, total: 400 }), 1000)
    assert.equal(holdCancelRefundOf({ liability: 1000, paidNet: 1000, total: 400 }), 600)
    assert.equal(holdCancelRefundOf({ liability: 1000, paidNet: 300, total: 400 }), 0)
  }],
]

let fails = 0
for (const [name, fn] of cases) {
  try { fn(); console.log(`PASS ${name}`) } catch (e) { fails++; console.log(`FAIL ${name}: ${e.message}`) }
}
console.log(fails ? `ไม่ผ่าน ${fails} กรณี` : 'ผ่านทุกกรณี')
process.exitCode = fails ? 1 : 0
