// ทดสอบการเทียบเลขบัญชีผู้รับบนสลิปกับเลขบัญชีร้าน · รัน: node src/lib/slipAccount.test.mjs
import assert from 'node:assert/strict'
import { slipAccountMatches } from './slipAccount.js'

let fail = 0
const t = (name, fn) => { try { fn(); console.log(`PASS ${name}`) } catch (e) { fail++; console.log(`FAIL ${name}: ${e.message}`) } }

t('ปิดบางหลัก xxx-x-x8154-x ตรงกับบัญชีร้านที่ตำแหน่งเดียวกัน', () => {
  assert.equal(slipAccountMatches('xxx-x-x8154-x', ['1234581540']), true)
})
t('ปิดด้วย XXX XXX 3402 ตรงกับบัญชีร้านที่ลงท้าย 3402 (เลขร้านมีขีด)', () => {
  assert.equal(slipAccountMatches('XXX XXX 3402', ['123-4-56340-2']), true)
})
t('OCR อ่านตัวปิดเป็น % ยังเทียบได้', () => {
  assert.equal(slipAccountMatches('%%%-%-%8154-%', ['1234581540']), true)
})
t('ตัวเลขที่เห็นไม่ตรงกับบัญชีร้าน → ไม่ตรง', () => {
  assert.equal(slipAccountMatches('XXX XXX 3402', ['1234563409']), false)
})
t('จำนวนตำแหน่งไม่เท่ากับบัญชีร้าน → ไม่ตรง', () => {
  assert.equal(slipAccountMatches('xxx-x-x8154-x', ['12345681540']), false)
})
t('เห็นตัวเลขไม่ถึง 4 หลัก → ไม่ตรง แม้ตรงกันทั้งหมดที่เห็น', () => {
  assert.equal(slipAccountMatches('xxx-x-xxx12-x', ['1234567120']), false)
})
t('เลขเครื่องร้านค้า (KB...) หรือข้อความที่ไม่ใช่ตัวเลข → ไม่ตรง', () => {
  assert.equal(slipAccountMatches('KB000001234567', ['1234567890']), false)
})
t('ไม่มีเลขบนสลิปหรือไม่มีบัญชีร้าน → ไม่ตรง', () => {
  assert.equal(slipAccountMatches(null, ['1234567890']), false)
  assert.equal(slipAccountMatches('', ['1234567890']), false)
  assert.equal(slipAccountMatches('xxx-x-x8154-x', []), false)
  assert.equal(slipAccountMatches('xxx-x-x8154-x', undefined), false)
})
t('มีหลายบัญชีร้าน → ตรงถ้าบัญชีใดบัญชีหนึ่งตรง', () => {
  assert.equal(slipAccountMatches('xxx-x-x8154-x', ['9999999999', '1234581540']), true)
})

console.log(fail ? `ไม่ผ่าน ${fail} รายการ` : 'ผ่านทั้งหมด')
if (fail) process.exitCode = 1
