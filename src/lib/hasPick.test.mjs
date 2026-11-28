// ทดสอบการอ่านตัวเลือกที่เลือกแล้ว ทั้งรหัสเดี่ยว (ออร์เดอร์เดิม) และรายการ · รัน: node src/lib/hasPick.test.mjs
import assert from 'node:assert/strict'
import { hasPick } from './pricing.js'

let fail = 0
const t = (name, fn) => { try { fn(); console.log(`PASS ${name}`) } catch (e) { fail++; console.log(`FAIL ${name}: ${e.message}`) } }

t('รหัสเดี่ยวของกลุ่มเดียว (ออร์เดอร์เดิม) ยังตรงตามเดิม', () => {
  assert.equal(hasPick({ g_s: 'a' }, 'g_s', 'a'), true)
  assert.equal(hasPick({ g_s: 'a' }, 'g_s', 'b'), false)
  assert.equal(hasPick({}, 'g_s', 'a'), false)
})
t('รายการในกลุ่มเดียวกันถูกนับทุกตัว', () => {
  assert.equal(hasPick({ g_s: ['a', 'b'] }, 'g_s', 'b'), true)
  assert.equal(hasPick({ g_s: ['a', 'b'] }, 'g_s', 'c'), false)
})
console.log(fail ? `${fail} FAILED` : 'ALL PASS')
process.exit(fail ? 1 : 0)
