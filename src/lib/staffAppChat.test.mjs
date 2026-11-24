// ทดสอบแอปพนักงาน (Android) ที่ถอดแชทออก และเว็บที่ยังมีแชทเหมือนเดิม · รัน: node src/lib/staffAppChat.test.mjs
import assert from 'node:assert/strict'
import { systemsFor, allowedInAppMode } from './adminSystems.js'
import { visibleToStaff } from './bell.js'

const linksOf = (systems) => systems.flatMap((s) => s.items.map((i) => i.to))
let fail = 0
const check = (name, fn) => { try { fn(); console.log(`PASS ${name}`) } catch (e) { fail++; console.log(`FAIL ${name}: ${e.message}`) } }

check('แอปพนักงาน: ไม่มีลิงก์แชทในเมนู', () => {
  const links = linksOf(systemsFor('android'))
  assert.ok(!links.includes('/admin/chat'), 'ยังมีลิงก์แชท')
  assert.ok(links.includes('/admin/orders'), 'ต้องยังมีออร์เดอร์')
  assert.ok(links.includes('/admin/pos'), 'ต้องยัง POS')
})

check('แอปพนักงาน: เข้าเส้นทางแชทไม่ได้ ทั้งหน้ารายการและหน้าแชท', () => {
  assert.equal(allowedInAppMode('android', '/admin/chat'), false)
  assert.equal(allowedInAppMode('android', '/admin/chat/abc'), false)
  assert.equal(allowedInAppMode('android', '/admin/orders'), true)
  assert.equal(allowedInAppMode('android', '/admin/payments'), true)
})

check('เว็บ: ยังมีแชทและเข้าได้เหมือนเดิม', () => {
  assert.ok(linksOf(systemsFor('web')).includes('/admin/chat'))
  assert.equal(allowedInAppMode('web', '/admin/chat'), true)
  assert.equal(allowedInAppMode('web', '/admin/chat/abc'), true)
})

const items = [
  { audience: 'staff', event: 'team_customer_message', at: 1 },
  { audience: 'staff', event: 'team_new_order', at: 2 },
]
const all = () => true

check('กระดิ่งแอปพนักงาน: ไม่แสดงแจ้งเตือนแชท แต่ยังแสดงออร์เดอร์', () => {
  const shown = visibleToStaff(items, all, true).map((i) => i.event)
  assert.deepEqual(shown, ['team_new_order'])
})

check('กระดิ่งเว็บ: ยังแสดงแจ้งเตือนแชท', () => {
  const shown = visibleToStaff(items, all, false).map((i) => i.event)
  assert.deepEqual(shown, ['team_customer_message', 'team_new_order'])
})

console.log(fail ? `ไม่ผ่าน ${fail} กรณี` : 'ผ่านทุกกรณี')
process.exitCode = fail ? 1 : 0
