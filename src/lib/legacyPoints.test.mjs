// ทดสอบการจับคู่คะแนนเก่าด้วยเบอร์: normalize · แฮชให้ค่าเดียวกันทุกรูปแบบเบอร์ · ปัดคะแนน
// รัน: node src/lib/legacyPoints.test.mjs
import assert from 'node:assert/strict'
import { normalizeTel, telHash, legacyWholePoints } from './legacyPoints.js'

let fail = 0
const t = async (name, fn) => {
  try { await fn(); console.log('ok -', name) } catch (e) { fail++; console.log('FAIL -', name, e.message) }
}

await t('normalize: ตัดขีด/ช่องว่าง และแปลง +66', () => {
  assert.equal(normalizeTel('081-234-5678'), '0812345678')
  assert.equal(normalizeTel(' 081 234 5678 '), '0812345678')
  assert.equal(normalizeTel('+66812345678'), '0812345678')
  assert.equal(normalizeTel('66 81 234 5678'), '0812345678')
})

await t('normalize: เบอร์ไม่ถูกต้องคืน null', () => {
  assert.equal(normalizeTel(''), null)
  assert.equal(normalizeTel(null), null)
  assert.equal(normalizeTel('123'), null)
  assert.equal(normalizeTel('abcdefghij'), null)
})

await t('แฮชเท่ากันทุกรูปแบบของเบอร์เดียวกัน', async () => {
  const a = await telHash('081-234-5678')
  assert.equal(a, await telHash('+66812345678'))
  assert.equal(a, await telHash('0812345678'))
})

await t('แฮชต่างกันเมื่อเบอร์ต่างกัน และเป็น sha256 hex 64 ตัว', async () => {
  const a = await telHash('0812345678')
  assert.notEqual(a, await telHash('0812345679'))
  assert.match(a, /^[0-9a-f]{64}$/)
})

await t('แฮชของเบอร์ไม่ถูกต้องคืน null', async () => {
  assert.equal(await telHash('123'), null)
})

await t('คะแนนเก่า: ปัดลงเป็นจำนวนเต็ม และค่าไม่ถูกต้องเป็น 0', () => {
  assert.equal(legacyWholePoints(300.9), 300)
  assert.equal(legacyWholePoints(42), 42)
  assert.equal(legacyWholePoints(-5), 0)
  assert.equal(legacyWholePoints(null), 0)
  assert.equal(legacyWholePoints('abc'), 0)
})

console.log(fail ? `ล้มเหลว ${fail} รายการ` : 'ผ่านทั้งหมด')
process.exit(fail ? 1 : 0)
