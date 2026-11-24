// ทดสอบตัวช่วยหน้าบัญชีลูกค้า · รัน: node src/lib/accountView.test.mjs
import assert from 'node:assert/strict'
import { isSampleName, initialOf, pointsShortfall } from './accountView.js'

const cases = [
  ['คุณมะลิ ใจดี', 'ม'],     // ข้ามคำนำหน้า "คุณ" ไม่ใช่ "ค"
  ['เอ', 'อ'],               // ข้ามสระหน้า เ
  ['ใจดี', 'จ'],             // ข้ามสระหน้า ไ/ใ
  ['โชค', 'ช'],              // ข้ามสระหน้า โ
  ['นางสาวปราณี', 'ป'],      // คำนำหน้ายาว
  ['นาย ก', 'ก'],            // ช่องว่างหลังคำนำหน้า
  ['Mrs. Smith', 's'.toUpperCase()], // อังกฤษ เป็นตัวพิมพ์ใหญ่
  ['', '?'],
  [null, '?'],
]
let fail = 0
for (const [input, want] of cases) {
  const got = initialOf(input)
  if (got !== want) { fail++; console.log(`FAIL initialOf(${JSON.stringify(input)}) = ${got}, ต้องเป็น ${want}`) }
}

const sample = [
  ['คูปองส่วนลด 50 บาท (ตัวอย่าง)', true],
  ['เค้ก 1 ปอนด์', false],
  [undefined, false],
]
for (const [input, want] of sample) {
  if (isSampleName(input) !== want) { fail++; console.log(`FAIL isSampleName(${JSON.stringify(input)})`) }
}

if (pointsShortfall(120, 500) !== 380) { fail++; console.log('FAIL pointsShortfall(120,500)') }
if (pointsShortfall(500, 500) !== 0) { fail++; console.log('FAIL pointsShortfall(500,500)') }
if (pointsShortfall(600, 500) !== 0) { fail++; console.log('FAIL pointsShortfall(600,500)') }

console.log(fail ? `ไม่ผ่าน ${fail} กรณี` : `ผ่านทั้งหมด ${cases.length + sample.length + 3} กรณี`)
process.exitCode = fail ? 1 : 0
