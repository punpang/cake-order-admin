// ทดสอบว่าไฟล์ที่คัดลอกไป _shared/schedlib ตรงกับ src/lib เสมอ · รัน: node src/lib/schedlibSync.test.mjs
// ถ้าไม่ตรง ให้รัน: node scripts/sync-schedlib.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { SCHEDLIB_FILES, dstPath, srcPath, toDenoSource } from '../../scripts/sync-schedlib.mjs'

let fail = 0
for (const f of SCHEDLIB_FILES) {
  try {
    assert.equal(readFileSync(dstPath(f), 'utf8'), toDenoSource(readFileSync(srcPath(f), 'utf8')), f)
    console.log(`PASS ${f} ตรงกับต้นฉบับ`)
  } catch (e) {
    fail++
    console.log(`FAIL ${f}: ${e.message.split('\n')[0]}`)
  }
}
if (fail) { console.log(`${fail} failed · รัน node scripts/sync-schedlib.mjs`); process.exit(1) }
console.log('schedlibSync: all passed')
