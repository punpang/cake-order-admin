// รันเทสต์ฝั่ง Node ทั้งหมด (ไม่ต้องติดตั้งเครื่องมืออื่น): src/**/*.test.mjs และบอท Messenger (supabase/functions/fb-webhook/bot.test.mts)
// ส่วนอื่น: npm run test:deno (Edge Function + Worker) · npm run test:db (ฐานข้อมูล Postgres) · ทั้งหมด = npm run test:all
// รัน: npm test · ล้มข้อใด = ออกด้วยรหัส 1 และแสดงท้ายผลลัพธ์ของไฟล์นั้น
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]))
const BOT = join(ROOT, 'supabase', 'functions', 'fb-webhook', 'bot.test.mts')
const jobs = [
  ...walk(join(ROOT, 'src')).filter((f) => f.endsWith('.test.mjs')).sort().map((f) => ({ file: f, args: [f] })),
  { file: BOT, args: ['--experimental-strip-types', '--no-warnings', BOT] },
]

let failed = 0
for (const j of jobs) {
  const r = spawnSync(process.execPath, j.args, { cwd: ROOT, encoding: 'utf8', timeout: 120_000 })
  const name = relative(ROOT, j.file)
  if (r.status === 0) { console.log(`✓ ${name}`); continue }
  failed++
  console.log(`✗ ${name} (${r.status === null ? 'หมดเวลา/ถูกหยุด' : `exit ${r.status}`})`)
  console.log(`${r.stdout || ''}${r.stderr || ''}`.trim().split('\n').slice(-15).map((l) => `    ${l}`).join('\n'))
}
console.log(failed ? `\n✗ ล้ม ${failed} จาก ${jobs.length} ไฟล์` : `\n✓ ผ่านทั้งหมด ${jobs.length} ไฟล์`)
process.exit(failed ? 1 : 0)
