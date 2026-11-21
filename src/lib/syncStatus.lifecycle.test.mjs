// ทดสอบ 1ก: เตือนก่อนปิดเมื่อยังมีข้อมูลรอบันทึก และส่งรายการที่รอหรือค้างทันทีเมื่อแท็บถูกซ่อนหรือปิดหน้า · รัน: node src/lib/syncStatus.lifecycle.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'

await import('vue') // โหลด Vue ก่อนมี document จำลอง (Vue ตรวจ document ตอนโหลด)
const winHandlers = {}
const docHandlers = {}
globalThis.window = { addEventListener: (type, fn) => { (winHandlers[type] ||= []).push(fn) } }
globalThis.document = { visibilityState: 'visible', addEventListener: (type, fn) => { (docHandlers[type] ||= []).push(fn) } }
const S = await import('./syncStatus.js')
const fire = (handlers, type, ev = {}) => { for (const fn of handlers[type] || []) fn(ev) }

test('เตือนก่อนปิดเมื่อยังมีรายการไม่ได้บันทึก และไม่เตือนเมื่อบันทึกครบ', () => {
  S.syncSet('ทดสอบ-เตือน', 'pending')
  const warn = { prevented: false, returnValue: undefined, preventDefault() { this.prevented = true } }
  fire(winHandlers, 'beforeunload', warn)
  assert.equal(warn.prevented, true)
  assert.equal(warn.returnValue, '')
  S.syncOk('ทดสอบ-เตือน')
  const quiet = { prevented: false, preventDefault() { this.prevented = true } }
  fire(winHandlers, 'beforeunload', quiet)
  assert.equal(quiet.prevented, false)
})

test('แท็บถูกซ่อน → ส่งเฉพาะรายการที่รอทันที ไม่ส่งซ้ำรายการที่ค้างหรือกำลังส่ง', () => {
  const calls = []
  S.syncSet('ทดสอบ-รอ', 'pending', '', () => calls.push('รอ'))
  S.syncSet('ทดสอบ-ค้าง', 'failed', 'ทดสอบ', () => calls.push('ค้าง'))
  S.syncSet('ทดสอบ-กำลังส่ง', 'saving', '', () => calls.push('กำลังส่ง'))
  document.visibilityState = 'hidden'
  fire(docHandlers, 'visibilitychange')
  document.visibilityState = 'visible'
  assert.deepEqual(calls, ['รอ'])
  for (const k of ['ทดสอบ-รอ', 'ทดสอบ-ค้าง', 'ทดสอบ-กำลังส่ง']) S.syncDrop(k)
})

test('แท็บกลับมาแสดงผล (visible) → ไม่ส่งซ้ำ', () => {
  let n = 0
  S.syncSet('ทดสอบ-แสดง', 'pending', '', () => { n++ })
  document.visibilityState = 'visible'
  fire(docHandlers, 'visibilitychange')
  assert.equal(n, 0)
  S.syncDrop('ทดสอบ-แสดง')
})

test('ปิดหน้า (pagehide) → ส่งรายการที่รออยู่ทันที', () => {
  let n = 0
  S.syncSet('ทดสอบ-ปิดหน้า', 'pending', '', () => { n++ })
  fire(winHandlers, 'pagehide')
  assert.equal(n, 1)
  S.syncDrop('ทดสอบ-ปิดหน้า')
})
