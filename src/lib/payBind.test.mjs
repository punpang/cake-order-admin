// ทดสอบกติกาผูกยอดโอนที่รับแล้วเข้าบิลค้าง · รัน: node src/lib/payBind.test.mjs
import assert from 'node:assert/strict'
import { isUnsaved, needBind, closeGuard } from './payBind.js'

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

console.log(`ผ่าน ${pass} กรณี`)
