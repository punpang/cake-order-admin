// กันถอยหลัง: แอปพนักงานต้องไม่กลับไปดึงตารางใหญ่ทั้งตาราง (ออร์เดอร์ ลูกค้า แชท ใบเสนอ กะ records) โดยไม่ตั้งใจ
// ตรวจจากซอร์สโค้ด: คำสั่งอ่านตารางเหล่านี้ทุกบรรทัดต้องมีเงื่อนไขจำกัด (eq/in/gte/lt/not/limit/...) หรืออยู่ในรายการยกเว้นที่ระบุเหตุผลไว้
// เพิ่มรายการยกเว้นได้เมื่อจำเป็นจริง พร้อมเหตุผล · รัน: node src/lib/dataBudget.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SRC = join(ROOT, 'src')
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]))
const files = walk(SRC).filter((f) => /\.(js|vue)$/.test(f) && !/\.test\./.test(f))

const BIG = ['punpang_orders', 'punpang_customers', 'punpang_chats', 'punpang_quotes', 'punpang_shifts', 'punpang_records']
const WRITE = /\.(insert|update|delete|upsert)\(/
const BOUNDED = /\.(eq|in|gte|gt|lt|lte|not|is|or|limit|filter|like|ilike|contains)\(|head: true/

// ดึงทั้งตาราง (หรือมีเงื่อนไขในบรรทัดถัดไป) ที่ตั้งใจไว้ · [ไฟล์, ข้อความในบรรทัด, เหตุผล]
const ALLOW = [
  ['src/lib/customersSync.js', "from('punpang_customers').select(COLS).order('id')", 'โหมดปกติโหลดลูกค้าทั้งหมด · มีสวิตช์ "โหลดเฉพาะที่ใช้" สำหรับลูกค้าจำนวนมาก'],
  ['src/lib/ordersSync.js', "let qy = client.from('punpang_orders').select('id,code,customer_id,status,fulfillment,channel,data,updated_at')", 'loadOrders / loadOrdersInRange: เงื่อนไขอยู่บรรทัดถัดไป (ยังไม่ปิด หรือช่วงวันที่) · ประวัติเต็มเฉพาะหน้าบัญชี'],
  ['src/lib/ordersSync.js', "let qy = client.from('punpang_orders').select(ORDER_COLS)", 'loadOrdersWhere: ปฏิเสธเมื่อไม่มีเงื่อนไข'],
  ['src/lib/customersSync.js', "let qy = client.from('punpang_customers').select('id')", 'searchCustomerIds: เงื่อนไขอยู่บรรทัดถัดไป · ไม่มีคำค้น = ไม่ค้น'],
  ['src/lib/shiftsSync.js', "from('punpang_shifts').select('id,opened_at,closed_at,data').order('id')", 'กะ POS ~1 แถวต่อวัน (ควรจำกัดช่วงเมื่อเกินหลายพันกะ)'],
  ['src/lib/chatSync.js', "from('punpang_quotes').select('id,code,chat_id,customer_id,status,order_id,data').order('id')", 'ใบเสนอ: ยังโหลดทั้งหมด (ควรจำกัดตามแชทที่โหลด)'],
  ['src/lib/aiStats.js', ".from('punpang_records')", 'สถิติบอท: เงื่อนไขอยู่บรรทัดถัดไป'],
]

test('คำสั่งอ่านตารางใหญ่ทุกจุดมีเงื่อนไขจำกัด หรืออยู่ในรายการยกเว้น', () => {
  const bad = []
  for (const f of files) {
    const rel = relative(ROOT, f)
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (!BIG.some((t) => line.includes(`from('${t}')`)) || WRITE.test(line)) return
      if (BOUNDED.test(line.slice(line.indexOf('from('))) ) return
      if (ALLOW.some(([af, snippet]) => af === rel && line.includes(snippet))) return
      bad.push(`${rel}:${i + 1}  ${line.trim().slice(0, 140)}`)
    })
  }
  assert.deepEqual(bad, [], `พบการดึงทั้งตารางที่ไม่ได้ระบุไว้ (ใส่เงื่อนไข หรือเพิ่มใน ALLOW พร้อมเหตุผล):\n${bad.join('\n')}`)
})

test('รายการยกเว้นยังตรงกับโค้ดจริง (ลบรายการที่ไม่ใช้แล้ว)', () => {
  const stale = ALLOW.filter(([af, snippet]) => !readFileSync(join(ROOT, af), 'utf8').includes(snippet)).map(([af, s]) => `${af}: ${s}`)
  assert.deepEqual(stale, [])
})

test('ไม่มีหน้าที่โหลดประวัติออร์เดอร์ทั้งหมด (ordersAll) โดยตรง', () => {
  const router = readFileSync(join(SRC, 'router.js'), 'utf8')
  const paths = router.split('\n').filter((l) => /data:\s*\[[^\]]*'ordersAll'/.test(l)).map((l) => (l.match(/path:\s*'([^']+)'/) || [])[1])
  assert.deepEqual(paths, []) // หน้าบัญชีใช้ ordersAcct (ดึงเฉพาะหลังวันปิดงวด · ยังไม่เคยปิดงวดจึงโหลดทั้งหมด)
})

test('records ที่ไม่มีเพดาน (limit) มีเฉพาะที่รู้แล้ว · ชุดใหม่ต้องตั้ง limit หรือเพิ่มพร้อมเหตุผล', () => {
  const src = readFileSync(join(SRC, 'lib', 'recordsSync.js'), 'utf8')
  const block = src.slice(src.indexOf('export const RECORD_SPECS'), src.indexOf('}\n', src.indexOf('export const RECORD_SPECS')))
  const unlimited = block.split('\n').map((l) => l.match(/^\s*(\w+): \{ key:/)?.[1] && !/limit:/.test(l) ? l.match(/^\s*(\w+):/)[1] : null).filter(Boolean).sort()
  // ข้อมูลกันส่งซ้ำ/ลบตาม PDPA/รายการจัดการขนาดเล็ก — ดู PR #93 (ตัดทิ้งไม่ได้โดยไม่ย้ายตรรกะไปเซิร์ฟเวอร์)
  assert.deepEqual(unlimited, ['birthdayGreeted', 'chatDrafts', 'consents', 'coupons', 'deletionRequests', 'notifySent', 'orderLinks', 'photoRequests', 'reviews', 'shortLinks'])
})

test('รีเฟรชออร์เดอร์และลูกค้าใช้การดึงเฉพาะแถวที่เปลี่ยน (loadSince)', () => {
  for (const f of ['ordersSync.js', 'customersSync.js']) assert.match(readFileSync(join(SRC, 'lib', f), 'utf8'), /loadSince: \(since\) =>/, f)
})
