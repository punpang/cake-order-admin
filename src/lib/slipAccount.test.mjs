// ทดสอบการเทียบเลขบัญชีผู้รับบนสลิปกับบัญชีของร้าน · รัน: node src/lib/slipAccount.test.mjs
import assert from 'node:assert/strict'
import { slipAccountCheck } from './slipAccount.js'

let fail = 0
const t = (name, fn) => { try { fn(); console.log(`PASS ${name}`) } catch (e) { fail++; console.log(`FAIL ${name}: ${e.message}`) } }
const BANK = { bank: ['1234581540'], promptpay: [] }

t('ปิดบางหลัก xxx-x-x8154-x ตรงกับบัญชีร้านที่ตำแหน่งเดียวกัน → match', () => {
  assert.equal(slipAccountCheck('xxx-x-x8154-x', BANK), 'match')
})
t('ปิดด้วย XXX XXX 3402 ตรงกับบัญชีร้านที่ลงท้าย 3402 (เลขร้านมีขีด) → match', () => {
  assert.equal(slipAccountCheck('XXX XXX 3402', { bank: ['123-4-56340-2'], promptpay: [] }), 'match')
})
t('OCR อ่านตัวปิดเป็น % ยังเทียบได้ → match', () => {
  assert.equal(slipAccountCheck('%%%-%-%8154-%', BANK), 'match')
})
t('ตัวเลขที่เห็นไม่ตรงกับบัญชีร้าน → mismatch', () => {
  assert.equal(slipAccountCheck('XXX XXX 3402', { bank: ['1234563409'], promptpay: [] }), 'mismatch')
})
t('จำนวนหลักไม่เท่ากับบัญชีร้าน → mismatch', () => {
  assert.equal(slipAccountCheck('xxx-x-x8154-x', { bank: ['12345681540'], promptpay: [] }), 'mismatch')
})
t('พร้อมเพย์แบบ *** ******** 1234 ตรงกับเบอร์ร้านที่ลงท้าย 1234 → match', () => {
  assert.equal(slipAccountCheck('*** ******** 1234', { bank: [], promptpay: ['0812341234'] }), 'match')
})
t('พร้อมเพย์ไม่ตรงกับเบอร์ร้าน → mismatch', () => {
  assert.equal(slipAccountCheck('*** ******** 1234', { bank: ['1234581540'], promptpay: ['0812345678'] }), 'mismatch')
})
t('เห็นตัวเลขไม่ถึง 4 หลัก → unknown (ไม่เตือน)', () => {
  assert.equal(slipAccountCheck('xxx-x-xxx12-x', BANK), 'unknown')
})
t('ข้อความที่ไม่ใช่รูปแบบเลข (เช่น KB...) → unknown', () => {
  assert.equal(slipAccountCheck('KB000001234567', BANK), 'unknown')
})
t('ไม่มีเลขบนสลิป → unknown', () => {
  assert.equal(slipAccountCheck(null, BANK), 'unknown')
  assert.equal(slipAccountCheck('', BANK), 'unknown')
})
t('ร้านยังไม่ได้ตั้งบัญชี → unknown', () => {
  assert.equal(slipAccountCheck('xxx-x-x8154-x', { bank: [], promptpay: [] }), 'unknown')
  assert.equal(slipAccountCheck('xxx-x-x8154-x', {}), 'unknown')
})
t('มีหลายบัญชีร้าน → match ถ้าบัญชีใดบัญชีหนึ่งตรง', () => {
  assert.equal(slipAccountCheck('xxx-x-x8154-x', { bank: ['9999999999', '1234581540'], promptpay: [] }), 'match')
})

console.log(fail ? `ไม่ผ่าน ${fail} รายการ` : 'ผ่านทั้งหมด')
if (fail) process.exitCode = 1
