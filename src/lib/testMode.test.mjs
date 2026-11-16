// ทดสอบกติกาโหมดทดสอบ (ฝั่งแอป) · รัน: node src/lib/testMode.test.mjs
import assert from 'node:assert/strict'
import { TEST_CODE_PREFIX, docCode, readTestMode, testModeOn, writeTestMode } from './testMode.js'

let pass = 0
const t = (name, fn) => { fn(); pass++; console.log('PASS', name) }
const memory = () => {
  const m = new Map()
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }
}
const broken = { getItem() { throw new Error('ปิดการเก็บข้อมูล') }, setItem() { throw new Error('ปิดการเก็บข้อมูล') }, removeItem() { throw new Error('ปิดการเก็บข้อมูล') } }

t('สถานะโหมดทดสอบเก็บในเครื่อง: เปิดแล้วอ่านได้ ปิดแล้วหาย', () => {
  const s = memory()
  assert.equal(readTestMode(s), false)
  assert.equal(writeTestMode(true, s), true)
  assert.equal(readTestMode(s), true)
  writeTestMode(false, s)
  assert.equal(readTestMode(s), false)
})

t('ที่เก็บข้อมูลใช้ไม่ได้ (เบราว์เซอร์ปิดการเก็บ) = โหมดจริง และไม่ทำให้แอปพัง', () => {
  assert.equal(readTestMode(broken), false)
  assert.equal(writeTestMode(true, broken), false)
})

t('โหมดทดสอบต้องมีการเชื่อม Supabase (ไม่มี = ไม่มีโหมดนี้แม้เปิดสถานะไว้)', () => {
  const s = memory()
  writeTestMode(true, s)
  assert.equal(readTestMode(s), true)
  assert.equal(testModeOn(false), false)
})

t('รหัสเอกสาร: โหมดทดสอบเติม TEST- โหมดจริงและรหัสว่างไม่เปลี่ยน', () => {
  assert.equal(TEST_CODE_PREFIX, 'TEST-')
  assert.equal(docCode('QT-261116-00001', true), 'TEST-QT-261116-00001')
  assert.equal(docCode('QT-261116-00001', false), 'QT-261116-00001')
  assert.equal(docCode('', true), '')
  assert.equal(docCode(undefined, true), undefined)
})

console.log(`ผ่าน ${pass} กรณี`)
