// ทดสอบเลขที่ PRE- ของสั่งล่วงหน้า · รัน: node src/lib/docNoPre.test.mjs
import assert from 'node:assert/strict'
import { DOC_DIGITS, DOC_PREFIXES, STAFF_PREFIXES, formatNo, parseNo } from './docNo.js'

let fail = 0
const t = (name, fn) => { try { fn(); console.log(`PASS ${name}`) } catch (e) { fail++; console.log(`FAIL ${name}: ${e.message}`) } }

t('PRE มีความยาวลำดับ 6 หลัก และอยู่ในรายการ prefix', () => {
  assert.equal(DOC_DIGITS.PRE, 6)
  assert.ok(DOC_PREFIXES.includes('PRE'))
})
t('formatNo: PRE-241124-000007', () => {
  assert.equal(formatNo('PRE', '241124', 7), 'PRE-241124-000007')
})
t('parseNo: อ่าน PRE- ได้ และโหมดทดสอบ TEST-PRE- ได้', () => {
  assert.deepEqual(parseNo('PRE-241124-000007'), { prefix: 'PRE', day: '241124', seq: 7 })
  assert.equal(parseNo('TEST-PRE-241124-000007').prefix, 'PRE')
})
t('ของเดิมไม่เปลี่ยน: OR ยังเป็น 6 หลัก และ POS ยังเป็น 5 หลัก', () => {
  assert.equal(DOC_DIGITS.OR, 6)
  assert.equal(DOC_DIGITS.POS, 5)
})

t('พนักงานเบิกล่วงหน้าไม่รวม PRE (เซิร์ฟเวอร์ออกเอง)', () => {
  assert.ok(!STAFF_PREFIXES.includes('PRE'))
  assert.ok(STAFF_PREFIXES.includes('OR') && STAFF_PREFIXES.includes('POS'))
})

console.log(fail ? `${fail} FAILED` : 'ALL PASS')
process.exit(fail ? 1 : 0)
