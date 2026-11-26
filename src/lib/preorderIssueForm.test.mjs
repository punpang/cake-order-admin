// ทดสอบการแปลงฟอร์มผู้ซื้อเป็นข้อมูลส่ง issue_invoice (src/lib/preorderIssueForm.js) · รัน: node src/lib/preorderIssueForm.test.mjs
import assert from 'node:assert/strict'
import { buildIssuePayload, EMPTY_ISSUE_FORM } from './preorderIssueForm.js'
import { cleanBuyer } from './taxInvoice.js'

let fail = 0
const t = (name, fn) => { try { fn(); console.log(`PASS ${name}`) } catch (e) { fail++; console.log(`FAIL ${name}: ${e.message}`) } }

// เลข 13 หลักที่ผ่าน checksum (ตัวท้ายคำนวณจาก 12 หลักแรก)
const withCheck = (base12) => { let s = 0; for (let i = 0; i < 12; i++) s += Number(base12[i]) * (13 - i); return base12 + String((11 - (s % 11)) % 10) }
const TAX = withCheck('010553700001')
const FULL = { name: ' บริษัท ทดสอบ จำกัด ', taxId: `${TAX.slice(0, 1)}-${TAX.slice(1, 5)}-${TAX.slice(5, 10)}-${TAX.slice(10)}`, branch: '00000', address: ' 1 ถนนทดสอบ ' }

t('ฟอร์มครบและเลขมีขีด → ได้ payload ที่ทำความสะอาดแล้ว', () => {
  const r = buildIssuePayload('ord1', FULL)
  assert.equal(r.error, undefined)
  assert.deepEqual(r.payload, { orderId: 'ord1', buyer: { name: 'บริษัท ทดสอบ จำกัด', taxId: TAX, branch: '00000', address: '1 ถนนทดสอบ' } })
})

t('ไม่มีรหัสออร์เดอร์ → error', () => {
  assert.equal(buildIssuePayload('', FULL).error, 'ไม่พบออร์เดอร์')
})

t('ไม่มีชื่อผู้ซื้อ → error', () => {
  assert.equal(buildIssuePayload('ord1', { ...FULL, name: '  ' }).error, 'ไม่มีชื่อผู้ซื้อ')
})

t('เลขผู้เสียภาษีผิด → error', () => {
  assert.match(buildIssuePayload('ord1', { ...FULL, taxId: '123' }).error, /13 หลัก/)
})

t('สาขาไม่ใช่ 5 หลัก → error', () => {
  assert.match(buildIssuePayload('ord1', { ...FULL, branch: '1' }).error, /5 หลัก/)
})

t('ไม่มีที่อยู่ → error', () => {
  assert.equal(buildIssuePayload('ord1', { ...FULL, address: '' }).error, 'ไม่มีที่อยู่ผู้ซื้อ')
})

t('ค่าเริ่มต้นสาขาเป็น 00000 และ cleanBuyer ไม่ทำลายชื่อ', () => {
  assert.equal(EMPTY_ISSUE_FORM.branch, '00000')
  assert.equal(cleanBuyer({ name: 'A' }).branch, '00000')
})

if (fail) { console.log(`\n${fail} รายการล้มเหลว`); process.exit(1) }
console.log('\nผ่านทั้งหมด')
