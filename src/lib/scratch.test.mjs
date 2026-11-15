// ทดสอบการคำนวณสัดส่วนที่ขูดแล้วของบัตรขูด · รัน: node src/lib/scratch.test.mjs
import assert from 'node:assert/strict'
import { REVEAL_AT, scratchedRatio, shouldReveal } from './scratch.js'

let pass = 0
const t = (name, fn) => { fn(); pass++; console.log('PASS', name) }
const canvas = (w, h, clearFn) => {
  const a = new Uint8ClampedArray(w * h * 4).fill(255) // ทึบทั้งหมด
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (clearFn(x, y)) a[(y * w + x) * 4 + 3] = 0
  return a
}

t('ยังไม่ขูด: สัดส่วนเป็น 0 และยังไม่เปิดเผย', () => {
  const a = canvas(60, 40, () => false)
  assert.equal(scratchedRatio(a, 60, 40), 0)
  assert.equal(shouldReveal(0), false)
})

t('ขูดครึ่งซ้าย: สัดส่วนประมาณครึ่ง และยังไม่ถึงเกณฑ์', () => {
  const a = canvas(60, 40, (x) => x < 30)
  const r = scratchedRatio(a, 60, 40)
  assert.ok(r > 0.45 && r < 0.55, `ได้ ${r}`)
  assert.equal(shouldReveal(r), false)
})

t('ขูดเกินเกณฑ์: เปิดเผยผล', () => {
  const a = canvas(60, 40, (x) => x < 40)
  const r = scratchedRatio(a, 60, 40)
  assert.ok(r >= REVEAL_AT)
  assert.equal(shouldReveal(r), true)
})

t('ขูดหมด: สัดส่วนเป็น 1', () => {
  const a = canvas(60, 40, () => true)
  assert.equal(scratchedRatio(a, 60, 40), 1)
})

console.log(`ผ่าน ${pass} กรณี`)
