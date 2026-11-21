// ทดสอบแถบค้างของเครื่องพนักงาน: ออร์เดอร์ที่เข้าคิวผู้จัดการ · รับทราบ · ออกจากระบบล้าง · เก็บในเครื่องและเรียกคืนได้ · localStorage ใช้ไม่ได้ไม่ทำให้แอปพัง
import test from 'node:test'
import assert from 'node:assert/strict'

await import('vue') // โหลด Vue ก่อนมี document จำลอง (Vue ตรวจ document ตอนโหลด · เหมือน syncStatus.lifecycle.test.mjs)
const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)) },
  removeItem: (k) => { store.delete(k) },
}
globalThis.window = { addEventListener() {} }
globalThis.document = { visibilityState: 'visible', addEventListener() {} }
const S = await import('./syncStatus.js')

test('เข้าคิวแล้วมีรหัสในแถบค้าง ไม่ซ้ำ และบันทึกลงเครื่อง', () => {
  S.addQueuedNotice(['OR-1', 'OR-2'])
  S.addQueuedNotice(['OR-2', 'OR-3'])
  assert.deepEqual(S.queuedNotices.list.map((x) => x.code), ['OR-1', 'OR-2', 'OR-3'])
  const saved = JSON.parse(store.get('punpang_queued_notices'))
  assert.deepEqual(saved.map((x) => x.code), ['OR-1', 'OR-2', 'OR-3'])
  assert.ok(saved.every((x) => typeof x.at === 'string'))
})

test('เก็บเฉพาะรหัสและเวลา ไม่มีข้อมูลอื่นลงเครื่อง', () => {
  S.ackQueuedNotices()
  S.addQueuedNotice(['OR-9'])
  const saved = JSON.parse(store.get('punpang_queued_notices'))
  assert.deepEqual(Object.keys(saved[0]).sort(), ['at', 'code'])
})

test('รับทราบล้างทั้งหมดในเครื่อง และเรียกซ้ำได้โดยไม่ error', () => {
  S.addQueuedNotice(['OR-4'])
  S.ackQueuedNotices()
  assert.deepEqual(S.queuedNotices.list, [])
  assert.equal(store.get('punpang_queued_notices'), '[]')
  S.ackQueuedNotices()
  assert.deepEqual(S.queuedNotices.list, [])
})

test('ออกจากระบบ (clearQueuedNotices) ล้างแถบค้างและไม่เหลือข้อมูลในเครื่อง', () => {
  S.addQueuedNotice(['OR-5'])
  S.clearQueuedNotices()
  assert.deepEqual(S.queuedNotices.list, [])
  assert.equal(store.get('punpang_queued_notices'), '[]')
})

test('localStorage ใช้ไม่ได้ ไม่ทำให้แอปพัง (แถบยังอยู่ในหน่วยความจำของหน้า)', () => {
  const real = globalThis.localStorage
  globalThis.localStorage = { getItem() { throw new Error('denied') }, setItem() { throw new Error('denied') } }
  try {
    assert.doesNotThrow(() => S.addQueuedNotice(['OR-8']))
    assert.deepEqual(S.queuedNotices.list.map((x) => x.code), ['OR-8'])
    assert.doesNotThrow(() => S.ackQueuedNotices())
    assert.deepEqual(S.queuedNotices.list, [])
  } finally {
    globalThis.localStorage = real
  }
})
