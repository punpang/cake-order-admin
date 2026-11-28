// ทดสอบการเลือกเพิ่มในกลุ่มเลือกได้ 1 อย่าง เมื่อประกอบเป็นบันเดิ้ล · รัน: node src/lib/singleBundle.test.mjs
import assert from 'node:assert/strict'
import { singleBundleExtends } from './pricing.js'

let fail = 0
const t = (name, fn) => { try { fn(); console.log(`PASS ${name}`) } catch (e) { fail++; console.log(`FAIL ${name}: ${e.message}`) } }
const G = 'g_top'
const bundles = [
  { id: 'b1', active: true, items: [{ groupId: G, optionId: 'cherry' }, { groupId: G, optionId: 'kit' }] },
  { id: 'b2', active: false, items: [{ groupId: G, optionId: 'oreo' }, { groupId: G, optionId: 'beng' }] },
  { id: 'b3', active: true, items: [{ groupId: G, optionId: 'kit' }, { groupId: 'g_other', optionId: 'x' }] },
]

t('เลือกเพิ่มตัวที่อยู่ในบันเดิ้ลเดียวกับตัวที่เลือกอยู่ได้', () => {
  assert.equal(singleBundleExtends(bundles, G, ['cherry'], 'kit'), true)
})
t('เลือกตัวที่ไม่ได้อยู่ในบันเดิ้ลกับตัวที่เลือก ไม่ได้', () => {
  assert.equal(singleBundleExtends(bundles, G, ['cherry'], 'oreo'), false)
})
t('บันเดิ้ลที่ปิดอยู่ หรือมีตัวจากกลุ่มอื่น ไม่นับ', () => {
  assert.equal(singleBundleExtends(bundles, G, ['oreo'], 'beng'), false)
  assert.equal(singleBundleExtends(bundles, G, ['kit'], 'x'), false)
})
t('ตัวที่เลือกอยู่หลายตัวต้องอยู่ในบันเดิ้ลเดียวกันทั้งหมด', () => {
  assert.equal(singleBundleExtends(bundles, G, ['cherry', 'oreo'], 'kit'), false)
})

console.log(fail ? `${fail} FAILED` : 'ALL PASS')
process.exit(fail ? 1 : 0)
