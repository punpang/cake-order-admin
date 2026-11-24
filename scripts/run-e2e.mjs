// รัน e2e ทั้งหมดจากโฟลเดอร์ e2e/ โดยค้นหาไฟล์เอง (ไม่ต้องเพิ่มชื่อไฟล์ใน package.json และ ci.yml ทีละไฟล์)
// ไฟล์ที่ไม่รันอยู่ใน EXCLUDED พร้อมเหตุผล · แบ่งงานเป็นส่วน ๆ ด้วย --shard i/n (แบ่งแบบสลับลำดับ เพื่อให้จำนวนไฟล์ใกล้เคียงกัน)
// รัน: node scripts/run-e2e.mjs            (ทั้งหมด ตามลำดับ · หยุดเมื่อไฟล์แรกล้ม)
//      node scripts/run-e2e.mjs --shard 2/4 (เฉพาะส่วนที่ 2 จาก 4 ใช้ใน CI)
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const E2E_DIR = join(ROOT, 'e2e')

// ไฟล์ที่ไม่รันใน CI · ต้องมีเหตุผลทุกรายการ
export const EXCLUDED = {
  'visual.e2e.mjs': 'เทียบภาพ ผูกกับฟอนต์และการเรนเดอร์ของเครื่อง',
  'promoModalLayout.ui.e2e.mjs': 'ยังไม่ได้เพิ่มใน CI (ต้องตรวจก่อนว่าผ่านและตั้งใจไม่รันหรือไม่)',
}

// รายชื่อไฟล์ e2e ที่จะรัน เรียงตามชื่อ (ค่าคงที่ทุกครั้ง)
export function listE2E(files) {
  return files
    .filter((f) => f.endsWith('.e2e.mjs') && !(f in EXCLUDED))
    .sort()
}

// ส่วนที่ i จาก n (i เริ่มที่ 1) · สลับลำดับเพื่อกระจายไฟล์ให้ใกล้เคียงกัน
export function shardOf(list, i, n) {
  if (!Number.isInteger(n) || n < 1 || !Number.isInteger(i) || i < 1 || i > n) throw new Error(`--shard ไม่ถูกต้อง: ${i}/${n}`)
  return list.filter((_, idx) => idx % n === i - 1)
}

function parseShard(argv) {
  const k = argv.indexOf('--shard')
  if (k === -1) return null
  const m = /^(\d+)\/(\d+)$/.exec(argv[k + 1] || '')
  if (!m) throw new Error('ใช้รูปแบบ --shard i/n เช่น --shard 2/4')
  return { i: Number(m[1]), n: Number(m[2]) }
}

export function main(argv = process.argv.slice(2)) {
  const shard = parseShard(argv)
  const all = listE2E(readdirSync(E2E_DIR))
  const list = shard ? shardOf(all, shard.i, shard.n) : all
  console.log(`รัน e2e ${list.length} ไฟล์${shard ? ` (ส่วน ${shard.i}/${shard.n})` : ''} · ข้าม: ${Object.keys(EXCLUDED).join(', ')}`)
  for (const f of list) {
    const r = spawnSync(process.execPath, [join(E2E_DIR, f)], { cwd: ROOT, stdio: 'inherit' })
    if (r.status !== 0) {
      console.log(`✗ ${f} (exit ${r.status})`)
      return 1
    }
    console.log(`✓ ${f}`)
  }
  console.log(`✓ ผ่านทั้งหมด ${list.length} ไฟล์`)
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main())
}
