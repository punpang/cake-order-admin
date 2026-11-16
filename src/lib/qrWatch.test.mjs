// ทดสอบการจับคู่การโอนเข้า QR ของ POS · รัน: node src/lib/qrWatch.test.mjs
import assert from 'node:assert/strict'
import { watchRefs, reservedOf, isWatched, canBindLine, adoptPatch, notDismissed } from './qrWatch.js'

let pass = 0
const t = (name, fn) => { fn(); pass++; console.log('PASS', name) }

t('รหัส QR ของรายการ = รหัสปัจจุบัน + รหัสเดิม ไม่ซ้ำ ไม่เอาค่าว่าง', () => {
  assert.deepEqual(watchRefs({ qrRef: 'R2', prevRefs: ['R1', 'R2', ''] }), ['R2', 'R1'])
  assert.deepEqual(watchRefs({ qrRef: '', prevRefs: ['R1'] }), ['R1'])
  assert.deepEqual(watchRefs({}), [])
})

t('QR ที่ยกเลิกแล้วไม่กันยอด รายการอื่นกันยอดตามปกติ', () => {
  assert.equal(reservedOf({ status: 'cancelled' }, 28), 0)
  assert.equal(reservedOf({ status: 'waiting' }, 28), 28)
  assert.equal(reservedOf({ status: '' }, 28), 28)
})

t('เฝ้าการโอน: QR ที่ยกเลิกเฝ้าต่อแม้หมดอายุ · QR ที่ยังใช้ได้เฝ้า · หมดอายุ/ยืนยันแล้ว/พบแล้ว/เงินสด/ไม่มีรหัส ไม่เฝ้า', () => {
  assert.equal(isWatched({ method: 'transfer', qrRef: 'R1', status: 'cancelled' }, true), true)
  assert.equal(isWatched({ method: 'transfer', qrRef: 'R1', status: 'waiting' }, false), true)
  assert.equal(isWatched({ method: 'transfer', qrRef: 'R1', status: 'waiting' }, true), false)
  assert.equal(isWatched({ method: 'transfer', qrRef: 'R1', confirmed: true }, false), false)
  assert.equal(isWatched({ method: 'transfer', qrRef: 'R1', detectedAt: 5 }, false), false)
  assert.equal(isWatched({ method: 'cash', qrRef: '' }, false), false)
  assert.equal(isWatched({ method: 'transfer', qrRef: '' }, false), false)
})

t('ผูกได้เมื่อยอดไม่เกินยอดคงเหลือ · บิลรับครบแล้วผูกเองไม่ได้', () => {
  assert.equal(canBindLine(28, 28, 0), true) // QR ที่ยกเลิก แต่ยอดคงเหลือยังพอ
  assert.equal(canBindLine(28, 0, 0), false) // บิลรับครบแล้วจากวิธีอื่น
  assert.equal(canBindLine(28, 0, 28), true) // รายการที่ยังกันยอดอยู่ ยอดรวมครอบคลุมอยู่แล้ว
  assert.equal(canBindLine(28.004, 28, 0), true) // คลาดเคลื่อนเศษสตางค์ยังผ่าน
})

t('พบการโอนของรหัสเดิม → ผูกเข้ารายการ รหัสที่จ่ายจริงเป็นรหัสหลัก รหัสที่เหลือยังเฝ้าต่อ', () => {
  const l = { qrRef: 'R2', prevRefs: ['R1'], status: 'cancelled', candidates: [{ id: 'x' }] }
  const p = adoptPatch(l, 'R1', { id: 'T9' }, 1000)
  assert.equal(p.qrRef, 'R1')
  assert.deepEqual(p.prevRefs, ['R2'])
  assert.equal(p.status, 'waiting')
  assert.equal(p.detectedAt, 1000)
  assert.equal(p.maneeId, 'T9')
  assert.deepEqual(p.candidates, [])
})

t('ไม่แสดง/ไม่ผูกรายการที่พนักงานเคยปิดการแจ้งเตือนหรือยกเลิกไปแล้ว', () => {
  const rows = [{ id: 'a' }, { id: 'b' }]
  assert.deepEqual(notDismissed(rows, ['a']), [{ id: 'b' }])
  assert.deepEqual(notDismissed(rows), rows)
})

console.log(`ผ่าน ${pass} กรณี`)
