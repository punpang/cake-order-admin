// ทดสอบตัวค้นหาและแบ่งส่วนของ scripts/run-e2e.mjs: ไม่มีไฟล์ซ้ำหรือตกหล่น · ข้ามเฉพาะที่ระบุ · แบ่งส่วนครบทุกไฟล์
import assert from 'node:assert/strict'
import { readdirSync, existsSync } from 'node:fs'
import { listE2E, shardOf, EXCLUDED, E2E_DIR } from '../../scripts/run-e2e.mjs'

const cases = []
const t = (name, fn) => cases.push([name, fn])

const fake = ['b.e2e.mjs', 'visual.e2e.mjs', 'a.e2e.mjs', 'x.test.mjs', 'promoModalLayout.ui.e2e.mjs', 'c.ui.e2e.mjs']

t('listE2E: เรียงชื่อ · เฉพาะ .e2e.mjs · ข้ามไฟล์ที่อยู่ใน EXCLUDED', () => {
  assert.deepEqual(listE2E(fake), ['a.e2e.mjs', 'b.e2e.mjs', 'c.ui.e2e.mjs'])
})

t('shardOf: แบ่งครบทุกไฟล์ ไม่ซ้ำ ไม่ตกหล่น (ทุกค่า n ตั้งแต่ 1 ถึง 6)', () => {
  const list = listE2E(fake).concat(['d.e2e.mjs', 'e.e2e.mjs', 'f.e2e.mjs', 'g.e2e.mjs'])
  for (let n = 1; n <= 6; n++) {
    const all = []
    for (let i = 1; i <= n; i++) all.push(...shardOf(list, i, n))
    assert.deepEqual(all.slice().sort(), list.slice().sort(), `n=${n}`)
    assert.equal(new Set(all).size, all.length, `ซ้ำเมื่อ n=${n}`)
  }
})

t('shardOf: ขนาดส่วนต่างกันไม่เกิน 1 ไฟล์', () => {
  const list = Array.from({ length: 37 }, (_, k) => `f${k}.e2e.mjs`)
  const sizes = [1, 2, 3, 4].map((i) => shardOf(list, i, 4).length)
  assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1, `ขนาด ${sizes}`)
})

t('shardOf: ค่า --shard ไม่ถูกต้องต้องโยน error', () => {
  assert.throws(() => shardOf([], 0, 4))
  assert.throws(() => shardOf([], 5, 4))
  assert.throws(() => shardOf([], 1, 0))
})

t('ไฟล์ e2e จริงทุกไฟล์ที่ระบุใน EXCLUDED มีอยู่จริง (กันการระบุชื่อผิด)', () => {
  const files = readdirSync(E2E_DIR)
  for (const f of Object.keys(EXCLUDED)) assert.ok(files.includes(f) || existsSync(`${E2E_DIR}/${f}`), f)
})

t('ไฟล์ e2e จริงทุกไฟล์รันได้ (อยู่ในรายการหรือถูกข้ามพร้อมเหตุผล)', () => {
  const real = readdirSync(E2E_DIR).filter((f) => f.endsWith('.e2e.mjs'))
  const run = new Set(listE2E(real))
  for (const f of real) assert.ok(run.has(f) || f in EXCLUDED, `ไม่รันและไม่มีเหตุผล: ${f}`)
})

let fails = 0
for (const [name, fn] of cases) {
  try { fn(); console.log(`ok   ${name}`) } catch (e) { fails++; console.log(`FAIL ${name}\n     ${e.message}`) }
}
if (fails) { console.log(`\n${fails} ไม่ผ่าน`); process.exit(1) }
console.log(`\nผ่านทั้งหมด ${cases.length} รายการ`)
