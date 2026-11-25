// ทดสอบการย้ายเมนูสั่งล่วงหน้าเป็นระบบระดับบนสุด (ฟังก์ชันล้วน) · รัน: node src/lib/preorderNav.test.mjs
import assert from 'node:assert/strict'
import { systemsFor, systemOf, visibleSystems, systemByKey } from './adminSystems.js'

let fail = 0
const t = (name, fn) => { try { fn(); console.log(`PASS ${name}`) } catch (e) { fail++; console.log(`FAIL ${name}: ${e.message}`) } }
const can = (perms) => (p) => perms.includes(p)

t('ระบบสั่งล่วงหน้าอยู่ระดับบนสุดและชี้ไปหน้าใหม่', () => {
  const s = systemByKey('preorder')
  assert.ok(s)
  assert.equal(s.home, '/admin/preorders')
})

t('ผู้มีสิทธิ์ managePreorder เห็นระบบสั่งล่วงหน้า', () => {
  assert.ok(visibleSystems(can(['managePreorder'])).some((s) => s.key === 'preorder'))
})

t('ผู้ไม่มีสิทธิ์ไม่เห็นระบบสั่งล่วงหน้า', () => {
  assert.equal(visibleSystems(can(['pos'])).some((s) => s.key === 'preorder'), false)
})

t('โหมดแอป Android ไม่มีระบบสั่งล่วงหน้า', () => {
  assert.equal(systemsFor('android').some((s) => s.key === 'preorder'), false)
})

t('เส้นทางสั่งล่วงหน้าอยู่ในระบบของตัวเอง ไม่ปนกับออร์เดอร์หรือตั้งค่า', () => {
  assert.equal(systemOf('/admin/preorders'), 'preorder')
  assert.equal(systemOf('/admin/preorders/x'), 'preorder')
  assert.equal(systemOf('/admin/orders'), 'orders')
  assert.equal(systemOf('/admin/settings/preorders'), 'settings')
})

if (fail) { console.log(`\n${fail} ล้มเหลว`); process.exit(1) }
console.log('\nผ่านทั้งหมด')
