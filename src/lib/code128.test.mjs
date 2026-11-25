// ทดสอบตัวเข้ารหัส Code128 ชุด B เทียบกับ jsbarcode เดิมทุกค่า · รัน: node src/lib/code128.test.mjs
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { encode128B } from './code128.js'

const require = createRequire(import.meta.url)
const CODE128B = require('jsbarcode/bin/barcodes/CODE128/CODE128B.js').default

let fail = 0
const t = (name, fn) => { try { fn(); console.log(`PASS ${name}`) } catch (e) { fail++; console.log(`FAIL ${name}: ${e.message}`) } }

const SAMPLES = [
  'ABC123',
  '0123456789',
  'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6', // รหัสสมาชิกแบบ hex 32 ตัว
  'coupon-42 OK',
  '!~ hello world',
  'Z',
]

for (const s of SAMPLES) {
  t(`ตรงกับ jsbarcode: "${s}"`, () => {
    assert.equal(encode128B(s), new CODE128B(s, {}).encode().data)
  })
}

t('มี start B ที่ต้นและ stop ที่ท้าย', () => {
  const bits = encode128B('ABC')
  assert.ok(bits.startsWith('11010010000'))
  assert.ok(bits.endsWith('1100011101011'))
})

t('อักขระนอกช่วง ASCII 32–126 โยน RangeError', () => {
  assert.throws(() => encode128B('ก'), RangeError)
  assert.throws(() => encode128B('a\u0007'), RangeError)
})

t('ข้อความว่างโยน RangeError', () => {
  assert.throws(() => encode128B(''), RangeError)
})

if (fail) { console.log(`\n${fail} ล้มเหลว`); process.exit(1) }
console.log('\nผ่านทั้งหมด')
