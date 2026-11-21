// ทดสอบ W-5: ฉบับที่ค้างจากการถูกปฏิเสธ (isHeld) ต้องไม่ถูกทับด้วยฉบับเซิร์ฟเวอร์ ทั้งตอนดึงเฉพาะที่เปลี่ยน ตอนรวมแถว และตอนดึงตามรหัส · รัน: node src/lib/tableSync.isHeld.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { startSync, fillArray, withVer } from './tableSync.js'

const V1 = '2026-11-21T04:00:00.000Z'
const V2 = '2026-11-21T04:10:00.000Z'
const V3 = '2026-11-21T04:20:00.000Z'
const row = (id, n, v) => withVer({ id, n }, v)
const copy = (r) => withVer({ ...r }, r._v) // ค่า _v ไม่ถูกคัดลอกด้วยการกระจาย จึงแนบใหม่

// เซิร์ฟเวอร์จำลอง: server.rows = ตารางปัจจุบันบนฐานข้อมูล · h1 เป็นออร์เดอร์ที่ฐานข้อมูลปฏิเสธ (ค้างในเครื่อง)
async function setup(serverRows) {
  const server = { rows: serverRows }
  const items = []
  const held = new Set()
  const applied = []
  const h = await startSync({
    label: 'ทดสอบ-isHeld', list: () => items, replace: (xs) => fillArray(items, xs),
    load: async () => ({ items: server.rows.map(copy) }),
    loadSince: async () => ({ items: server.rows.map(copy) }),
    loadByIds: async () => ({ items: server.rows.map(copy) }),
    applyRows: (rows) => applied.push(rows.map((r) => r.id)),
    push: async (changes) => {
      const rejected = changes.upserts.filter((it) => it.id === 'h1')
      for (const it of rejected) held.add(it.id) // จำลอง ordersSync: ปฏิเสธถาวร → ค้างในเครื่อง
      return { ok: true, rejected: rejected.map((it) => ({ id: it.id })) }
    },
    canWrite: true, poll: true, debounceMs: 60000, isHeld: (id) => held.has(id),
  })
  return { h, items, applied, server }
}

test('ดึงเฉพาะที่เปลี่ยน: ฉบับค้าง h1 ไม่ถูกทับ แถวปกติยังอัปเดต และแถวใหม่เข้ามา', async () => {
  const { h, items, applied, server } = await setup([row('h1', 1, V1), row('o2', 1, V1)])
  items.find((i) => i.id === 'h1').n = 2 // แก้ค้างในเครื่อง
  await h.flush() // ฐานข้อมูลปฏิเสธ h1 → ค้าง
  server.rows = [row('h1', 3, V2), row('o2', 4, V2), row('x3', 9, V2)]
  assert.equal(await h.refresh(), true)
  assert.equal(items.find((i) => i.id === 'h1').n, 2)
  assert.equal(items.find((i) => i.id === 'o2').n, 4)
  assert.equal(items.find((i) => i.id === 'x3').n, 9)
  assert.ok(applied.flat().every((id) => id !== 'h1'))
  h.stop()
})

test('รวมแถวและดึงตามรหัส: ฉบับค้างถูกข้าม แถวปกติยังรวมได้', async () => {
  const { h, items, server } = await setup([row('h1', 1, V1), row('o2', 1, V1)])
  items.find((i) => i.id === 'h1').n = 2 // แก้ค้างในเครื่อง
  await h.flush()
  server.rows = [row('h1', 3, V2), row('o2', 4, V2)]
  assert.equal(h.merge([row('h1', 7, V3), row('o2', 5, V3)]), true)
  assert.equal(items.find((i) => i.id === 'h1').n, 2)
  assert.equal(items.find((i) => i.id === 'o2').n, 5)
  assert.equal(await h.refreshIds(['h1']), true)
  assert.equal(items.find((i) => i.id === 'h1').n, 2)
  h.stop()
})
