// คัดลอกโมดูลล้วนจาก src/lib ไปไว้ใน supabase/functions/_shared/schedlib (ให้ Edge Function scheduled ใช้ตรรกะเดียวกับแอป)
// รัน: node scripts/sync-schedlib.mjs · src/lib/schedlibSync.test.mjs ตรวจว่าไฟล์คัดลอกตรงกับต้นฉบับเสมอ
// เปลี่ยนเฉพาะการระบุนามสกุลไฟล์ใน import ที่ Deno ต้องการ (./format → ./format.js) ไม่แก้ตรรกะ
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const SCHEDLIB_FILES = ['constants.js', 'format.js', 'pricing.js', 'payDue.js', 'loyalty.js', 'birthday.js', 'notifyPlan.js', 'bell.js', 'orderLink.js']

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const srcPath = (f) => join(ROOT, 'src', 'lib', f)
export const dstPath = (f) => join(ROOT, 'supabase', 'functions', '_shared', 'schedlib', f)

// เพิ่ม .js ให้ import ตามไฟล์ที่ไม่มีนามสกุล (Deno ไม่เดาให้)
export const toDenoSource = (text) => text.replace(/(from '\.\/[A-Za-z0-9_-]+)'/g, "$1.js'")

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  mkdirSync(dirname(dstPath(SCHEDLIB_FILES[0])), { recursive: true })
  for (const f of SCHEDLIB_FILES) writeFileSync(dstPath(f), toDenoSource(readFileSync(srcPath(f), 'utf8')))
  console.log(`synced ${SCHEDLIB_FILES.length} files`)
}
