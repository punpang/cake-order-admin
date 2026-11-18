// งบขนาดไฟล์ของ build หน้าเว็บ: กันโค้ดบวมโดยไม่รู้ตัว · วัดขนาดหลังบีบอัด gzip ของทุกไฟล์ JS/CSS ใน dist/assets
// ล้มเมื่อ: ไฟล์ใดไฟล์หนึ่งเกินเพดานต่อไฟล์ หรือรวมทั้งหมดเกินเพดานรวม
// ค่าเพดานตั้งไว้ราว 5% เหนือขนาดปัจจุบัน (ดูตัวเลขในผลลัพธ์) · ถ้าเพิ่มฟีเจอร์ใหญ่จริง ให้ปรับเพดานพร้อมเหตุผลใน commit
// รัน: npm run build && npm run test:bundle
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'assets')
const PER_FILE_GZIP_KB = 165 // ไฟล์เดียวหลัง gzip (ตัวใหญ่สุดปัจจุบันคือ main ~158 KB)
const TOTAL_GZIP_KB = 865 // รวม JS + CSS ทั้งหมดหลัง gzip (ปัจจุบันประมาณ 822 KB)

if (!existsSync(DIST)) { console.log('ไม่พบ dist/assets · รัน npm run build ก่อน'); process.exit(1) }
const files = readdirSync(DIST).filter((f) => /\.(js|css)$/.test(f))
const rows = files.map((f) => {
  const raw = readFileSync(join(DIST, f))
  return { f, kb: gzipSync(raw).length / 1024 }
}).sort((a, b) => b.kb - a.kb)
const total = rows.reduce((s, r) => s + r.kb, 0)

for (const r of rows) console.log(`${r.kb.toFixed(1).padStart(8)} KB  ${r.f}`)
console.log(`${total.toFixed(1).padStart(8)} KB  รวมทั้งหมด (งบ ${TOTAL_GZIP_KB} KB)`)

const over = rows.filter((r) => r.kb > PER_FILE_GZIP_KB)
let fails = 0
for (const r of over) { fails++; console.log(`✗ ${r.f} ${r.kb.toFixed(1)} KB เกินงบต่อไฟล์ ${PER_FILE_GZIP_KB} KB`) }
if (total > TOTAL_GZIP_KB) { fails++; console.log(`✗ รวม ${total.toFixed(1)} KB เกินงบรวม ${TOTAL_GZIP_KB} KB`) }
console.log(fails ? `✗ เกินงบ ${fails} รายการ` : '✓ อยู่ในงบทุกรายการ')
process.exit(fails ? 1 : 0)
