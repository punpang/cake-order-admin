// ทดสอบการแปลงรูปแนบของรายการบัญชีเป็นอ้างอิง R2: รูป data: ถูกอัปโหลด · รูปอ้างอิงเดิมไม่ถูกอัปโหลดซ้ำ · error ต้องโยนต่อ
// รัน: node src/lib/acct/receiptRefs.test.mjs
import assert from 'node:assert/strict'
import { resolveReceiptRefs } from './receiptRefs.js'

let fail = 0
const t = async (name, fn) => {
  try { await fn(); console.log('ok -', name) } catch (e) { fail++; console.log('FAIL -', name, e.message) }
}

const fakeUploader = () => {
  const calls = []
  const fn = async (src) => { calls.push(src); return 'r2://private/acct/2026-11/' + calls.length + '.jpg' }
  return { fn, calls }
}

await t('รูป data: ถูกแทนด้วยอ้างอิง r2 และอัปโหลดทีละรูป', async () => {
  const u = fakeUploader()
  const out = await resolveReceiptRefs(['data:image/jpeg;base64,AAA', 'data:image/jpeg;base64,BBB'], u.fn)
  assert.deepEqual(out, ['r2://private/acct/2026-11/1.jpg', 'r2://private/acct/2026-11/2.jpg'])
  assert.equal(u.calls.length, 2)
})

await t('รูปอ้างอิงเดิม (r2:// และ sb://) ไม่ถูกอัปโหลดซ้ำ', async () => {
  const u = fakeUploader()
  const out = await resolveReceiptRefs(['r2://private/acct/x.jpg', 'sb://bucket/a.jpg'], u.fn)
  assert.deepEqual(out, ['r2://private/acct/x.jpg', 'sb://bucket/a.jpg'])
  assert.equal(u.calls.length, 0)
})

await t('รูปเดียวกันอัปโหลดครั้งเดียว', async () => {
  const u = fakeUploader()
  const out = await resolveReceiptRefs(['data:image/jpeg;base64,AAA', 'data:image/jpeg;base64,AAA'], u.fn)
  assert.equal(u.calls.length, 1)
  assert.equal(out[0], out[1])
})

await t('ถ้าอัปโหลดล้มเหลว error ถูกโยนต่อ', async () => {
  await assert.rejects(resolveReceiptRefs(['data:image/jpeg;base64,AAA'], async () => { throw new Error('network') }), /network/)
})

await t('ไม่มีรูปแนบ คืนอาร์เรย์ว่าง', async () => {
  assert.deepEqual(await resolveReceiptRefs([], fakeUploader().fn), [])
  assert.deepEqual(await resolveReceiptRefs(undefined, fakeUploader().fn), [])
})

console.log(fail ? `ล้มเหลว ${fail} รายการ` : 'ผ่านทั้งหมด')
process.exit(fail ? 1 : 0)
