// ทดสอบกติกาผูกยอดโอนที่รับแล้วเข้าบิลค้าง · รัน: node src/lib/payBind.test.mjs
import assert from 'node:assert/strict'
import { isUnsaved, needBind, closeGuard, canBindCash } from './payBind.js'

let pass = 0
const t = (name, fn) => { fn(); pass++; console.log('PASS', name) }

t('รายการที่ยังไม่ผูก: ต้องรับแล้ว ยังไม่ล็อก และยอด > 0', () => {
  assert.equal(isUnsaved({ amount: '500', confirmed: true }), true)
  assert.equal(isUnsaved({ amount: '500', confirmed: false }), false)
  assert.equal(isUnsaved({ amount: '500', confirmed: true, locked: true }), false)
  assert.equal(isUnsaved({ amount: '0', confirmed: true }), false)
  assert.equal(isUnsaved(null), false)
})

t('ผูกทันที: เฉพาะตอนยังขาดยอดและมีรายการรับแล้วที่ยังไม่ได้ผูก', () => {
  const lines = [{ amount: '500', confirmed: true }]
  assert.equal(needBind(lines, 500), true)
  assert.equal(needBind(lines, 0), false) // ครบแล้ว รอกดยืนยันรับเงิน
  assert.equal(needBind(lines, -100), false) // เกินยอด ต้องแก้ยอดก่อน
  assert.equal(needBind([{ amount: '500', confirmed: false }], 500), false)
  assert.equal(needBind([{ amount: '500', confirmed: true, locked: true }], 500), false)
})

t('ปิดหน้าชำระ: มียอดรับแล้วที่ยังไม่ได้ผูก = ห้ามปิด พร้อมบอกสิ่งที่ต้องกด', () => {
  const lines = [{ amount: '500', confirmed: true }]
  const partial = closeGuard(lines, 500)
  assert.equal(partial.block, true)
  assert.match(partial.message, /บันทึกบิลค้างไว้/)
  const full = closeGuard(lines, 0)
  assert.equal(full.block, true)
  assert.match(full.message, /ยืนยันรับเงิน/)
  const over = closeGuard(lines, -100)
  assert.equal(over.block, true)
  assert.match(over.message, /เกินยอด/)
})

t('ปิดหน้าชำระ: ไม่มียอดรับแล้วที่ค้างบันทึก (ยังไม่รับ หรือผูกแล้ว) = ปิดได้', () => {
  assert.deepEqual(closeGuard([], 500), { block: false, message: '' })
  assert.equal(closeGuard([{ amount: '300', confirmed: false }], 500).block, false)
  assert.equal(closeGuard([{ amount: '500', confirmed: true, locked: true }], 500).block, false)
})

t('เงินสดผูกเป็นบิลค้างได้: รับถึงยอดของรายการ และยอดรวมยังขาด', () => {
  const cash = (over) => ({ method: 'cash', amount: '30', received: '30', ...over })
  assert.equal(canBindCash(cash(), 45), true)
  assert.equal(canBindCash(cash({ received: '50' }), 45), true) // รับมาเกินได้ ทอนตามจริง
  assert.equal(canBindCash(cash({ received: '20' }), 45), false) // รับไม่ถึงยอดของรายการ
  assert.equal(canBindCash(cash(), 0), false) // ครบยอดแล้ว ให้กดยืนยันรับเงินตามปกติ
  assert.equal(canBindCash(cash({ method: 'transfer', qrRef: 'POS1' }), 45), false)
  assert.equal(canBindCash(cash({ confirmed: true }), 45), false)
  assert.equal(canBindCash(cash({ locked: true }), 45), false)
  assert.equal(canBindCash(cash({ amount: '0' }), 45), false)
  assert.equal(canBindCash(null, 45), false)
})

console.log(`ผ่าน ${pass} กรณี`)
