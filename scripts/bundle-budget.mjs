// งบขนาดไฟล์ของ build หน้าเว็บ: กันโค้ดบวมโดยไม่รู้ตัว · วัดขนาดหลังบีบอัด gzip ของทุกไฟล์ JS/CSS ใน dist/assets
// ล้มเมื่อ: ไฟล์ใดไฟล์หนึ่งเกินเพดานต่อไฟล์ หรือรวมทั้งหมดเกินเพดานรวม
// ค่าเพดานตั้งไว้ราว 5% เหนือขนาดปัจจุบัน (ดูตัวเลขในผลลัพธ์) · ถ้าเพิ่มฟีเจอร์ใหญ่จริง ให้ปรับเพดานพร้อมเหตุผลใน commit
// รัน: npm run build && npm run test:bundle
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'assets')
const PER_FILE_GZIP_KB = 166 // ไฟล์เดียวหลัง gzip (ตัวใหญ่สุดปัจจุบันคือ main ~165 KB · เพิ่มจาก 165 เพราะการล้างคะแนนค้างผ่าน RPC ดู commit)
const TOTAL_GZIP_KB = 910 // งบรวม 910 KB (ขยายเป็น 910: สั่งล่วงหน้า (preorder) เฟส 1 ผู้ใช้อนุมัติ 2026-11-24 · ขยายเป็น 904: คืนเงินบางส่วนออกใบลดหนี้อัตโนมัติ ผู้ใช้อนุมัติ 2026-11-24 ·ขยายจาก 888 → 895: ฟีเจอร์ POS ผู้ใช้อนุมัติ 2026-11-24 · ขยายเป็น 900: บริการเกี่ยวกับเงิน/เงินพัก ผู้ใช้อนุมัติ 2026-11-23 · ขยายเป็น 901: ภาพสำรองและหน้าแรกร้าน ผู้ใช้อนุมัติ 2026-11-24 · ขยายเป็น 902: ราคาของแลกคิดคะแนนอัตโนมัติ ผู้ใช้อนุมัติ 2026-11-24) · ขยายเป็น 903: รูปสินค้าในการ์ด POS ผู้ใช้อนุมัติ 2026-11-24

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
