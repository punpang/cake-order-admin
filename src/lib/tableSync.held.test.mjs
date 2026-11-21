// ทดสอบสถานะซิงก์ของออร์เดอร์ที่ถูกปฏิเสธถาวร (statusHook): ต้องไม่กลับเป็นปกติเงียบ ๆ และ waitSaved (POS) ต้องแจ้งไม่สำเร็จ · รัน: node src/lib/tableSync.held.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { startSync, fillArray } from './tableSync.js'
import { waitSaved } from './syncStatus.js'

// เริ่มซิงก์จำลอง: รายการในเครื่องคือ items · push/statusHook ส่งมาจากเทสต์
async function newSync(label, push, statusHook) {
  const items = []
  const h = await startSync({
    label, list: () => items, replace: (xs) => fillArray(items, xs),
    load: async () => ({ items: [] }), push, canWrite: true, debounceMs: 0, statusHook,
  })
  return { h, items }
}

test('ออร์เดอร์ที่ถูกปฏิเสธถาวรยังค้าง → สถานะซิงก์คงล้มเหลว และ waitSaved แจ้งไม่สำเร็จ', async () => {
  let held = 0
  const { h, items } = await newSync('ทดสอบค้าง-1',
    async () => { held = 1; return { ok: true, rejected: [{ id: 'bad' }] } },
    () => (held ? 'ออร์เดอร์ 1 รายการยังไม่ถูกบันทึกขึ้นเซิร์ฟเวอร์' : null))
  items.push({ id: 'bad', n: 1 })
  await h.flush()
  const r = await waitSaved(['ทดสอบค้าง-1'], 500)
  assert.equal(r.ok, false)
  assert.match(r.error, /ยังไม่ถูกบันทึก/)
  h.stop()
})

test('เมื่อแถวค้างถูกแก้ไขจนส่งสำเร็จ สถานะกลับเป็นปกติ', async () => {
  let rejectNext = true
  let held = 0
  const { h, items } = await newSync('ทดสอบค้าง-2',
    async (changes) => {
      if (rejectNext) { held = 1; return { ok: true, rejected: [{ id: changes.upserts[0].id }] } }
      held = 0
      return {}
    },
    () => (held ? 'ออร์เดอร์ค้าง' : null))
  items.push({ id: 'bad', n: 1 })
  await h.flush()
  rejectNext = false
  items[0].n = 2 // แก้ไขแถวที่ค้าง → ส่งใหม่
  await h.flush()
  const r = await waitSaved(['ทดสอบค้าง-2'], 500)
  assert.equal(r.ok, true)
  h.stop()
})
